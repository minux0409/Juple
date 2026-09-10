import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { SavedLinkRow } from '../SavedLinkRow';
import type { ItemHistoryEntry } from '../../items/api/itemsApi';

function makeItem(overrides: Partial<ItemHistoryEntry> = {}): ItemHistoryEntry {
  return {
    id: 1,
    url: 'https://example.com',
    title: null,
    memo: null,
    savedAtUtc: new Date().toISOString(),
    representativeImage: null,
    ...overrides,
  };
}

async function render(item: ItemHistoryEntry, isActionInFlight = false) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <SavedLinkRow isActionInFlight={isActionInFlight} item={item} />,
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

  it('always shows the actual URL as secondary text, whether or not there is a title', async () => {
    const withTitle = await render(makeItem({ title: 'Has a title', url: 'https://example.com/a' }));
    expect(withTitle.root.findByProps({ children: 'https://example.com/a' })).toBeTruthy();

    const withoutTitle = await render(makeItem({ title: null, url: 'https://example.com/b' }));
    expect(withoutTitle.root.findByProps({ children: 'https://example.com/b' })).toBeTruthy();
  });

  it('truncates the primary text to 2 lines and the URL to 1 line', async () => {
    const item = makeItem({ title: 'A title', url: 'https://example.com/very/long/path' });
    const renderer = await render(item);

    const primary = renderer.root.findByProps({ children: 'A title' });
    expect(primary.props.numberOfLines).toBe(2);

    const secondaryUrl = renderer.root.findByProps({ children: 'https://example.com/very/long/path' });
    expect(secondaryUrl.props.numberOfLines).toBe(1);
  });

  it('does not render a memo element when the item has no memo', async () => {
    const item = makeItem({ memo: null });
    const renderer = await render(item);

    // Every Text this row can render is accounted for by title/domain, URL, and time - no
    // fourth line of text should exist when there is no memo to show.
    expect(renderer.root.findAllByType(Text)).toHaveLength(3);
  });

  it('renders the memo when present, visually separate from the URL line', async () => {
    const item = makeItem({ memo: 'A short note' });
    const renderer = await render(item);

    const memo = renderer.root.findByProps({ children: 'A short note' });
    expect(memo).toBeTruthy();
    // Distinguished from the plain URL line so it doesn't read as another URL-like row.
    expect(memo.props.style).toMatchObject({ fontStyle: 'italic' });
  });
});
