import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { ICard } from "../lib/card.interface";
import { CheckItem, Checklist } from "../lib/checklist.interface";

/*************************************************************************************************
 * Read side of the API. BoardController.dump() already serializes the whole in-memory board     *
 *  model to cache/model.<board>.json at the end of every groomer run; this module reads those    *
 *  snapshots back so consumers never pay for the ~12 sequential Trello requests that            *
 *  buildModel() costs.                                                                          *
 *                                                                                               *
 * Snapshots are parsed lazily and memoized by file mtime, so a request only pays parse cost the  *
 *  first time it sees a given groomer run.                                                       *
 *************************************************************************************************/

/** shape produced by JSON.stringify(BoardModel) — private fields become plain properties */
interface RawSnapshot {
  _id: string;
  lists: Record<string, { id: string; name: string; cards: ICard[] }>;
  checkLists: Record<string, Checklist>;
  labels: Record<string, string>;
  labelColors: Record<string, string>;
}

export interface SnapshotList {
  id: string;
  name: string;
  cardCount: number;
}

export interface BoardStats {
  boardId: string;
  capturedAt: string;
  totalCards: number;
  totalChecklists: number;
  totalCheckItems: number;
  completeCheckItems: number;
  cardsWithoutLabels: number;
  overdueCards: number;
  cardsByList: { list: string; count: number }[];
}

export class SnapshotUnavailableError extends Error {
  constructor(board: string) {
    super(
      `No cached snapshot for board "${board}". The ${board} groomer has not ` +
        `completed a run yet, or does not call dump().`
    );
    /**
     * this project compiles to es5, where subclassing a built-in breaks the prototype chain and
     *  silently defeats `instanceof`. Restoring it here is what lets callers map this to a 503.
     */
    Object.setPrototypeOf(this, SnapshotUnavailableError.prototype);
  }
}

/** board names are interpolated into a file path, so keep them to a safe alphabet */
const SAFE_BOARD_NAME = /^[a-z0-9_-]+$/i;

export class Snapshot {
  public readonly boardId: string;
  public readonly capturedAt: Date;

  private readonly lists: { id: string; name: string; cards: ICard[] }[] = [];
  private readonly checklists: Checklist[] = [];
  private readonly labels: Record<string, string>;
  private readonly labelColors: Record<string, string>;

  /** cardId -> checklists on that card, built once up front */
  private readonly checklistsByCardId: Record<string, Checklist[]> = {};
  private readonly listNameById: Record<string, string> = {};

  constructor(raw: RawSnapshot, capturedAt: Date) {
    this.boardId = raw._id;
    this.capturedAt = capturedAt;
    this.labels = raw.labels || {};
    this.labelColors = raw.labelColors || {};

    for (const key of Object.keys(raw.lists || {})) {
      const list = raw.lists[key];
      /** lists the groomer never matched on the board come back without an id */
      if (!list || !list.id) {
        continue;
      }
      const cards = Array.isArray(list.cards) ? list.cards : [];
      this.lists.push({ id: list.id, name: list.name, cards });
      this.listNameById[list.id] = list.name;
    }

    for (const id of Object.keys(raw.checkLists || {})) {
      const checklist = raw.checkLists[id];
      if (!checklist || !checklist.id) {
        continue;
      }
      if (!Array.isArray(checklist.checkItems)) {
        checklist.checkItems = [];
      }
      this.checklists.push(checklist);
      if (this.checklistsByCardId[checklist.idCard] === undefined) {
        this.checklistsByCardId[checklist.idCard] = [];
      }
      this.checklistsByCardId[checklist.idCard].push(checklist);
    }
  }

  public get ageSeconds(): number {
    return Math.round((Date.now() - this.capturedAt.getTime()) / 1000);
  }

  public getListNamesById(): Record<string, string> {
    return this.listNameById;
  }

  public getLists(): SnapshotList[] {
    return this.lists.map((list) => ({
      id: list.id,
      name: list.name,
      cardCount: list.cards.length,
    }));
  }

  public getAllCards(): ICard[] {
    let all: ICard[] = [];
    for (const list of this.lists) {
      all = all.concat(list.cards.filter((card) => card !== undefined));
    }
    return all;
  }

  public getCardsInList(listName: string): ICard[] {
    const match = this.lists.filter(
      (list) => list.name.toLowerCase() === listName.toLowerCase()
    )[0];
    return match ? match.cards : [];
  }

  public getCardById(cardId: string): ICard | undefined {
    return this.getAllCards().filter((card) => card.id === cardId)[0];
  }

