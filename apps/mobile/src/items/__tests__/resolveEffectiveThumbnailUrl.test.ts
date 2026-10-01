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
});
