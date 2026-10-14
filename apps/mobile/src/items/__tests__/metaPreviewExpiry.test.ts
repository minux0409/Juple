import { isExpiredMetaPreviewUrl } from '../metaPreviewExpiry';

// The same fixtures as apps/web/tests/metaPreviewExpiry.test.ts - the two helpers must agree.
// NOW = 2026-10-14T12:00:00Z = 0x6ACF6EC0 s. `oe` is the expiry in Unix seconds as 8 hex digits (as observed on real
// Instagram og:image URLs; an expired one is answered "403 URL signature expired").
const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
const PAST = '6ACF60B0'; // NOW - 1 h
const FUTURE = '6ACF7CD0'; // NOW + 1 h
const ig = (query: string) => `https://scontent-ssn1-1.cdninstagram.com/v/t51.2885-15/photo.jpg?stp=x&_nc_ht=y&oh=00_sig&${query}`;

const CASES: ReadonlyArray<readonly [string, string | null, boolean]> = [
  ['cdninstagram, future oe', ig(`oe=${FUTURE}`), false],
  ['cdninstagram, past oe', ig(`oe=${PAST}`), true],
  ['fbcdn, past oe', `https://scontent-icn2-1.xx.fbcdn.net/v/t39/p.webp?oh=00_sig&oe=${PAST}`, true],
  ['fbcdn regional host, past oe', `https://instagram.ficn2-1.fna.fbcdn.net/v/p.heic?oe=${PAST}`, true],
  ['lower-case hex, past oe', ig(`oe=${PAST.toLowerCase()}`), true],
  ['exactly at the expiry second', ig('oe=6ACF6EC0'), true],
  ['one second before the expiry', ig('oe=6ACF6EC1'), false],
  ['no oe', ig('x=1'), false],
  ['empty oe', ig('oe='), false],
  ['oe not hex', ig('oe=ZZZZZZZZ'), false],
  ['oe decimal-looking but 10 digits', ig('oe=1791975600'), false],
  ['oe too short', ig('oe=6ACF60B'), false],
  ['oe too long', ig('oe=06ACF60B0'), false],
  ['oe with sign', ig('oe=-6ACF60B'), false],
  ['oe implausibly old (1970s)', ig('oe=00000001'), false],
  ['two oe values', ig(`oe=${PAST}&oe=${FUTURE}`), false],
  ['malformed URL', 'not a url', false],
  ['empty', '', false],
  ['null', null, false],
  ['http, not https', `http://scontent.cdninstagram.com/p.jpg?oe=${PAST}`, false],
  ['explicit port', `https://scontent.cdninstagram.com:8443/p.jpg?oe=${PAST}`, false],
  ['userinfo', `https://user@scontent.cdninstagram.com/p.jpg?oe=${PAST}`, false],
  ['bare cdninstagram.com', `https://cdninstagram.com/p.jpg?oe=${PAST}`, false],
  ['look-alike evilcdninstagram.com', `https://evilcdninstagram.com/p.jpg?oe=${PAST}`, false],
  ['suffix attack cdninstagram.com.attacker.example', `https://cdninstagram.com.attacker.example/p.jpg?oe=${PAST}`, false],
  ['suffix attack fbcdn.net.attacker.example', `https://scontent.fbcdn.net.attacker.example/p.jpg?oe=${PAST}`, false],
  ['static.cdninstagram.com (never a post image)', `https://static.cdninstagram.com/rsrc.php/x.png?oe=${PAST}`, false],
  ['other site image with an oe parameter', `https://images.example.com/p.jpg?oe=${PAST}`, false],
  ['uploaded photo read URL (Blob SAS)', 'https://stjupledev.blob.core.windows.net/item-images/u/1/a.jpg?sv=2024&se=2026-10-14T11%3A00%3A00Z&sig=abc', false],
];

describe('isExpiredMetaPreviewUrl', () => {
  it.each(CASES)('%s', (_name, url, expected) => {
    expect(isExpiredMetaPreviewUrl(url, NOW)).toBe(expected);
  });

  it('fails open on a clock that is not a number', () => {
    expect(isExpiredMetaPreviewUrl(ig(`oe=${PAST}`), Number.NaN)).toBe(false);
  });
});
