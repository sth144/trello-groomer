import { BoardController } from "../controller/board.controller";
import { BoardModel } from "../model/board.model";
import { logger } from "../lib/logger";
import { Snapshot, SnapshotStore } from "./snapshot.store";

/*************************************************************************************************
 * On-demand rebuild of a board straight from Trello.                                             *
 *                                                                                               *
 * Reads normally come from the snapshot a groomer left behind, which is only as fresh as that     *
 *  groomer's last run — and is stale indefinitely on a machine where no groomer runs at all.      *
 *  BoardController.wakeUp() issues GETs only (lists, cards, checklists, labels), so the API can   *
 *  safely rebuild the model itself without any of the grooming side effects.                      *
 *                                                                                               *
 * This costs the ~12 sequential Trello requests the snapshot exists to avoid, so it is only ever  *
 *  triggered explicitly — never on the read path.                                                *
 *************************************************************************************************/

export interface RefreshResult {
  board: string;
  snapshot: Snapshot;
  trelloRequests: number;
  durationMs: number;
}

/**
 * Board models are required lazily: the media groomer drags in audio and embedding dependencies
 *  this process has no other use for. config/boards.json is deliberately required inside the
 *  factories too — it is gitignored and dockerignored, so it is absent at build time and only
 *  mounted at runtime. Requiring it at module scope breaks anything that merely imports this file.
 */
const MODEL_FACTORIES: Record<string, () => BoardModel> = {
  todo: () => {
    const { ToDoBoardModel } = require("../groomer/todo.groomer");
    return new ToDoBoardModel(require("../../config/boards.json").todo.id);
  },
  work: () => {
    const { WorkBoardModel } = require("../groomer/work.groomer");
    return new WorkBoardModel(require("../../config/boards.json").work.id);
  },
};

export class BoardRefreshError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 502
  ) {
    super(message);
    /** es5 downlevelling breaks `instanceof` on Error subclasses — see snapshot.store.ts */
    Object.setPrototypeOf(this, BoardRefreshError.prototype);
  }
}

export class BoardRefresher {
  /** coalesces concurrent refreshes of the same board into one set of Trello requests */
  private inFlight: Record<string, Promise<RefreshResult>> = {};

  constructor(
    private store: SnapshotStore,
    private secrets: { key: string; token: string },
    private now: () => number = Date.now
  ) {}

  public getSupportedBoards(): string[] {
    return Object.keys(MODEL_FACTORIES);
  }

  public isSupported(board: string): boolean {
    return MODEL_FACTORIES.hasOwnProperty(board);
  }

  public refresh(board: string): Promise<RefreshResult> {
    if (!this.isSupported(board)) {
      return Promise.reject(
        new BoardRefreshError(
          `Cannot rebuild "${board}" from Trello. Supported boards: ` +
            `${this.getSupportedBoards().join(", ")}.`,
          400
        )
      );
    }

    const existing = this.inFlight[board];
    if (existing !== undefined) {
      logger.info(`Joining in-flight refresh of ${board}`);
      return existing;
    }

    const work = this.rebuild(board);
    this.inFlight[board] = work;

    /** clear the slot whichever way it settles, without swallowing the result */
    const clear = () => {
      delete this.inFlight[board];
    };
    work.then(clear, clear);

    return work;
  }

  private async rebuild(board: string): Promise<RefreshResult> {
    const startedAt = this.now();
    logger.info(`Rebuilding ${board} board from Trello`);

    const model = MODEL_FACTORIES[board]();
    const controller = new BoardController(model, this.secrets);

    try {
      await controller.wakeUp();
    } catch (e) {
      throw new BoardRefreshError(`Could not rebuild ${board} from Trello: ${e}`);
    }

    /**
     * round-tripping through JSON gives exactly the shape BoardController.dump() writes, so a
     *  refreshed snapshot and a groomer-written one parse identically.
     */
    const raw = JSON.parse(JSON.stringify(controller.BoardModel));
    const snapshot = new Snapshot(raw, new Date(this.now()));

    if (snapshot.getAllCards().length === 0) {
      throw new BoardRefreshError(
        `Rebuilt ${board} from Trello but got no cards back — refusing to serve it.`
      );
    }

    this.store.setLiveSnapshot(board, snapshot);

    const result: RefreshResult = {
      board,
      snapshot,
      trelloRequests: controller.NumRequests,
      durationMs: this.now() - startedAt,
    };
    logger.info(
      `Rebuilt ${board}: ${snapshot.getAllCards().length} cards in ` +
        `${result.durationMs}ms over ${result.trelloRequests} Trello requests`
    );
    return result;
  }
}
