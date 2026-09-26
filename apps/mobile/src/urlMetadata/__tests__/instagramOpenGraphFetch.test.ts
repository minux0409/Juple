import { fetchInstagramOpenGraphCandidate, isInstagramContentUrl, readOpenGraphValue } from '../instagramOpenGraphFetch';

const POST = 'https://www.instagram.com/p/SECRETCODE1/?igsh=SECRETIGSH';

function fakeResponse(options: { url?: string; status?: number; html?: string }): Response {
  return {
    url: options.url ?? POST,
    status: options.status ?? 200,
    headers: { get: () => 'text/html; charset=utf-8' },
    text: async () => options.html ?? '',
  } as unknown as Response;
}

const POST_HTML = [
  '<meta property="og:title" content="someone on Instagram: &quot;caf&#233; &amp; tea&quot;" />',
  '<meta content="https://scontent.cdninstagram.com/v/a.jpg?x=1&amp;y=2" property="og:image">',
  "<meta property='og:url' content='https://www.instagram.com/someone/p/SECRETCODE1/' />",
  '<meta property="og:description" content="12 likes, 3 comments - someone on September 24, 2026: &quot;x&quot;" />',
].join('');

describe('isInstagramContentUrl', () => {
  it('accepts only Instagram post/reel URLs', () => {
    expect(isInstagramContentUrl(POST)).toBe(true);
    expect(isInstagramContentUrl('https://www.instagram.com/reel/ABC/')).toBe(true);
    expect(isInstagramContentUrl('https://www.instagram.com/some_user/')).toBe(false);
    expect(isInstagramContentUrl('https://example.com/p/ABC/')).toBe(false);
  });
});

describe('readOpenGraphValue', () => {
  it('reads the raw, entity-decoded content regardless of attribute order or quote style', () => {
    expect(readOpenGraphValue(POST_HTML, 'og:title')).toBe('someone on Instagram: "café & tea"');
    expect(readOpenGraphValue(POST_HTML, 'og:image')).toBe('https://scontent.cdninstagram.com/v/a.jpg?x=1&y=2');
    expect(readOpenGraphValue(POST_HTML, 'og:url')).toBe('https://www.instagram.com/someone/p/SECRETCODE1/');
    expect(readOpenGraphValue('<meta property="og:title" content="   " />', 'og:title')).toBeNull();
    expect(readOpenGraphValue('<title>Instagram</title>', 'og:title')).toBeNull();
  });
});

describe('fetchInstagramOpenGraphCandidate', () => {
  it('does one anonymous GET (no cookies, only Accept: text/html) and returns the raw candidate', async () => {
    const fetchImpl = jest.fn(async () => fakeResponse({ html: POST_HTML }));

    const result = await fetchInstagramOpenGraphCandidate(POST, fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = (fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', headers: { Accept: 'text/html' } });
    expect(Object.keys(init.headers as Record<string, string>)).toEqual(['Accept']);
    expect(result).toEqual({
      outcome: 'candidate',
      candidate: {
        ogTitle: 'someone on Instagram: "café & tea"',
        ogImage: 'https://scontent.cdninstagram.com/v/a.jpg?x=1&y=2',
        ogUrl: 'https://www.instagram.com/someone/p/SECRETCODE1/',
        ogDescription: '12 likes, 3 comments - someone on September 24, 2026: "x"',
      },
    });
  });

  it('treats a redirect to /accounts/login as no candidate, without parsing', async () => {
    const fetchImpl = jest.fn(async () => fakeResponse({ url: 'https://www.instagram.com/accounts/login/?next=%2Fp%2F', html: POST_HTML }));

    expect(await fetchInstagramOpenGraphCandidate(POST, fetchImpl as unknown as typeof fetch)).toEqual({ outcome: 'loginRedirect', candidate: null });
  });

  it('returns no candidate for a page without og:title/og:image, or a non-2xx status', async () => {
    const shell = jest.fn(async () => fakeResponse({ html: '<title>Instagram</title>' }));
    const notFound = jest.fn(async () => fakeResponse({ status: 404, html: POST_HTML }));

    expect(await fetchInstagramOpenGraphCandidate(POST, shell as unknown as typeof fetch)).toEqual({ outcome: 'noMetadata', candidate: null });
    expect(await fetchInstagramOpenGraphCandidate(POST, notFound as unknown as typeof fetch)).toEqual({ outcome: 'httpError', candidate: null });
  });

  it('never throws on a network failure', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });

    expect(await fetchInstagramOpenGraphCandidate(POST, fetchImpl as unknown as typeof fetch)).toEqual({ outcome: 'network', candidate: null });
  });

  it('never fetches a non-Instagram or non-post URL', async () => {
    const fetchImpl = jest.fn();

    await fetchInstagramOpenGraphCandidate('https://example.com/p/ABC/', fetchImpl as unknown as typeof fetch);
    await fetchInstagramOpenGraphCandidate('https://www.instagram.com/some_user/', fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
