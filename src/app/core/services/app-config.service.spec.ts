import { AppConfigService, DEFAULT_CONFIG, parseConfig } from './app-config.service';

const answer = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('parseConfig', () => {
  it('keeps the same-origin default without a usable file', () => {
    expect(parseConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(parseConfig({})).toEqual(DEFAULT_CONFIG);
    expect(parseConfig('x')).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG.apiBaseUrl).toBe('/api');
  });

  it('reads null as "no AI server"', () => {
    expect(parseConfig({ apiBaseUrl: null })).toEqual({ apiBaseUrl: null });
  });

  it('accepts http(s) URLs and absolute paths, without trailing slashes', () => {
    expect(parseConfig({ apiBaseUrl: 'https://ai.example.org/' })).toEqual({ apiBaseUrl: 'https://ai.example.org' });
    expect(parseConfig({ apiBaseUrl: ' http://10.0.0.5:8000 ' })).toEqual({ apiBaseUrl: 'http://10.0.0.5:8000' });
    expect(parseConfig({ apiBaseUrl: 'https://x.ts.net/api' })).toEqual({ apiBaseUrl: 'https://x.ts.net/api' });
    expect(parseConfig({ apiBaseUrl: '/api' })).toEqual({ apiBaseUrl: '/api' });
  });

  it('switches Predict off on a value it cannot use, rather than calling a wrong address', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const bad of ['', '/', 'ai.example.org', 'ftp://x', 42, true, { url: 'x' }]) {
      expect(parseConfig({ apiBaseUrl: bad })).toEqual({ apiBaseUrl: null });
    }
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('AppConfigService.load', () => {
  it('uses config.json when it is there', async () => {
    const config = new AppConfigService();
    await config.load(answer(200, { apiBaseUrl: null }));
    expect(config.apiConnected).toBe(false);
    expect(config.apiBaseUrl).toBeNull();
  });

  it('keeps the default when the file is missing, unreadable or the fetch fails', async () => {
    for (const fetchFn of [
      answer(404, {}),
      (async () => new Response('not json', { status: 200 })) as unknown as typeof fetch,
      (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch,
    ]) {
      const config = new AppConfigService();
      await config.load(fetchFn);
      expect(config.apiBaseUrl).toBe('/api');
      expect(config.apiConnected).toBe(true);
    }
  });

  it('asks for config.json next to index.html, not from a cache', async () => {
    const calls: [unknown, unknown][] = [];
    const config = new AppConfigService();
    await config.load((async (url: unknown, init: unknown) => {
      calls.push([url, init]);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch);
    expect(calls).toEqual([['config.json', { cache: 'no-cache' }]]);
  });
});
