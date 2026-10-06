import ReactTestRenderer, { act } from 'react-test-renderer';
import { Image, Text } from 'react-native';
import { SavedLinkRow } from '../SavedLinkRow';
import { GlobeIcon } from '../../icons/GlobeIcon';
import { YouTubeIcon } from '../../icons/YouTubeIcon';
import type { ItemHistoryEntry } from '../../items/api/itemsApi';
import { StyleSheet } from 'react-native';
import { SavedLinkGridCard } from '../SavedLinkGridCard';
import { LockIcon } from '../../icons/LockIcon';
import { SiteIcon } from '../../icons/SiteIcon';
import i18n from '../../i18n';

function makeItem(overrides: Partial<ItemHistoryEntry> = {}): ItemHistoryEntry {
  return {
    id: 1,
    url: 'https://example.com',
    title: null,
    memo: null,
    savedAtUtc: new Date().toISOString(),
    representativeImage: null,
    previewImageUrl: null,
    coverImage: null,
    ...overrides,
  };
}

async function render(
  item: ItemHistoryEntry,
  isActionInFlight = false,
  preferEffectiveThumbnail = false,
) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <SavedLinkRow
        isActionInFlight={isActionInFlight}
        item={item}
        preferEffectiveThumbnail={preferEffectiveThumbnail}
      />,
    );
  });
  return renderer;
}

