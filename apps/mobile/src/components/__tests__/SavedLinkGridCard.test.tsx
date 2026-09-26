import ReactTestRenderer, { act } from 'react-test-renderer';
import { Image, PixelRatio, StyleSheet, Text } from 'react-native';
import i18n from '../../i18n';
import { SAVED_LINK_GRID_TITLE_MAX_LINES, SavedLinkGridCard, SavedLinkGridCell, savedLinkGridLayout } from '../SavedLinkGridCard';
import { SwipeableItemRow } from '../SwipeableItemRow';
import { SavedLinkRow } from '../SavedLinkRow';
import { formatSavedLinkTimestamp, SavedLinkMetaRow } from '../SavedLinkMetaRow';
import { GlobeIcon } from '../../icons/GlobeIcon';
import { InstagramIcon } from '../../icons/InstagramIcon';
import { YouTubeIcon } from '../../icons/YouTubeIcon';
import type { ItemHistoryEntry } from '../../items/api/itemsApi';

function item(overrides: Partial<ItemHistoryEntry> = {}): ItemHistoryEntry {
  return { id: 1, url: 'https://example.com/a', title: 'Thumbnail first', memo: null, savedAtUtc: new Date().toISOString(), representativeImage: null, previewImageUrl: null, coverImage: null, ...overrides };
}

/** Icons in the image placeholder area only - the shared meta row renders its own platform icon too. */
function iconsOutsideMetaRow(renderer: ReactTestRenderer.ReactTestRenderer, icon: React.ElementType) {
  const inMetaRow = new Set(renderer.root.findByType(SavedLinkMetaRow).findAllByType(icon));
  return renderer.root.findAllByType(icon).filter(node => !inMetaRow.has(node));
}

async function render(entry: ItemHistoryEntry) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<SavedLinkGridCard isActionInFlight={false} item={entry} preferEffectiveThumbnail />); });
  return renderer;
}

