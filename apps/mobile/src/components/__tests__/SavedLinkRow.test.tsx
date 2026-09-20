import ReactTestRenderer, { act } from 'react-test-renderer';
import { Image, Text } from 'react-native';
import { SavedLinkRow } from '../SavedLinkRow';
import { GlobeIcon } from '../../icons/GlobeIcon';
import { YouTubeIcon } from '../../icons/YouTubeIcon';
import type { ItemHistoryEntry } from '../../items/api/itemsApi';

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

    it('when preferEffectiveThumbnail is true and there is no coverImage, falls back to previewImageUrl', async () => {
      const item = makeItem({
        representativeImage: { id: 1, readUrl: 'https://blob.example/uploaded.jpg' },
        previewImageUrl: 'https://cdn.example/preview.jpg',
        coverImage: null,
      });
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