  public getChecklists(): Checklist[] {
    return this.checklists;
  }

  public getChecklistsForCardId(cardId: string): Checklist[] {
    return this.checklistsByCardId[cardId] || [];
  }

  public getChecklistById(checklistId: string): Checklist | undefined {
    return this.checklists.filter(
      (checklist) => checklist.id === checklistId
    )[0];
  }

  public getLabels(): { name: string; id: string; color: string }[] {
    return Object.keys(this.labels).map((name) => ({
      name,
      id: this.labels[name],
      color: this.labelColors[name] || null,
    }));
  }

  public getStats(): BoardStats {
    const cards = this.getAllCards();
    const now = Date.now();
    let totalCheckItems = 0;
    let completeCheckItems = 0;

    for (const checklist of this.checklists) {
      totalCheckItems += checklist.checkItems.length;
      completeCheckItems += checklist.checkItems.filter(
        (item: CheckItem) => item.state === "complete"
      ).length;
    }

    return {
      boardId: this.boardId,
      capturedAt: this.capturedAt.toISOString(),
      totalCards: cards.length,
      totalChecklists: this.checklists.length,
      totalCheckItems,
      completeCheckItems,
      cardsWithoutLabels: cards.filter(
        (card) => !card.idLabels || card.idLabels.length === 0
      ).length,
      overdueCards: cards.filter(
        (card) =>
          card.due && !card.dueComplete && new Date(card.due).getTime() < now
      ).length,
      cardsByList: this.lists.map((list) => ({
        list: list.name,
        count: list.cards.length,
      })),
    };
  }
}

export class SnapshotStore {
  private memoized: Record<string, { mtimeMs: number; snapshot: Snapshot }> = {};
  /** snapshots this process rebuilt from Trello itself — see api/refresh.ts */
  private live: Record<string, Snapshot> = {};

  constructor(private cacheDir: string) {}

  /**
   * hand the store a snapshot built in-process. It never overwrites the groomer's file on disk;
   *  reads simply prefer whichever of the two is fresher.
   */
  public setLiveSnapshot(board: string, snapshot: Snapshot): void {
    this.live[board] = snapshot;
  }

  public isValidBoardName(board: string): boolean {
    return SAFE_BOARD_NAME.test(board);
  }

  /** boards a read can currently be served for, from disk or from an in-process rebuild */
  public getAvailableBoards(): {
    board: string;
    capturedAt: string;
    ageSeconds: number;
    source: string;
  }[] {
    const result: {
      board: string;
      capturedAt: string;
      ageSeconds: number;
      source: string;
    }[] = [];
    const boards = require("../../config/boards.json");
    for (const board of Object.keys(boards)) {
      const onDisk = existsSync(this.getSnapshotPath(board));
      if (!onDisk && this.live[board] === undefined) {
        continue;
      }
      const snapshot = this.getSnapshot(board);
      result.push({
        board,
        capturedAt: snapshot.capturedAt.toISOString(),
        ageSeconds: snapshot.ageSeconds,
        source: snapshot === this.live[board] ? "trello-refresh" : "groomer-run",
      });
    }
    return result;
  }

  public getSnapshot(board: string): Snapshot {
    if (!this.isValidBoardName(board)) {
      throw new SnapshotUnavailableError(board);
    }

    const live = this.live[board];
    const fromDisk = this.readFromDisk(board);

    if (fromDisk === undefined && live === undefined) {
      throw new SnapshotUnavailableError(board);
    }
    if (fromDisk === undefined) return live;
    if (live === undefined) return fromDisk;

    /** a groomer run that lands after our rebuild is both fresher and richer, so it wins */
    return live.capturedAt > fromDisk.capturedAt ? live : fromDisk;
  }

  private readFromDisk(board: string): Snapshot | undefined {
    const path = this.getSnapshotPath(board);
    if (!existsSync(path)) {
      return undefined;
    }

    const mtimeMs = statSync(path).mtimeMs;
    const memo = this.memoized[board];
    if (memo !== undefined && memo.mtimeMs === mtimeMs) {
      return memo.snapshot;
    }

    const raw = JSON.parse(readFileSync(path, "utf8")) as RawSnapshot;
    const snapshot = new Snapshot(raw, new Date(mtimeMs));
    this.memoized[board] = { mtimeMs, snapshot };
    return snapshot;
  }

  private getSnapshotPath(board: string): string {
    return join(this.cacheDir, `model.${board}.json`);
  }
}
