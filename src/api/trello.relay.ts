import { TrelloHttpClient } from "../lib/http.client";
import { CheckItem } from "../lib/checklist.interface";
import { WriteOverlay } from "./write.overlay";
import { logger } from "../lib/logger";

/*************************************************************************************************
 * Write side of the API. Every mutation is relayed to Trello (Trello stays the source of truth), *
 *  then recorded in the overlay so snapshot-backed reads reflect it immediately.                 *
 *************************************************************************************************/

export const CHECK_ITEM_STATES = ["complete", "incomplete"];

export class TrelloRelayError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 502
  ) {
    super(message);
    /** es5 downlevelling breaks `instanceof` on Error subclasses — see snapshot.store.ts */
    Object.setPrototypeOf(this, TrelloRelayError.prototype);
  }
}

/**
 * TrelloHttpClient resolves off the `request` callback and leaves the promise pending when a
 *  response arrives with no body. That is survivable in a cron job but would hang an HTTP request,
 *  so every relayed call is bounded here.
 */
function withTimeout<T>(work: Promise<T>, label: string, ms = 30000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TrelloRelayError(`Trello ${label} timed out after ${ms}ms`, 504));
    }, ms);

    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(
          err instanceof TrelloRelayError
            ? err
            : new TrelloRelayError(`Trello ${label} failed: ${err}`)
        );
      }
    );
  });
}

export class TrelloRelay {
  private httpClient: TrelloHttpClient;

  constructor(
    secrets: { key: string; token: string },
    private overlay: WriteOverlay
  ) {
    this.httpClient = new TrelloHttpClient(secrets);
  }

  public get numRequests(): number {
    return this.httpClient.NumRequests;
  }

  /**
   * toggle a check item. Trello keys this write off the *card*, not the checklist, which is why
   *  callers have to supply both ids.
   */
  public async setCheckItemState(
    cardId: string,
    checkItemId: string,
    state: string
  ): Promise<CheckItem> {
    if (CHECK_ITEM_STATES.indexOf(state) === -1) {
      throw new TrelloRelayError(
        `state must be one of ${CHECK_ITEM_STATES.join(", ")}`,
        400
      );
    }

    logger.info(`Relaying checkItem ${checkItemId} -> ${state}`);
    const response = await withTimeout(
      this.httpClient.asyncPut(
        `/cards/${cardId}/checkItem/${checkItemId}?state=${state}`
      ),
      `PUT checkItem ${checkItemId}`
    );

    this.assertNotTrelloError(response, `toggle check item ${checkItemId}`);
    this.overlay.recordStateChange(checkItemId, state);

    return {
      id: checkItemId,
      idChecklist: (response && response.idChecklist) || "",
      name: (response && response.name) || "",
      state,
    };
  }

  public async addCheckItem(
    checklistId: string,
    name: string,
    pos: string = "bottom"
  ): Promise<CheckItem> {
    if (!name || !name.trim()) {
      throw new TrelloRelayError("name is required", 400);
    }

    logger.info(`Relaying new checkItem "${name}" -> checklist ${checklistId}`);
    const response = await withTimeout(
      this.httpClient.asyncPost(`/checklists/${checklistId}/checkItems`, {
        name: name.trim(),
        pos,
      }),
      `POST checkItem to ${checklistId}`
    );

    this.assertNotTrelloError(response, `add check item to ${checklistId}`);
    if (!response || !response.id) {
      throw new TrelloRelayError("Trello did not return the created check item");
    }

    const created: CheckItem = {
      id: response.id,
      idChecklist: checklistId,
      name: response.name,
      state: response.state || "incomplete",
    };
    this.overlay.recordAdd(checklistId, created);
    return created;
  }

  public async removeCheckItem(
    checklistId: string,
    checkItemId: string
  ): Promise<void> {
    logger.info(`Relaying delete of checkItem ${checkItemId}`);
    const response = await withTimeout(
      this.httpClient.asyncDelete(
        `/checklists/${checklistId}/checkItems/${checkItemId}/`
      ),
      `DELETE checkItem ${checkItemId}`
    );

    this.assertNotTrelloError(response, `delete check item ${checkItemId}`);
    this.overlay.recordRemove(checkItemId);
  }

  /**
   * Trello answers a rejected write with a plain-text body ("invalid id", "unauthorized", ...)
   *  rather than a JSON error, and TrelloHttpClient passes that straight through.
   */
  private assertNotTrelloError(response: any, action: string): void {
    if (typeof response !== "string") {
      return;
    }
    const body = response.trim();
    if (body.length === 0) {
      return;
    }
    throw new TrelloRelayError(`Could not ${action}: ${body}`);
  }
}