describe('SavedLinkGridCard', () => {
  it('renders the effective image as a square visual before the title', async () => {
    const renderer = await render(item({ previewImageUrl: 'https://cdn.example/image.jpg' }));
    const image = renderer.root.findByType(Image);
    expect(image.props.source.uri).toBe('https://cdn.example/image.jpg');
    expect(renderer.root.findAllByType(Text)[0].props.children).toBe('Thumbnail first');
    expect(image.props.style.height).toBe('100%');
  });

  it('uses a known site icon as the image placeholder only when there is no representative image', async () => {
    const known = await render(item({ url: 'https://youtube.com/watch?v=1' }));
    expect(iconsOutsideMetaRow(known, YouTubeIcon)).toHaveLength(1);
    const generic = await render(item());
    expect(iconsOutsideMetaRow(generic, GlobeIcon)).toHaveLength(1);
  });

  it('shows a real Instagram preview image instead of the generic Instagram icon placeholder', async () => {
    const renderer = await render(item({ url: 'https://www.instagram.com/p/ABC123xyz/', previewImageUrl: 'https://scontent.cdninstagram.com/v/t51/real-post.jpg' }));
    expect(renderer.root.findByType(Image).props.source.uri).toBe('https://scontent.cdninstagram.com/v/t51/real-post.jpg');
    expect(iconsOutsideMetaRow(renderer, InstagramIcon)).toHaveLength(0);
    const noImage = await render(item({ url: 'https://www.instagram.com/p/ABC123xyz/', title: null }));
    expect(iconsOutsideMetaRow(noImage, InstagramIcon)).toHaveLength(1);
  });

  it.each([
    ['YouTube', 'https://www.youtube.com/watch?v=abc', YouTubeIcon],
    ['Instagram', 'https://www.instagram.com/p/ABC123xyz/', InstagramIcon],
    ['a generic site', 'https://daangn.com/articles/1', GlobeIcon],
  ])('secondary row for %s: saved time + that platform icon, never a hostname/site name', async (_label, url, Icon) => {
    const savedAtUtc = '2026-09-24T13:06:00Z';
    const renderer = await render(item({ url, savedAtUtc, memo: 'a memo', previewImageUrl: 'https://cdn.example/image.jpg' }));

    const metaRow = renderer.root.findByType(SavedLinkMetaRow);
    expect(metaRow.findAllByType(Icon)).toHaveLength(1);
    const metaTexts = metaRow.findAllByType(Text).map(node => node.props.children);
    expect(metaTexts).toEqual([formatSavedLinkTimestamp(savedAtUtc, 'time')]);
    const allTexts = renderer.root.findAllByType(Text).map(node => node.props.children);
    for (const siteText of ['YouTube', 'Instagram', 'daangn.com', 'a memo']) {
      expect(allTexts).not.toContain(siteText);
    }
  });

  it('uses the exact same timestamp field and formatter as the List row for the same mode', async () => {
    const entry = item({ savedAtUtc: '2026-09-20T01:02:00Z', url: 'https://www.youtube.com/watch?v=abc' });
    for (const mode of ['time', 'dateTime'] as const) {
      let grid!: ReactTestRenderer.ReactTestRenderer;
      let list!: ReactTestRenderer.ReactTestRenderer;
      await act(async () => {
        grid = ReactTestRenderer.create(<SavedLinkGridCard dateDisplayMode={mode} isActionInFlight={false} item={entry} />);
        list = ReactTestRenderer.create(<SavedLinkRow dateDisplayMode={mode} isActionInFlight={false} item={entry} />);
      });
      const gridMeta = grid.root.findByType(SavedLinkMetaRow).props;
      const listMeta = list.root.findByType(SavedLinkMetaRow).props;
      expect(gridMeta).toMatchObject({ savedAtUtc: entry.savedAtUtc, url: entry.url, dateDisplayMode: mode });
      expect(listMeta).toMatchObject({ savedAtUtc: entry.savedAtUtc, url: entry.url, dateDisplayMode: mode });
      expect(grid.root.findByType(SavedLinkMetaRow).findByType(Text).props.children)
        .toBe(list.root.findByType(SavedLinkMetaRow).findByType(Text).props.children);
    }
  });

  it('shows the localized Instagram reel label instead of a bare "instagram.com" when the title is missing', async () => {
    const renderer = await render(item({ url: 'https://www.instagram.com/reel/ABC123xyz/?igsh=abc', title: null }));
    const titleText = renderer.root.findAllByType(Text)[0];
    expect(titleText.props.children).toBe(i18n.t('item.fallbackInstagramReel'));
    expect(titleText.props.children).not.toBe('instagram.com');
  });

  it('reserves the same title/meta height for short and long titles so a 2-column grid stays regular', async () => {
    const layoutOf = (renderer: ReactTestRenderer.ReactTestRenderer) => ({
      texts: renderer.root.findAllByType(Text).map(node => ({ lines: node.props.numberOfLines, style: StyleSheet.flatten(node.props.style) })),
      meta: StyleSheet.flatten(renderer.root.findByType(SavedLinkMetaRow).props.style),
    });
    const short = layoutOf(await render(item({ title: 'Hi' })));
    const long = layoutOf(await render(item({ title: 'A very long title that will certainly need to wrap across more than two lines in a narrow grid card' })));
    expect(short).toEqual(long);
    const [title, time] = short.texts;
    expect(title.lines).toBe(SAVED_LINK_GRID_TITLE_MAX_LINES);
    expect(title.style.minHeight).toBe((title.style.lineHeight as number) * SAVED_LINK_GRID_TITLE_MAX_LINES * PixelRatio.getFontScale());
    // Secondary row: exactly one line, with a reserved height.
    expect(time.lines).toBe(1);
    expect(short.meta.minHeight).toBeGreaterThan(0);
  });
});

describe('SavedLinkGridCell', () => {
  it('keeps spacing outside the clipped swipe wrapper, so no action pane can paint a frame around the card', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<SavedLinkGridCell isActionInFlight={false} item={item()} onDelete={jest.fn()} onPress={jest.fn()} onShare={jest.fn()} preferEffectiveThumbnail />);
    });
    const swipeRow = renderer.root.findByType(SwipeableItemRow);
    const wrapperStyle = StyleSheet.flatten(swipeRow.props.containerStyle);
    expect(wrapperStyle.padding ?? wrapperStyle.paddingHorizontal ?? wrapperStyle.paddingVertical).toBeUndefined();
    expect(wrapperStyle.flexGrow).toBe(1);
    expect(StyleSheet.flatten(savedLinkGridLayout.cell)).toMatchObject({ flexBasis: '50%', maxWidth: '50%' });
    // At rest the share/delete panes are not mounted at all - 0px of red/blue.
    expect(renderer.root.findAll(node => node.props.accessibilityLabel === i18n.t('common.delete') && node.props.accessibilityRole === 'button')).toHaveLength(0);
    expect(swipeRow.findAllByType(SavedLinkGridCard)).toHaveLength(1);
  });
});
