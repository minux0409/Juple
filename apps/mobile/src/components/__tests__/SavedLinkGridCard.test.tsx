import ReactTestRenderer, { act } from 'react-test-renderer';
import { Image, Text } from 'react-native';
import { SavedLinkGridCard } from '../SavedLinkGridCard';
import { GlobeIcon } from '../../icons/GlobeIcon';
import { YouTubeIcon } from '../../icons/YouTubeIcon';
import type { ItemHistoryEntry } from '../../items/api/itemsApi';

function item(overrides: Partial<ItemHistoryEntry> = {}): ItemHistoryEntry {
  return { id: 1, url: 'https://example.com/a', title: 'Thumbnail first', memo: null, savedAtUtc: new Date().toISOString(), representativeImage: null, previewImageUrl: null, coverImage: null, ...overrides };
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

  it('uses a known site icon only when there is no representative image', async () => {
    const known = await render(item({ url: 'https://youtube.com/watch?v=1' }));
    expect(known.root.findAllByType(YouTubeIcon)).toHaveLength(1);
    const generic = await render(item());
    expect(generic.root.findAllByType(GlobeIcon)).toHaveLength(1);
  });
});