describe('SavedLinkRow', () => {
  describe('a link of a locked Collection (server-redacted)', () => {
    // Even if a client got unredacted fields by mistake, none of them may show.
    const leaky = () => makeItem({ isCollectionLocked: true, collectionId: 4, url: 'https://www.youtube.com/watch?v=secret', title: 'Private title', memo: 'Private memo', previewImageUrl: 'https://secret.example/photo' });
    const texts = (renderer: ReactTestRenderer.ReactTestRenderer) =>
      renderer.root.findAll(node => typeof node.type === 'string' && typeof node.props.children === 'string').map(node => node.props.children as string);

    it('List: the normal row - a lock in the 60dp thumbnail slot, the locked sentence as its title, only the time', async () => {
      const renderer = await render(leaky());
      const row = renderer.root.findByProps({ testID: 'saved-link-locked' });
      const normal = await render(makeItem({ title: 'Open', previewImageUrl: 'https://example.com/p.png' }), false, true);

      // The same row box as an ordinary link.
      expect(StyleSheet.flatten(row.props.style)).toEqual(StyleSheet.flatten(normal.root.findAll(node => node.props.style && StyleSheet.flatten(node.props.style)?.flexDirection === 'row')[0].props.style));
      const slot = StyleSheet.flatten(renderer.root.findByProps({ testID: 'saved-link-locked-thumbnail' }).props.style);
      expect(slot).toMatchObject({ width: 60, height: 60, borderRadius: 14, marginEnd: 12 });
      expect(renderer.root.findAllByType(LockIcon)).toHaveLength(1);
      expect(texts(renderer)).toContain(i18n.t('item.lockedLinkPlaceholder'));
      // Nothing of the link: no image, title, memo, URL or site icon.
      expect(renderer.root.findAllByType(Image)).toHaveLength(0);
      expect(renderer.root.findAllByType(SiteIcon)).toHaveLength(0);
      expect(texts(renderer).some(text => /Private|secret|youtube/i.test(text))).toBe(false);
    });

    it('Grid: the normal card - the square image area holds the lock, the title area the locked sentence', async () => {
      let renderer!: ReactTestRenderer.ReactTestRenderer;
      let normal!: ReactTestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = ReactTestRenderer.create(<SavedLinkGridCard isActionInFlight={false} item={leaky()} />);
        normal = ReactTestRenderer.create(<SavedLinkGridCard isActionInFlight={false} item={makeItem({ title: 'Open' })} />);
      });
      const card = renderer.root.findByProps({ testID: 'saved-link-locked' });
      const normalCard = normal.root.findAll(node => typeof node.type === 'string')[0];
      expect(StyleSheet.flatten(card.props.style)).toEqual(StyleSheet.flatten(normalCard.props.style));
      expect(StyleSheet.flatten(renderer.root.findByProps({ testID: 'saved-link-locked-thumbnail' }).props.style)).toMatchObject({ aspectRatio: 1 });
      // The title keeps the same reserved two-line height as any card, so the grid never turns ragged.
      const title = (r: ReactTestRenderer.ReactTestRenderer) => r.root.findAll(node => typeof node.type === 'string' && node.props.numberOfLines === 2)[0];
      expect(StyleSheet.flatten(title(renderer).props.style).minHeight).toBe(StyleSheet.flatten(title(normal).props.style).minHeight);
      expect(texts(renderer)).toContain(i18n.t('item.lockedLinkPlaceholder'));
      expect(renderer.root.findAllByType(Image)).toHaveLength(0);
      expect(renderer.root.findAllByType(SiteIcon)).toHaveLength(0);
      expect(texts(renderer).some(text => /Private|secret|youtube/i.test(text))).toBe(false);
    });
  });
  it('shows the title as primary text when the item has one', async () => {
    const item = makeItem({ title: 'My saved article', url: 'https://example.com/a' });
    const renderer = await render(item);

    expect(renderer.root.findByProps({ children: 'My saved article' })).toBeTruthy();
  });

  it('falls back to the domain as primary text when there is no title', async () => {
    const item = makeItem({ title: null, url: 'https://www.youtube.com/watch?v=abc123' });
    const renderer = await render(item);

    expect(renderer.root.findByProps({ children: 'youtube.com' })).toBeTruthy();
  });

  it('never shows the raw URL as text, whether or not there is a title', async () => {
    const withTitle = await render(makeItem({ title: 'Has a title', url: 'https://example.com/a' }));
    expect(withTitle.root.findAll(node => node.props.children === 'https://example.com/a')).toHaveLength(0);

    const withoutTitle = await render(makeItem({ title: null, url: 'https://example.com/b' }));
    expect(withoutTitle.root.findAll(node => node.props.children === 'https://example.com/b')).toHaveLength(0);
  });

  it('shows a known site icon for a recognized host, and the generic globe icon otherwise', async () => {
    const known = await render(makeItem({ url: 'https://www.youtube.com/watch?v=abc' }));
    expect(known.root.findAllByType(YouTubeIcon)).toHaveLength(1);

    const generic = await render(makeItem({ url: 'https://example.com/a' }));
    expect(generic.root.findAllByType(GlobeIcon)).toHaveLength(1);
  });

  it('truncates the primary text to 2 lines', async () => {
    const item = makeItem({ title: 'A title', url: 'https://example.com/very/long/path' });
    const renderer = await render(item);

    const primary = renderer.root.findByProps({ children: 'A title' });
    expect(primary.props.numberOfLines).toBe(2);
  });

  it('does not render a memo element when the item has no memo', async () => {
    const item = makeItem({ memo: null });
    const renderer = await render(item);

    // Every Text this row can render is accounted for by title/domain and time - no second line
    // of text should exist when there is no memo to show (the site icon is an Svg, not a Text).
    expect(renderer.root.findAllByType(Text)).toHaveLength(2);
  });

  it('renders the memo when present, visually separate from the URL line', async () => {
    const item = makeItem({ memo: 'A short note' });
    const renderer = await render(item);

    const memo = renderer.root.findByProps({ children: 'A short note' });
    expect(memo).toBeTruthy();
    // Distinguished from the plain URL line so it doesn't read as another URL-like row.
    expect(memo.props.style).toMatchObject({ fontStyle: 'italic' });
  });

  describe('thumbnail source (preferEffectiveThumbnail)', () => {
    it('defaults to only the first-uploaded image when preferEffectiveThumbnail is not passed, ignoring coverImage/previewImageUrl', async () => {
      const item = makeItem({
        representativeImage: { id: 1, readUrl: 'https://blob.example/uploaded.jpg' },
        previewImageUrl: 'https://cdn.example/preview.jpg',
        coverImage: { id: 2, readUrl: 'https://blob.example/cover.jpg' },
      });
      const renderer = await render(item, false, false);

      const image = renderer.root.findByType(Image);
      expect(image.props.source).toEqual({ uri: 'https://blob.example/uploaded.jpg' });
    });

    it('when preferEffectiveThumbnail is true, prefers coverImage over previewImageUrl and representativeImage', async () => {
      const item = makeItem({
        representativeImage: { id: 1, readUrl: 'https://blob.example/uploaded.jpg' },
        previewImageUrl: 'https://cdn.example/preview.jpg',
        coverImage: { id: 2, readUrl: 'https://blob.example/cover.jpg' },
      });
      const renderer = await render(item, false, true);

      const image = renderer.root.findByType(Image);
      expect(image.props.source).toEqual({ uri: 'https://blob.example/cover.jpg' });
    });

    it('when preferEffectiveThumbnail is true and there is no coverImage, the own photo still wins over previewImageUrl', async () => {
      const item = makeItem({
        representativeImage: { id: 1, readUrl: 'https://blob.example/uploaded.jpg' },
        previewImageUrl: 'https://cdn.example/preview.jpg',
        coverImage: null,
      });
      const renderer = await render(item, false, true);

      const image = renderer.root.findByType(Image);
      expect(image.props.source).toEqual({ uri: 'https://blob.example/uploaded.jpg' });
    });

    it('when preferEffectiveThumbnail is true and the Item has no photo of its own, falls back to previewImageUrl', async () => {
      const item = makeItem({ representativeImage: null, previewImageUrl: 'https://cdn.example/preview.jpg', coverImage: null });
      const renderer = await render(item, false, true);

      const image = renderer.root.findByType(Image);
      expect(image.props.source).toEqual({ uri: 'https://cdn.example/preview.jpg' });
    });

    it('when preferEffectiveThumbnail is true and there is neither coverImage nor previewImageUrl, falls back to representativeImage', async () => {
      const item = makeItem({
        representativeImage: { id: 1, readUrl: 'https://blob.example/uploaded.jpg' },
        previewImageUrl: null,
        coverImage: null,
      });
      const renderer = await render(item, false, true);

      const image = renderer.root.findByType(Image);
      expect(image.props.source).toEqual({ uri: 'https://blob.example/uploaded.jpg' });
    });

    it('when preferEffectiveThumbnail is true and none of the three sources exist, renders no Image', async () => {
      const item = makeItem({ representativeImage: null, previewImageUrl: null, coverImage: null });
      const renderer = await render(item, false, true);

      expect(renderer.root.findAllByType(Image)).toHaveLength(0);
    });
  });
});
