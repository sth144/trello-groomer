import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import {
  CheckItemState,
  ChecklistsService,
  Identity,
  View,
  ViewCheckItem,
} from './checklists.service';

const REFRESH_MS = 60_000;
const LOGIN_URL = '/auth/trello';

@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnDestroy {
  private api = inject(ChecklistsService);

  views = signal<View[]>([]);
  loading = signal(true);
  /** a rebuild straight from Trello is in flight */
  pulling = signal(false);
  error = signal<string | null>(null);
  /** check items with a write in flight */
  pending = signal<ReadonlySet<string>>(new Set());
  /**
   * states applied locally but not yet confirmed by Trello. An item renders from here while it
   * settles, but keeps its confirmed position in the list until the write lands.
   */
  optimistic = signal<Readonly<Record<string, CheckItemState>>>({});

  /** items still to do across all three lists — the one number worth reading at a glance */
  remaining = computed(() =>
    this.views()
      .flatMap((view) => view.checklists)
      .flatMap((checklist) => checklist.checkItems)
      .filter((item) => this.stateOf(item) === 'incomplete').length,
  );

  oldestSnapshotSeconds = computed(() => {
    const ages = this.views().map((view) => view.ageSeconds);
    return ages.length ? Math.max(...ages) : null;
  });

  identity = signal<Identity | null>(null);

  private timer = setInterval(() => this.refresh(), REFRESH_MS);

  constructor() {
    this.refresh();
    this.api.getIdentity().subscribe({
      next: (identity) => this.identity.set(identity),
      error: () => this.identity.set(null),
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  refresh(): void {
    this.api.getViews().subscribe({
      next: (views) => {
        this.views.set(views);
        this.loading.set(false);
        this.error.set(null);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(
          err.status === 503
            ? 'No snapshot yet. The groomer has not finished a run.'
            : 'Could not reach the groomer API.',
        );
      },
    });
  }

  /**
   * skip the snapshot and rebuild from Trello. Takes tens of seconds, so the button stays disabled
   * and says so for the duration.
   */
  pullFromTrello(): void {
    if (this.pulling()) return;

    this.pulling.set(true);
    this.error.set(null);
    this.api.pullFromTrello().subscribe({
      next: () => {
        this.pulling.set(false);
        this.refresh();
      },
      error: () => {
        this.pulling.set(false);
        this.error.set('Could not reach Trello. Still showing the last snapshot.');
      },
    });
  }

  /** the state to render: optimistic if there is one, otherwise what Trello last told us */
  stateOf(item: ViewCheckItem): CheckItemState {
    return this.optimistic()[item.id] ?? item.state;
  }

  isPending(item: ViewCheckItem): boolean {
    return this.pending().has(item.id);
  }

  /**
   * items sorted the way the groomer sorts them — incomplete first. Ordering keys off the
   * *confirmed* state, so a freshly ticked item strikes through in place and only drops to the
   * bottom once Trello has accepted the write.
   */
  orderedItems(checklist: { checkItems: ViewCheckItem[] }): ViewCheckItem[] {
    return [...checklist.checkItems].sort((a, b) => {
      if (a.state === b.state) return 0;
      return a.state === 'incomplete' ? -1 : 1;
    });
  }

  completeCount(checklist: { checkItems: ViewCheckItem[] }): number {
    return checklist.checkItems.filter(
      (item) => this.stateOf(item) === 'complete',
    ).length;
  }

  progressPercent(checklist: { checkItems: ViewCheckItem[] }): number {
    if (!checklist.checkItems.length) return 0;
    return Math.round(
      (this.completeCount(checklist) / checklist.checkItems.length) * 100,
    );
  }

  toggle(cardId: string, item: ViewCheckItem): void {
    if (this.isPending(item)) return;

    const next: CheckItemState =
      this.stateOf(item) === 'complete' ? 'incomplete' : 'complete';

    this.setOptimistic(item.id, next);
    this.setPending(item.id, true);

    this.api.setCheckItemState(cardId, item.id, next).subscribe({
      next: () => {
        /** promote to confirmed, which is what lets the item move */
        this.views.update((views) =>
          views.map((view) => ({
            ...view,
            checklists: view.checklists.map((checklist) => ({
              ...checklist,
              checkItems: checklist.checkItems.map((existing) =>
                existing.id === item.id
                  ? { ...existing, state: next }
                  : existing,
              ),
            })),
          })),
        );
        this.clearOptimistic(item.id);
        this.setPending(item.id, false);
        this.error.set(null);
      },
      error: () => {
        this.clearOptimistic(item.id);
        this.setPending(item.id, false);
        this.error.set(`Trello rejected that change. Reverted "${item.name}".`);
      },
    });
  }

  freshness(seconds: number | null): string {
    if (seconds === null) return '';
    if (seconds < 90) return `${seconds}s old`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 90) return `${minutes} min old`;
    const hours = Math.round(minutes / 60);
    if (hours < 36) return `${hours} h old`;
    return `${Math.round(hours / 24)} d old`;
  }

  dueLabel(due: string | null): string | null {
    if (!due) return null;
    return new Date(due).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }

  private setOptimistic(id: string, state: CheckItemState): void {
    this.optimistic.update((current) => ({ ...current, [id]: state }));
  }

  private clearOptimistic(id: string): void {
    this.optimistic.update((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  private setPending(id: string, isPending: boolean): void {
    this.pending.update((current) => {
      const next = new Set(current);
      if (isPending) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }
}
