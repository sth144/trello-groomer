import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export type CheckItemState = 'complete' | 'incomplete';

export interface ViewCheckItem {
  id: string;
  name: string;
  state: CheckItemState;
}

export interface ViewChecklist {
  id: string;
  name: string;
  /** Trello keys the toggle write off the card, so every checklist carries its card id */
  cardId: string;
  total: number;
  complete: number;
  checkItems: ViewCheckItem[];
}

export interface ViewCard {
  id: string;
  name: string;
  due: string | null;
  listName: string | null;
  shortUrl: string | null;
}

export interface View {
  key: string;
  label: string;
  card: ViewCard | null;
  checklists: ViewChecklist[];
  capturedAt: string;
  ageSeconds: number;
}

export interface Identity {
  authEnabled: boolean;
  user: { id: string; username: string; displayName: string } | null;
}

@Injectable({ providedIn: 'root' })
export class ChecklistsService {
  private http = inject(HttpClient);

  getViews(): Observable<View[]> {
    return this.http.get<View[]>('/api/views');
  }

  getIdentity(): Observable<Identity> {
    return this.http.get<Identity>('/api/me');
  }

  /**
   * rebuild the board from Trello rather than reading the groomer's last snapshot. Slow — around a
   * dozen sequential Trello requests — so it is only ever triggered by hand.
   */
  pullFromTrello(board = 'todo'): Observable<{ cards: number }> {
    return this.http.post<{ cards: number }>(`/api/refresh/${board}`, {});
  }

  setCheckItemState(
    cardId: string,
    checkItemId: string,
    state: CheckItemState,
  ): Observable<ViewCheckItem> {
    return this.http.put<ViewCheckItem>(
      `/api/cards/${cardId}/checkItem/${checkItemId}`,
      { state },
    );
  }
}
