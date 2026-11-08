import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, TimeoutError, catchError, map, throwError, timeout } from 'rxjs';
import { AppConfigService } from './app-config.service';
import {
  ApiFailure,
  CompareRequest,
  CompareResult,
  DiagnosticsResponse,
  FoldingStatus,
  HealthResponse,
  PredictPdbRequest,
  PredictRequest,
  PredictResult,
} from '../models/prediction.model';

// Local ESMFold on a GPU: seconds up to ~400 aa, ~1.5 min at 800 aa, ~3 min at 1000 aa, within the request;
// on the CPU it folds in the background and the request is answered at once (202, see predict()).
// API fallback: 7-25 s, retried within 110 s. Plus a few seconds of model time.
export const PREDICT_TIMEOUT_MS = 300_000;
const STATUS_TIMEOUT_MS = 15_000;

@Injectable({
  providedIn: 'root'
})
export class PredictionApiService {
  private http = inject(HttpClient);
  private config = inject(AppConfigService);

  /** False on static hosting without an AI server (config.json apiBaseUrl null): no request may be sent then. */
  get connected(): boolean {
    return this.config.apiConnected;
  }

  /** `${apiBaseUrl}${path}`, e.g. /api/predict (same origin) or https://ai.example.org/predict. */
  private url(path: string): string {
    return `${this.config.apiBaseUrl ?? ''}${path}`;
  }

  /** Any call while no AI server is configured fails at once, without touching the network. */
  private guard<T>(call: () => Observable<T>): Observable<T> {
    return this.connected ? call() : throwError(() => ({ status: 0, code: 'API_NOT_CONFIGURED', message: NOT_CONNECTED } satisfies ApiFailure));
  }

  /** Errors with an ApiFailure; code STRUCTURE_FOLDING (HTTP 202) means "still folding on the CPU, ask again". */
  predict(request: PredictRequest): Observable<PredictResult> {
    return this.guard(() => this.http.post<PredictResult | FoldingAnswer>(this.url('/predict'), request).pipe(
      map(body => {
        if (isFolding(body)) {
          throw { status: 202, code: body.code, message: body.detail, requestId: body.request_id,
                  folding: body.folding } satisfies ApiFailure;
        }
        return body;
      }),
      timeout(PREDICT_TIMEOUT_MS),
      catchError(err => throwError(() => isApiFailure(err) ? err : toApiFailure(err, PREDICT_TIMEOUT_MS)))
    ));
  }

  predictPdb(request: PredictPdbRequest): Observable<PredictResult> {
    return this.guard(() => this.http.post<PredictResult>(this.url('/predict-pdb'), request).pipe(
      timeout(PREDICT_TIMEOUT_MS),
      catchError(err => throwError(() => toApiFailure(err, PREDICT_TIMEOUT_MS)))
    ));
  }

  compare(request: CompareRequest): Observable<CompareResult> {
    return this.guard(() => this.http.post<CompareResult>(this.url('/compare'), request).pipe(
      timeout(PREDICT_TIMEOUT_MS),
      catchError(err => throwError(() => toApiFailure(err, PREDICT_TIMEOUT_MS)))
    ));
  }

  health(): Observable<HealthResponse> {
    return this.guard(() => this.http.get<HealthResponse>(this.url('/health')).pipe(
      timeout(STATUS_TIMEOUT_MS),
      catchError(err => throwError(() => toApiFailure(err, STATUS_TIMEOUT_MS, '')))
    ));
  }

  diagnostics(): Observable<DiagnosticsResponse> {
    return this.guard(() => this.http.get<DiagnosticsResponse>(this.url('/diagnostics')).pipe(
      timeout(STATUS_TIMEOUT_MS),
      catchError(err => throwError(() => toApiFailure(err, STATUS_TIMEOUT_MS, '')))
    ));
  }
}

const BACKEND_DOWN =
  'Cannot reach the AI server (apiBaseUrl in config.json). Is it running (on its machine: bash scripts/app.sh start), ' +
  'and, if it is on another site, does it allow this one (BINDSITE_CORS_ORIGINS)?';
const PROXY_MISSING =
  'The address in config.json (apiBaseUrl) answers, but not as the AI server: a wrong address, or no /api proxy in ' +
  'front of the backend (with ng serve: restart npm start, proxy.conf.json is set in angular.json).';
/** Static hosting without an AI server (config.json: "apiBaseUrl": null). */
export const NOT_CONNECTED =
  'Predict runs on the AI server, and this site is not connected to one. Explore and Benchmarks work without it.';

const TIMEOUT_ADVICE = ' Try again, or upload a PDB so that no folding is needed.';

interface FoldingAnswer {
  code: 'STRUCTURE_FOLDING';
  detail: string;
  request_id?: string;
  folding: FoldingStatus;
}

function isFolding(body: unknown): body is FoldingAnswer {
  return !!body && typeof body === 'object' && (body as FoldingAnswer).code === 'STRUCTURE_FOLDING';
}

function isApiFailure(err: unknown): err is ApiFailure {
  return !!err && typeof err === 'object' && 'code' in err && 'message' in err && 'status' in err
    && !(err instanceof HttpErrorResponse);
}

export function toApiFailure(err: unknown, timeoutMs: number, advice = TIMEOUT_ADVICE): ApiFailure {
  if (err instanceof TimeoutError) {
    return {
      status: 0,
      code: 'CLIENT_TIMEOUT',
      message: `No answer from the backend within ${timeoutMs / 1000} s.${advice}`
    };
  }
  if (err instanceof HttpErrorResponse) {
    const body = err.error;
    if (body && typeof body === 'object' && 'detail' in body) {
      return {
        status: err.status,
        code: body.code ?? `HTTP_${err.status}`,
        message: String(body.detail),
        requestId: body.request_id
      };
    }
    // No JSON body: the request never reached FastAPI (network down, or the dev proxy
    // answering 5xx because nothing listens on port 8000).
    if (err.status === 0 || err.status >= 500) {
      return { status: err.status, code: 'BACKEND_UNREACHABLE', message: BACKEND_DOWN };
    }
    // index.html (200, unparsable as JSON) or 404: no /api proxy in front of the backend.
    if (err.status === 200 || err.status === 404) {
      return { status: err.status, code: 'PROXY_MISSING', message: PROXY_MISSING };
    }
    return { status: err.status, code: `HTTP_${err.status}`, message: err.message };
  }
  return { status: 0, code: 'UNKNOWN_ERROR', message: err instanceof Error ? err.message : String(err) };
}
