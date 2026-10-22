import { parseIosPendingShares } from '../pendingShareSource';
import { resolveIncomingShare } from '../resolveIncomingShare';

// Node's fs through Jest (the app's tsconfig has no Node types), as in errorMapperCoverage.test.ts.
const fs = jest.requireActual<{ readFileSync(file: string, encoding: string): string }>('fs');
const iosSource = (relative: string) => fs.readFileSync(`${__dirname}/../../../ios/${relative}`, 'utf8');

describe('iOS Share extension queue (NativeIncomingShareIOS)', () => {
  it('reads the App Group JSON as PendingShares that never name a Collection or a background save', () => {
    const json = JSON.stringify([
      { id: 'a', text: 'https://www.youtube.com/watch?v=abc', receivedAtEpochMs: 1_700_000_000_000, initialTitle: 'A video' },
      { id: 'b', text: 'Look at this https://example.com/page', receivedAtEpochMs: 1_700_000_000_500 },
    ]);
    expect(parseIosPendingShares(json)).toEqual([
      { id: 'a', text: 'https://www.youtube.com/watch?v=abc', receivedAtEpochMs: 1_700_000_000_000, initialTitle: 'A video', preselectedCollectionId: null, draftTitle: null, draftCollectionId: null },
      { id: 'b', text: 'Look at this https://example.com/page', receivedAtEpochMs: 1_700_000_000_500, initialTitle: null, preselectedCollectionId: null, draftTitle: null, draftCollectionId: null },
    ]);
  });

  it('skips malformed entries and never throws on a broken file', () => {
    expect(parseIosPendingShares('not json')).toEqual([]);
    expect(parseIosPendingShares('{"id":"x"}')).toEqual([]);
    expect(parseIosPendingShares(null)).toEqual([]);
    const json = JSON.stringify([
      null,
      { id: '', text: 'https://example.com', receivedAtEpochMs: 1 },
      { id: 'c', text: '   ', receivedAtEpochMs: 1 },
      { id: 'd', text: 'https://example.com', receivedAtEpochMs: 'soon' },
      { id: 'e', text: 'https://example.com/ok', receivedAtEpochMs: 2, initialTitle: '  ' },
    ]);
    expect(parseIosPendingShares(json).map(share => [share.id, share.initialTitle])).toEqual([['e', null]]);
  });

  it('feeds the same resolver Android shares go through (exact URL / text with a link)', () => {
    const [video, text] = parseIosPendingShares(JSON.stringify([
      { id: 'a', text: 'https://www.youtube.com/watch?v=abc', receivedAtEpochMs: 1, initialTitle: 'A video' },
      { id: 'b', text: 'Look at this https://example.com/page', receivedAtEpochMs: 2 },
    ]));
    expect(resolveIncomingShare(video)).toEqual(expect.objectContaining({ kind: 'exactUrl', text: 'https://www.youtube.com/watch?v=abc', title: 'A video' }));
    expect(resolveIncomingShare(text).text).toContain('https://example.com/page');
  });

  it('the extension accepts only web links, saves idempotently and keeps a share until the server confirmed it', () => {
    const links = iosSource('JupleShareExtension/ShareLink.swift');
    expect(links).toMatch(/scheme == "http" \|\| scheme == "https"/);
    const controller = iosSource('JupleShareExtension/ShareViewController.swift');
    // The queue first, the save with the queue id as clientRequestId, the queue entry removed only after the server answered.
    expect(controller).toMatch(/PendingShareStore\.capture\(text: received\.text/);
    expect(controller).toMatch(/clientRequestId: pendingId/);
    expect(controller).toMatch(/private func finishSaved\(\) \{\s*if let pendingId \{ PendingShareStore\.acknowledge\(id: pendingId\) \}\s*complete\(\)/);
    // 빠른 저장 applies the title and preview image the way Android's Quick Save does (urlMetadata/enrichItemTitle.ts): the
    // server stores only the URL, so without this a YouTube link was saved as a bare "youtu.be" with no picture.
    expect(controller).toMatch(/collectionIds: \[\], unlockTokens: \[:\]\)\s*\/\/[^\n]*\n[^\n]*\n\s*await enrichSavedLink\(api: api, itemId: saved\.id, url: link\.absoluteString\)/);
    expect(controller).toMatch(/guard let metadata = try\? await api\.resolveMetadata\(url: url\) else \{ return \}/);
    expect(controller).toMatch(/if structuredTitle == nil, let title = metadata\.title/);
    expect(controller).toMatch(/try\? await api\.setPreviewImage\(itemId: itemId, previewImageUrl: image\)/);
    // 빠른 저장 only for exactly one link, as on Android.
    expect(controller).toMatch(/PendingShareStore\.quickSaveOnShare, ShareLink\.exactLink\(in: received\.text\) != nil/);
    expect(controller).not.toMatch(/print\(|NSLog\(|os_log|Logger\(/);
    const store = iosSource('Shared/PendingShareStore.swift');
    expect(store).toMatch(/completeFileProtectionUntilFirstUserAuthentication/);
    expect(store).toMatch(/group\.com\.juple\.app/);
    // Only the 빠른 저장 on/off switch lives in UserDefaults - nothing else is written there.
    const defaultsUses = store.match(/UserDefaults\(suiteName: appGroupIdentifier\)[^\n]*/g) ?? [];
    expect(defaultsUses).toHaveLength(2);
    defaultsUses.forEach(use => expect(use).toMatch(/forKey: quickSaveKey\)/));
    const session = iosSource('JupleShareExtension/ShareSession.swift');
    expect(session).toMatch(/kSecAttrAccessGroup as String: PendingShareStore\.appGroupIdentifier/);
    expect(session).not.toMatch(/SecItemAdd|SecItemUpdate|UserDefaults/);
  });
});
