import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TimeoutError } from 'rxjs';
import { ApiFailure, PredictResult } from '../models/prediction.model';
import { AppConfigService } from './app-config.service';
import { NOT_CONNECTED, PredictionApiService, toApiFailure } from './prediction-api.service';

describe('toApiFailure', () => {
  it('uses the backend JSON error body', () => {
    const err = new HttpErrorResponse({
      status: 502,
      error: { detail: 'ESMFold API timed out', code: 'ESMFOLD_FAILED', request_id: 'ab12cd34' }
    });
    expect(toApiFailure(err, 1000)).toEqual({
      status: 502, code: 'ESMFOLD_FAILED', message: 'ESMFold API timed out', requestId: 'ab12cd34'
    });
  });

  it('treats a network error as backend unreachable', () => {
    const failure = toApiFailure(new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') }), 1000);
    expect(failure.code).toBe('BACKEND_UNREACHABLE');
    expect(failure.message).toContain('scripts/app.sh start');
  });

  it('treats a 5xx without JSON body (dev proxy, backend down) as backend unreachable', () => {
    expect(toApiFailure(new HttpErrorResponse({ status: 500, error: '' }), 1000).code).toBe('BACKEND_UNREACHABLE');
    expect(toApiFailure(new HttpErrorResponse({ status: 504, error: '<html>' }), 1000).code).toBe('BACKEND_UNREACHABLE');
  });

  it('detects a dev server running without the /api proxy', () => {
    // GET falls back to index.html (200 that cannot be parsed as JSON); POST gets a 404.
    const html = new HttpErrorResponse({ status: 200, error: { error: new SyntaxError('JSON'), text: '<!doctype html>' } });
    expect(toApiFailure(html, 1000).code).toBe('PROXY_MISSING');
    expect(toApiFailure(new HttpErrorResponse({ status: 404, error: '' }), 1000).code).toBe('PROXY_MISSING');
    expect(toApiFailure(html, 1000).message).toContain('npm start');
  });

  it('keeps other non-JSON errors as HTTP_<status>', () => {
    expect(toApiFailure(new HttpErrorResponse({ status: 403, error: 'Forbidden', url: '/api/x' }), 1000).code).toBe('HTTP_403');
  });

  it('reports client-side timeouts', () => {
    const failure = toApiFailure(new TimeoutError(), 120_000);
    expect(failure).toMatchObject({ status: 0, code: 'CLIENT_TIMEOUT' });
    expect(failure.message).toContain('120 s');
  });

  it('wraps anything else', () => {
    expect(toApiFailure(new Error('boom'), 1000)).toEqual({ status: 0, code: 'UNKNOWN_ERROR', message: 'boom' });
  });
});

describe('PredictionApiService', () => {
  let service: PredictionApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(PredictionApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('posts the contract body to /api/predict', () => {
    let result: PredictResult | undefined;
    service.predict({ sequence: 'MKV', binding_type: 'metal' }).subscribe(r => (result = r));
    const req = http.expectOne('/api/predict');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ sequence: 'MKV', binding_type: 'metal' });
    req.flush({ length: 3 });
    expect(result).toEqual({ length: 3 } as unknown as PredictResult);
  });

  it('maps backend errors to ApiFailure', () => {
    let failure: ApiFailure | undefined;
    service.predict({ sequence: 'MKV', binding_type: 'small' }).subscribe({ error: f => (failure = f) });
    http.expectOne('/api/predict').flush(
      { detail: 'Sequence has 3 residues; the minimum is 30.', code: 'SEQUENCE_INVALID', request_id: 'r1' },
      { status: 400, statusText: 'Bad Request' }
    );
    expect(failure).toEqual({
      status: 400, code: 'SEQUENCE_INVALID', message: 'Sequence has 3 residues; the minimum is 30.', requestId: 'r1'
    });
  });

  it('reads /api/health and /api/diagnostics', () => {
    service.health().subscribe();
    service.diagnostics().subscribe();
    http.expectOne('/api/health').flush({});
    http.expectOne('/api/diagnostics').flush({});
  });

  it('calls an AI server elsewhere when config.json says so', () => {
    TestBed.inject(AppConfigService).set({ apiBaseUrl: 'https://ai.example.org' });
    service.predict({ sequence: 'MKV', binding_type: 'rna' }).subscribe();
    service.compare({ sequence: 'MKV', pdb: 'ATOM', binding_type: 'rna' }).subscribe();
    service.health().subscribe();
    http.expectOne('https://ai.example.org/predict').flush({});
    http.expectOne('https://ai.example.org/compare').flush({});
    http.expectOne('https://ai.example.org/health').flush({});
  });

  it('sends nothing without an AI server (static hosting)', () => {
    TestBed.inject(AppConfigService).set({ apiBaseUrl: null });
    expect(service.connected).toBe(false);
    const failures: ApiFailure[] = [];
    service.predict({ sequence: 'MKV', binding_type: 'metal' }).subscribe({ error: f => failures.push(f) });
    service.predictPdb({ pdb: 'ATOM', binding_type: 'metal' }).subscribe({ error: f => failures.push(f) });
    service.compare({ sequence: 'MKV', pdb: 'ATOM', binding_type: 'metal' }).subscribe({ error: f => failures.push(f) });
    service.health().subscribe({ error: f => failures.push(f) });
    service.diagnostics().subscribe({ error: f => failures.push(f) });
    http.expectNone(() => true);
    expect(failures.map(f => f.code)).toEqual(Array(5).fill('API_NOT_CONFIGURED'));
    expect(failures[0].message).toBe(NOT_CONNECTED);
  });
});
