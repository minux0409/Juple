import { resolveIncomingShare } from '../resolveIncomingShare';

function makeShare(overrides: Partial<{ text: string; initialTitle: string | null; draftTitle: string | null }> = {}) {
  return {
    text: 'https://example.com/a',
    initialTitle: null,
    draftTitle: null,
    ...overrides,
  };
}

describe('resolveIncomingShare', () => {
  it('uses the intent title (EXTRA_SUBJECT/EXTRA_TITLE) when the sharing app provided one', () => {
    const resolved = resolveIncomingShare(
      makeShare({ initialTitle: 'Some video title' }),
    );

    expect(resolved).toEqual({
      kind: 'exactUrl',
      text: 'https://example.com/a',
      title: 'Some video title',
      titleSource: 'intent',
    });
  });

  it('prefers a composer draft title over the intent title', () => {
    const resolved = resolveIncomingShare(
      makeShare({ draftTitle: 'Edited in composer', initialTitle: 'Original subject' }),
    );

    expect(resolved.title).toBe('Edited in composer');
    expect(resolved.titleSource).toBe('draft');
  });

  it('prefers the intent title over a shared-text leading candidate', () => {
    const resolved = resolveIncomingShare(
      makeShare({
        text: 'Check this out: https://example.com/c',
        initialTitle: 'From intent',
      }),
    );

    expect(resolved.kind).toBe('reviewText');
    expect(resolved.title).toBe('From intent');
    expect(resolved.titleSource).toBe('intent');
  });

  it('falls back to leading text before a single URL when no other title exists', () => {
    const resolved = resolveIncomingShare(
      makeShare({ text: 'Check this out: https://example.com/c' }),
    );

    expect(resolved.kind).toBe('reviewText');
    expect(resolved.title).toBe('Check this out:');
    expect(resolved.titleSource).toBe('sharedText');
  });

  it('resolves no title for a URL-only share (Instagram-like payload) - never a guessed one', () => {
    const resolved = resolveIncomingShare(
      makeShare({ text: 'https://www.instagram.com/reel/abc/' }),
    );

    expect(resolved).toEqual({
      kind: 'exactUrl',
      text: 'https://www.instagram.com/reel/abc/',
      title: null,
      titleSource: 'none',
    });
  });

  it('never uses a raw URL as the title, from any source', () => {
    const resolved = resolveIncomingShare(
      makeShare({
        initialTitle: 'https://example.com/a',
        draftTitle: '  https://example.com/other  ',
      }),
    );

    expect(resolved.title).toBeNull();
    expect(resolved.titleSource).toBe('none');
  });

  it('rejects a title candidate that is just the shared text itself', () => {
    const resolved = resolveIncomingShare(
      makeShare({
        text: 'Some plain shared text without a link',
        initialTitle: '  Some plain shared text without a link  ',
      }),
    );

    expect(resolved.kind).toBe('reviewText');
    expect(resolved.title).toBeNull();
    expect(resolved.titleSource).toBe('none');
  });

  it('rejects blank/whitespace-only title candidates and trims accepted ones', () => {
    expect(resolveIncomingShare(makeShare({ initialTitle: '   ' })).title).toBeNull();
    expect(resolveIncomingShare(makeShare({ initialTitle: '  Padded title  ' })).title).toBe(
      'Padded title',
    );
  });
});
