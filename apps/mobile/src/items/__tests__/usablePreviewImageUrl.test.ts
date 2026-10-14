import type { ItemImage } from '../../images/api/imagesApi';
import { representativePhotoUrl, resolveRepresentativePhoto } from '../representativePhoto';
import { usablePreviewImageUrl } from '../usablePreviewImageUrl';

// NOW = 2026-10-14T12:00:00Z; `oe` 6ACF60B0 = NOW - 1 h, 6ACF7CD0 = NOW + 1 h (see metaPreviewExpiry.test.ts).
const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
const EXPIRED = 'https://scontent-ssn1-1.cdninstagram.com/v/p.jpg?oh=00_sig&oe=6ACF60B0';
const VALID = 'https://scontent-ssn1-1.cdninstagram.com/v/p.jpg?oh=00_sig&oe=6ACF7CD0';
const OTHER = 'https://cdn.example/preview.jpg?oe=6ACF60B0';

describe('usablePreviewImageUrl', () => {
  it('drops only an already-expired Meta CDN preview', () => {
    expect(usablePreviewImageUrl(EXPIRED, NOW)).toBeNull();
    expect(usablePreviewImageUrl(VALID, NOW)).toBe(VALID);
  });

  it('leaves every other value as it was (fail-open)', () => {
    expect(usablePreviewImageUrl(OTHER, NOW)).toBe(OTHER);
    expect(usablePreviewImageUrl('https://scontent.cdninstagram.com/p.jpg?oe=not-hex', NOW)).toBe('https://scontent.cdninstagram.com/p.jpg?oe=not-hex');
    expect(usablePreviewImageUrl(null, NOW)).toBeNull();
    expect(usablePreviewImageUrl(undefined, NOW)).toBeNull();
  });
});

describe('resolveRepresentativePhoto with an expired Instagram preview', () => {
  const uploaded = { id: 7, readUrl: 'https://stjupledev.blob.core.windows.net/item-images/a.jpg?sig=x' } as ItemImage;

  it('keeps the user\'s own photo first - it is never checked or hidden', () => {
    const photo = resolveRepresentativePhoto(EXPIRED, [uploaded], null, NOW);
    expect(photo).toEqual({ kind: 'uploaded', image: uploaded });
    expect(representativePhotoUrl(photo)).toBe(uploaded.readUrl);
  });

  it('an expired preview alone is no photo at all (the screen\'s no-photo state)', () => {
    expect(resolveRepresentativePhoto(EXPIRED, [], null, NOW)).toBeNull();
  });

  it('a valid or non-Meta preview is still the automatic photo', () => {
    expect(resolveRepresentativePhoto(VALID, [], null, NOW)).toEqual({ kind: 'auto', url: VALID });
    expect(resolveRepresentativePhoto(OTHER, [], null, NOW)).toEqual({ kind: 'auto', url: OTHER });
  });
});
