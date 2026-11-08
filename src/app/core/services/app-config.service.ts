import { Injectable } from '@angular/core';

/**
 * Deployment settings read at start-up from `config.json`, next to index.html, so that one build serves every host:
 *
 *   { "apiBaseUrl": "/api" }                      the AI server behind the same origin (Docker image, scripts/app.sh,
 *                                                 ng serve with proxy.conf.json); also the default without the file
 *   { "apiBaseUrl": "https://ai.example.org" }    an AI server elsewhere (it must allow this page's origin: CORS)
 *   { "apiBaseUrl": null }                        static hosting without an AI server: Explore and Benchmarks work,
 *                                                 Predict says it is not connected and sends no request
 *
 * The URL is the backend's root: /predict, /health ... are appended to it.
 */
export interface AppConfig {
  apiBaseUrl: string | null;
}

export const DEFAULT_CONFIG: AppConfig = { apiBaseUrl: '/api' };
export const CONFIG_FILE = 'config.json';

@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private config: AppConfig = DEFAULT_CONFIG;

  /** Root URL of the AI server, without a trailing slash; null when this deployment has none. */
  get apiBaseUrl(): string | null {
    return this.config.apiBaseUrl;
  }

  get apiConnected(): boolean {
    return this.config.apiBaseUrl !== null;
  }

  /** Called once before the app starts (app.config.ts). A missing or unreadable file keeps the default. */
  async load(fetchFn: typeof fetch = fetch): Promise<void> {
    let raw: unknown;
    try {
      const response = await fetchFn(CONFIG_FILE, { cache: 'no-cache' });
      if (!response.ok) {
        return;
      }
      raw = await response.json();
    } catch {
      return;
    }
    this.set(parseConfig(raw));
  }

  set(config: AppConfig): void {
    this.config = config;
  }
}

/** Validates config.json. A value that is neither null nor an http(s) URL / absolute path is treated as "no AI server":
 *  better a clear "not connected" than requests to a mistyped address. */
export function parseConfig(raw: unknown): AppConfig {
  if (!raw || typeof raw !== 'object' || !('apiBaseUrl' in raw)) {
    return DEFAULT_CONFIG;
  }
  const value = (raw as { apiBaseUrl: unknown }).apiBaseUrl;
  if (value === null) {
    return { apiBaseUrl: null };
  }
  if (typeof value === 'string') {
    const url = value.trim().replace(/\/+$/, '');
    if (/^https?:\/\/[^\s/]+(\/\S*)?$/i.test(url) || /^\/\S+$/.test(url)) {
      return { apiBaseUrl: url };
    }
  }
  console.warn(`config.json: apiBaseUrl ${JSON.stringify(value)} is not null, an http(s) URL or an absolute path; `
    + 'Predict is switched off.');
  return { apiBaseUrl: null };
}
