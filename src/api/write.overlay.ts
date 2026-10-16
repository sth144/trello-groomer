import { CheckItem, Checklist } from "../lib/checklist.interface";

/*************************************************************************************************
 * Reads are served from a snapshot that is only as fresh as the last groomer run (5 min for the  *
 *  ToDo board). Writes go straight to Trello, so without help a client would tick a box and then *
 *  see it spring back on the next poll.                                                         *
 *                                                                                               *
 * This overlay records every write the API has successfully relayed and replays it on top of     *
 *  snapshot reads. An entry retires as soon as a snapshot captured *after* the write lands —     *
 *  at that point Trello's own state is authoritative and already reflected.                     *
 *************************************************************************************************/

interface StateEntry {
  state: string;
  at: number;
}

interface NameEntry {
  name: string;
  at: number;
}

interface AddedEntry {
  item: CheckItem;
  at: number;
}

export class WriteOverlay {
  /** checkItemId -> most recent state we relayed */
  private states: Record<string, StateEntry> = {};
  /** checkItemId -> most recent name we relayed */
  private names: Record<string, NameEntry> = {};
  /** checklistId -> items we created that the snapshot may not know about */
  private added: Record<string, AddedEntry[]> = {};
  /** checkItemId -> when we deleted it */
  private removed: Record<string, number> = {};

  constructor(private now: () => number = Date.now) {}

  public recordStateChange(checkItemId: string, state: string): void {
    this.states[checkItemId] = { state, at: this.now() };
  }

  public recordRename(checkItemId: string, name: string): void {
    this.names[checkItemId] = { name, at: this.now() };
  }

  public recordAdd(checklistId: string, item: CheckItem): void {
    if (this.added[checklistId] === undefined) {
      this.added[checklistId] = [];
    }
    this.added[checklistId].push({ item, at: this.now() });
  }

  public recordRemove(checkItemId: string): void {
    this.removed[checkItemId] = this.now();
    delete this.states[checkItemId];
    delete this.names[checkItemId];
    for (const checklistId of Object.keys(this.added)) {
      this.added[checklistId] = this.added[checklistId].filter(
        (entry) => entry.item.id !== checkItemId
      );
    }
  }

  /**
   * returns a copy of `checklist` with pending writes applied. Entries older than the snapshot are
   *  dropped, since the snapshot already reflects them.
   */
  public apply(checklist: Checklist, snapshotCapturedAt: Date): Checklist {
    const capturedAtMs = snapshotCapturedAt.getTime();

    const items: CheckItem[] = [];
    for (const item of checklist.checkItems) {
      const removedAt = this.removed[item.id];
      if (removedAt !== undefined && removedAt > capturedAtMs) {
        continue;
      }
      items.push(this.withPendingEdits(item, capturedAtMs));
    }

    const pendingAdds = this.added[checklist.id] || [];
    for (const entry of pendingAdds) {
      if (entry.at <= capturedAtMs) {
        continue;
      }
      /** skip anything the snapshot already picked up */
      if (items.some((item) => item.id === entry.item.id)) {
        continue;
      }
      /**
       * an item can be created and then toggled or renamed before any snapshot has seen it, so
       *  its pending edits have to win over what it was created with.
       */
      items.push(this.withPendingEdits(entry.item, capturedAtMs));
    }

    return {
      id: checklist.id,
      name: checklist.name,
      idCard: checklist.idCard,
      checkItems: items,
    };
  }

  /** a copy of `item` with any state or name relayed after the snapshot laid over it */
  private withPendingEdits(item: CheckItem, capturedAtMs: number): CheckItem {
    const pendingState = this.states[item.id];
    const pendingName = this.names[item.id];
    return {
      id: item.id,
      idChecklist: item.idChecklist,
      name:
        pendingName !== undefined && pendingName.at > capturedAtMs
          ? pendingName.name
          : item.name,
      state:
        pendingState !== undefined && pendingState.at > capturedAtMs
          ? pendingState.state
          : item.state,
    };
  }

  /** drop entries the given snapshot has already absorbed, so the overlay does not grow forever */
  public prune(snapshotCapturedAt: Date): void {
    const capturedAtMs = snapshotCapturedAt.getTime();

    for (const id of Object.keys(this.states)) {
      if (this.states[id].at <= capturedAtMs) {
        delete this.states[id];
      }
    }
    for (const id of Object.keys(this.names)) {
      if (this.names[id].at <= capturedAtMs) {
        delete this.names[id];
      }
    }
    for (const id of Object.keys(this.removed)) {
      if (this.removed[id] <= capturedAtMs) {
        delete this.removed[id];
      }
    }
    for (const checklistId of Object.keys(this.added)) {
      const survivors = this.added[checklistId].filter(
        (entry) => entry.at > capturedAtMs
      );
      if (survivors.length === 0) {
        delete this.added[checklistId];
      } else {
        this.added[checklistId] = survivors;
      }
    }
  }

  public get size(): number {
    return (
      Object.keys(this.states).length +
      Object.keys(this.names).length +
      Object.keys(this.removed).length +
      Object.keys(this.added).length
    );
  }
}
