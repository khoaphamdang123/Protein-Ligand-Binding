import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, TimeoutError, catchError, throwError, timeout } from 'rxjs';
import {
  ApiFailure,
  DiagnosticsResponse,
  HealthResponse,
  PredictPdbRequest,
  PredictRequest,
  PredictResult,
} from '../models/prediction.model';

/** Backend base URL; the dev server proxies /api to http://127.0.0.1:8000 (proxy.conf.json). */
export const API_BASE_URL = '/api';
// Local ESMFold: seconds up to ~400 aa, ~1.5 min at 800 aa, ~3 min at 1000 aa on a shared GPU;
// API fallback: 7-25 s, retried within 110 s. Plus a few seconds of model time.
export const PREDICT_TIMEOUT_MS = 300_000;
const STATUS_TIMEOUT_MS = 15_000;

@Injectable({
  providedIn: 'root'
})
export class PredictionApiService {
  private http = inject(HttpClient);

  predict(request: PredictRequest): Observable<PredictResult> {
    return this.http.post<PredictResult>(`${API_BASE_URL}/predict`, request).pipe(
      timeout(PREDICT_TIMEOUT_MS),
      catchError(err => throwError(() => toApiFailure(err, PREDICT_TIMEOUT_MS)))
    );
  }

  predictPdb(request: PredictPdbRequest): Observable<PredictResult> {
    return this.http.post<PredictResult>(`${API_BASE_URL}/predict-pdb`, request).pipe(
      timeout(PREDICT_TIMEOUT_MS),
      catchError(err => throwError(() => toApiFailure(err, PREDICT_TIMEOUT_MS)))
    );
  }

  health(): Observable<HealthResponse> {
    return this.http.get<HealthResponse>(`${API_BASE_URL}/health`).pipe(
      timeout(STATUS_TIMEOUT_MS),
      catchError(err => throwError(() => toApiFailure(err, STATUS_TIMEOUT_MS)))
    );
  }

  diagnostics(): Observable<DiagnosticsResponse> {
    return this.http.get<DiagnosticsResponse>(`${API_BASE_URL}/diagnostics`).pipe(
      timeout(STATUS_TIMEOUT_MS),
      catchError(err => throwError(() => toApiFailure(err, STATUS_TIMEOUT_MS)))
    );
  }
}

const BACKEND_DOWN =
  'Cannot reach the prediction backend. Start it with: ' +
  'cd backend && .venv/bin/python -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000';
const PROXY_MISSING =
  'The dev server answered /api itself instead of forwarding it to the backend: it was started without ' +
  'the /api proxy. Stop it (Ctrl+C) and run `npm start` again (proxy.conf.json is set in angular.json).';

export function toApiFailure(err: unknown, timeoutMs: number): ApiFailure {
  if (err instanceof TimeoutError) {
    return {
      status: 0,
      code: 'CLIENT_TIMEOUT',
      message: `No answer from the backend within ${timeoutMs / 1000} s. The ESMFold API may be slow; try again.`
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
