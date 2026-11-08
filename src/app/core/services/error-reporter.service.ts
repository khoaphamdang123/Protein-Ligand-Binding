import { ErrorHandler, Injectable, inject } from '@angular/core';
import { AppConfigService } from './app-config.service';

export type ClientLogLevel = 'error' | 'warning' | 'info';

/**
 * Sends browser-side errors to the backend log (POST <apiBaseUrl>/client-log), so every failure -
 * backend or UI - ends up in backend/logs/backend.log. Best effort: never throws.
 */
@Injectable({
  providedIn: 'root'
})
export class ErrorReporterService {
  private static readonly MAX_REPORTS = 100;   // per page load, against error loops
  private config = inject(AppConfigService);
  private sent = 0;
  private lastKey = '';

  report(level: ClientLogLevel, message: string, source: string, error?: unknown, context?: Record<string, unknown>): void {
    const key = `${level}|${source}|${message}`;
    if (key === this.lastKey || this.sent >= ErrorReporterService.MAX_REPORTS) {
      return;
    }
    this.lastKey = key;
    this.sent++;

    const api = this.config.apiBaseUrl;
    if (api === null) {
      return;   // static hosting without an AI server: the error stays in the browser console
    }
    const stack = error instanceof Error ? error.stack : undefined;
    const body = JSON.stringify({ level, message, source, url: location.href, stack, context });
    try {
      fetch(`${api}/client-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      }).catch(() => { /* backend down: the error is still in the browser console */ });
    } catch {
      // fetch unavailable
    }
  }

  /** Errors raised outside Angular's zone (e.g. WebGL / NGL callbacks). */
  installWindowListeners(): void {
    window.addEventListener('error', event => {
      this.report('error', event.message || 'Window error', 'window', event.error, {
        file: event.filename, line: event.lineno, column: event.colno
      });
    });
    window.addEventListener('unhandledrejection', event => {
      this.report('error', `Unhandled promise rejection: ${describeError(event.reason)}`, 'window', event.reason);
    });
  }
}

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private reporter = inject(ErrorReporterService);

  handleError(error: unknown): void {
    console.error(error);
    this.reporter.report('error', describeError(error), 'angular', error);
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return typeof error === 'string' ? error : JSON.stringify(error) ?? String(error);
}
