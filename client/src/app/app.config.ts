import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import {
  HttpErrorResponse,
  HttpInterceptorFn,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

/**
 * The API answers an unauthenticated XHR with 401 rather than a redirect, since a redirect to
 * Trello's login cannot be followed inside an XHR. Sending the browser to the login route is
 * therefore the client's job — including when a session lapses mid-toggle.
 */
const trelloLoginInterceptor: HttpInterceptorFn = (req, next) =>
  next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        window.location.assign('/auth/trello');
      }
      return throwError(() => error);
    }),
  );

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(withInterceptors([trelloLoginInterceptor])),
  ],
};
