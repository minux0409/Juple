import { COLLECTION_SHARE_URL_NOT_SAVABLE_CODE, isCollectionShareUrl, parseCollectionShareUrl, publicIdFromServerVerifiedShareUrl } from '../collectionShareUrl';

const HOST = 'dev.juple.co.kr';
const ID = 'AbCdEfGh_ijkLMNOpqrSTUV-wxyz0123';

describe('parseCollectionShareUrl', () => {
  it('recognizes a canonical Collection share URL on the configured public host', () => {
    expect(parseCollectionShareUrl(`https://${HOST}/c/${ID}`, HOST)).toBe(ID);
    expect(parseCollectionShareUrl(`  https://${HOST}/c/${ID}/  `, HOST)).toBe(ID);
    expect(parseCollectionShareUrl(`HTTPS://DEV.JUPLE.CO.KR/c/${ID}`, HOST)).toBe(ID);
  });

  it('ignores a query string and a fragment', () => {
    expect(parseCollectionShareUrl(`https://${HOST}/c/${ID}?utm_source=kakao&x=1`, HOST)).toBe(ID);
    expect(parseCollectionShareUrl(`https://${HOST}/c/${ID}#top`, HOST)).toBe(ID);
    expect(parseCollectionShareUrl(`https://${HOST}/c/${ID}/?a=b#c`, HOST)).toBe(ID);
    expect(parseCollectionShareUrl(`https://${HOST}:443/c/${ID}`, HOST)).toBe(ID);
  });

  it('does not take a lookalike host, another scheme or credentials for a Collection link', () => {
    expect(parseCollectionShareUrl(`https://${HOST}.evil.test/c/${ID}`, HOST)).toBeNull();
    expect(parseCollectionShareUrl(`https://evil-${HOST}/c/${ID}`, HOST)).toBeNull();
    expect(parseCollectionShareUrl(`https://sub.${HOST}/c/${ID}`, HOST)).toBeNull();
    expect(parseCollectionShareUrl(`https://example.com/c/${ID}`, HOST)).toBeNull();
    expect(parseCollectionShareUrl(`http://${HOST}/c/${ID}`, HOST)).toBeNull();
    expect(parseCollectionShareUrl(`https://user:pw@${HOST}/c/${ID}`, HOST)).toBeNull();
    expect(parseCollectionShareUrl(`https://${HOST}:8443/c/${ID}`, HOST)).toBeNull();
    expect(parseCollectionShareUrl(`https://example.com/?next=https://${HOST}/c/${ID}`, HOST)).toBeNull();
  });

  it('does not take another page of the same host, or a malformed id, for a Collection link', () => {
    expect(parseCollectionShareUrl(`https://${HOST}/`, HOST)).toBeNull();
    expect(parseCollectionShareUrl(`https://${HOST}/about`, HOST)).toBeNull();
    expect(parseCollectionShareUrl(`https://${HOST}/c`, HOST)).toBeNull();
    expect(parseCollectionShareUrl(`https://${HOST}/c/`, HOST)).toBeNull();
    expect(parseCollectionShareUrl(`https://${HOST}/c/${ID}/extra`, HOST)).toBeNull();
    expect(parseCollectionShareUrl(`https://${HOST}/cc/${ID}`, HOST)).toBeNull();
    expect(parseCollectionShareUrl(`https://${HOST}/c/short`, HOST)).toBeNull();
    expect(parseCollectionShareUrl(`https://${HOST}/c/${ID}!!`, HOST)).toBeNull();
    expect(parseCollectionShareUrl(`https://${HOST}/c/%E0%A4%A`, HOST)).toBeNull();
    expect(parseCollectionShareUrl(`https://${HOST}/c/${'a'.repeat(65)}`, HOST)).toBeNull();
  });

  it('is never fooled by display text, empty input or a build with no public host', () => {
    expect(parseCollectionShareUrl(`이 컬렉션 보세요 https://${HOST}/c/${ID}`, HOST)).toBeNull();
    expect(parseCollectionShareUrl('', HOST)).toBeNull();
    expect(parseCollectionShareUrl(null, HOST)).toBeNull();
    expect(parseCollectionShareUrl('not a url', HOST)).toBeNull();
    expect(parseCollectionShareUrl(`https://${HOST}/c/${ID}`, undefined)).toBeNull();
    expect(isCollectionShareUrl(`https://${HOST}/c/${ID}`, HOST)).toBe(true);
    expect(isCollectionShareUrl(`https://${HOST}/articles/1`, HOST)).toBe(false);
  });
});

describe('server-guard fallback helpers', () => {
  it('uses the server\'s stable error code', () => {
    expect(COLLECTION_SHARE_URL_NOT_SAVABLE_CODE).toBe('collectionShareUrlNotSavableAsLink');
  });

  it('reads the public id out of a URL the server already judged to be a Collection link (no host check - this build may not know it)', () => {
    expect(publicIdFromServerVerifiedShareUrl(`https://other-host.test/c/${ID}?x=1#y`)).toBe(ID);
    expect(publicIdFromServerVerifiedShareUrl(`  https://dev.juple.co.kr/c/${ID}/ `)).toBe(ID);
    expect(publicIdFromServerVerifiedShareUrl('https://dev.juple.co.kr/about')).toBeNull();
    expect(publicIdFromServerVerifiedShareUrl('https://dev.juple.co.kr/c/short')).toBeNull();
    expect(publicIdFromServerVerifiedShareUrl('not a url')).toBeNull();
    expect(publicIdFromServerVerifiedShareUrl(null)).toBeNull();
  });
});
