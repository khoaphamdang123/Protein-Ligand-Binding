import { TestBed } from '@angular/core/testing';
import { AppConfigService } from './app-config.service';
import { ErrorReporterService } from './error-reporter.service';

describe('ErrorReporterService', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('sends UI errors to the AI server log', () => {
    TestBed.inject(AppConfigService).set({ apiBaseUrl: 'https://ai.example.org' });
    TestBed.inject(ErrorReporterService).report('error', 'boom', 'test');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://ai.example.org/client-log');
  });

  it('sends nothing without an AI server', () => {
    TestBed.inject(AppConfigService).set({ apiBaseUrl: null });
    TestBed.inject(ErrorReporterService).report('error', 'boom', 'test');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
