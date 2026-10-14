import { resolveEffectiveThumbnailUrl } from '../resolveEffectiveThumbnailUrl';

describe('resolveEffectiveThumbnailUrl', () => {
  it('prefers coverImage when all three sources are present', () => {
    const url = resolveEffectiveThumbnailUrl({
      coverImage: { id: 1, readUrl: 'https://blob.example/cover.jpg' },
      previewImageUrl: 'https://cdn.example/preview.jpg',
      representativeImage: { id: 2, readUrl: 'https://blob.example/uploaded.jpg' },
    });

    expect(url).toBe('https://blob.example/cover.jpg');
  });

  it('uses the Item\'s own photo ahead of the automatic preview even without a cover (an Item saved before photos set it)', () => {
    const url = resolveEffectiveThumbnailUrl({
      coverImage: null,
      previewImageUrl: 'https://cdn.example/preview.jpg',
      representativeImage: { id: 2, readUrl: 'https://blob.example/uploaded.jpg' },
    });

    expect(url).toBe('https://blob.example/uploaded.jpg');
  });

  it('falls back to previewImageUrl when the Item has no photo of its own', () => {
    const url = resolveEffectiveThumbnailUrl({
      coverImage: null,
      previewImageUrl: 'https://cdn.example/preview.jpg',
      representativeImage: null,
    });

    expect(url).toBe('https://cdn.example/preview.jpg');
  });

  it('returns null when none of the three sources are present', () => {
    const url = resolveEffectiveThumbnailUrl({
      coverImage: null,
      previewImageUrl: null,
      representativeImage: null,
    });

    expect(url).toBeNull();
  });

  describe('an expired Instagram (Meta CDN) preview', () => {
    const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
    const expired = 'https://scontent-ssn1-1.cdninstagram.com/v/p.jpg?oh=00_sig&oe=6ACF60B0'; // NOW - 1 h
    const valid = 'https://scontent-ssn1-1.cdninstagram.com/v/p.jpg?oh=00_sig&oe=6ACF7CD0'; // NOW + 1 h

    it('counts as no preview, so the card shows its fallback without requesting it', () => {
      expect(resolveEffectiveThumbnailUrl({ coverImage: null, previewImageUrl: expired, representativeImage: null }, NOW)).toBeNull();
    });

    it('keeps a not-yet-expired one', () => {
      expect(resolveEffectiveThumbnailUrl({ coverImage: null, previewImageUrl: valid, representativeImage: null }, NOW)).toBe(valid);
    });

    it('never hides the user\'s own photo (cover or first photo still win)', () => {
      expect(resolveEffectiveThumbnailUrl({ coverImage: { id: 1, readUrl: 'https://blob.example/cover.jpg' }, previewImageUrl: expired, representativeImage: null }, NOW))
        .toBe('https://blob.example/cover.jpg');
      expect(resolveEffectiveThumbnailUrl({ coverImage: null, previewImageUrl: expired, representativeImage: { id: 2, readUrl: 'https://blob.example/uploaded.jpg' } }, NOW))
        .toBe('https://blob.example/uploaded.jpg');
    });

    it('leaves every other preview as it was (fail-open)', () => {
      const other = 'https://cdn.example/preview.jpg?oe=6ACF60B0';
      expect(resolveEffectiveThumbnailUrl({ coverImage: null, previewImageUrl: other, representativeImage: null }, NOW)).toBe(other);
    });
  });
});
