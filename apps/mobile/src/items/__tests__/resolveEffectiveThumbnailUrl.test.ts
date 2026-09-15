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

  it('falls back to previewImageUrl when coverImage is absent', () => {
    const url = resolveEffectiveThumbnailUrl({
      coverImage: null,
      previewImageUrl: 'https://cdn.example/preview.jpg',
      representativeImage: { id: 2, readUrl: 'https://blob.example/uploaded.jpg' },
    });

    expect(url).toBe('https://cdn.example/preview.jpg');
  });

  it('falls back to representativeImage when both coverImage and previewImageUrl are absent', () => {
    const url = resolveEffectiveThumbnailUrl({
      coverImage: null,
      previewImageUrl: null,
      representativeImage: { id: 2, readUrl: 'https://blob.example/uploaded.jpg' },
    });

    expect(url).toBe('https://blob.example/uploaded.jpg');
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
