import { decodeIdTokenClaims, extractEmailClaim } from '../idTokenClaims';

// No Buffer/atob dependency here either - mirrors the production decoder's own "no assumed
// global" approach (see idTokenClaims.ts) by hand-encoding base64url fixtures with plain JS.
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toUtf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const codepoint = char.codePointAt(0)!;
    if (codepoint < 0x80) {
      bytes.push(codepoint);
    } else if (codepoint < 0x800) {
      bytes.push(0xc0 | (codepoint >> 6), 0x80 | (codepoint & 0x3f));
    } else if (codepoint < 0x10000) {
      bytes.push(0xe0 | (codepoint >> 12), 0x80 | ((codepoint >> 6) & 0x3f), 0x80 | (codepoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codepoint >> 18),
        0x80 | ((codepoint >> 12) & 0x3f),
        0x80 | ((codepoint >> 6) & 0x3f),
        0x80 | (codepoint & 0x3f),
      );
    }
  }
  return bytes;
}

function encodeBase64Url(text: string): string {
  const bytes = toUtf8Bytes(text);
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const [b0, b1, b2] = [bytes[index], bytes[index + 1], bytes[index + 2]];
    result += BASE64_ALPHABET[b0 >> 2];
    result += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    result += b1 === undefined ? '' : BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    result += b2 === undefined ? '' : BASE64_ALPHABET[b2 & 0x3f];
  }
  return result;
}

function makeIdToken(payload: Record<string, unknown>): string {
  const header = encodeBase64Url(JSON.stringify({ alg: 'none' }));
  const body = encodeBase64Url(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

describe('decodeIdTokenClaims', () => {
  it('decodes a well-formed JWT payload', () => {
    const token = makeIdToken({ email: 'user@example.com', sub: '123' });
    expect(decodeIdTokenClaims(token)).toEqual({ email: 'user@example.com', sub: '123' });
  });

  it('decodes non-ASCII claim values correctly', () => {
    const token = makeIdToken({ name: '한글 테스트 🎉' });
    expect(decodeIdTokenClaims(token)).toEqual({ name: '한글 테스트 🎉' });
  });

  it('returns null for input with fewer than two segments', () => {
    expect(decodeIdTokenClaims('not-a-jwt')).toBeNull();
    expect(decodeIdTokenClaims('')).toBeNull();
  });

  it('returns null for a payload segment that is not valid JSON', () => {
    const notJson = encodeBase64Url('not json');
    expect(decodeIdTokenClaims(`header.${notJson}.sig`)).toBeNull();
  });

  it('returns null when the decoded JSON is not an object', () => {
    const arrayPayload = encodeBase64Url('[1,2,3]');
    expect(decodeIdTokenClaims(`header.${arrayPayload}.sig`)).toBeNull();
  });

  it('never throws on garbage input', () => {
    expect(() => decodeIdTokenClaims('...')).not.toThrow();
    expect(() => decodeIdTokenClaims('a.!!!not-base64!!!.c')).not.toThrow();
  });
});

describe('extractEmailClaim', () => {
  it('prefers email over preferred_username and upn', () => {
    expect(
      extractEmailClaim({ email: 'a@x.com', preferred_username: 'b@x.com', upn: 'c@x.com' }),
    ).toBe('a@x.com');
  });

  it('falls back to preferred_username when email is absent', () => {
    expect(extractEmailClaim({ preferred_username: 'b@x.com', upn: 'c@x.com' })).toBe('b@x.com');
  });

  it('falls back to upn when neither email nor preferred_username is present', () => {
    expect(extractEmailClaim({ upn: 'c@x.com' })).toBe('c@x.com');
  });

  it('returns null when no email-like claim is present', () => {
    expect(extractEmailClaim({ sub: '123' })).toBeNull();
  });

  it('returns null for null claims', () => {
    expect(extractEmailClaim(null)).toBeNull();
  });

  it('ignores an empty-string claim value', () => {
    expect(extractEmailClaim({ email: '   ', upn: 'c@x.com' })).toBe('c@x.com');
  });
});
