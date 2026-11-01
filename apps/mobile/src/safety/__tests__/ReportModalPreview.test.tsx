import ReactTestRenderer, { act } from 'react-test-renderer';
import { Image, Text } from 'react-native';
import i18n from '../../i18n';
import { ReportModal } from '../ReportModal';

jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));

type Renderer = ReactTestRenderer.ReactTestRenderer;
const texts = (renderer: Renderer) => renderer.root.findAllByType(Text).map(node => String(node.props.children));
const LONG_URL = 'https://www.example.com/some/really/long/path/that/must/never/be/shown/in/the/report/dialog?utm_source=abcdefghijklmnopqrstuvwxyz0123456789';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

async function render(preview: { title: string | null; url: string | null; imageUrl: string | null }) {
  let renderer!: Renderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <ReportModal onClose={jest.fn()} onReported={jest.fn()} target={{ type: 'Item', itemId: 5, collectionId: 2 }} targetLabel={preview.title ?? LONG_URL} targetPreview={preview} />,
    );
  });
  return renderer;
}

describe('ReportModal - the reported link', () => {
  it('shows the picture and the title (with the host as a small line) - never the long address', async () => {
    const renderer = await render({ title: '친구가 공유한 아주 긴 제목의 링크', url: LONG_URL, imageUrl: 'https://img.example.com/p.jpg' });
    expect(texts(renderer)).toContain('친구가 공유한 아주 긴 제목의 링크');
    expect(texts(renderer)).toContain('example.com');
    expect(texts(renderer).some(text => text.includes('utm_source') || text.includes('/some/really/long'))).toBe(false);
    expect(renderer.root.findAllByType(Image).some(image => (image.props.source as { uri?: string }).uri === 'https://img.example.com/p.jpg')).toBe(true);
    expect(renderer.root.findAll(node => node.props.testID === 'report-target-title')[0].props.numberOfLines).toBe(2);
  });

  it('without a title the host stands in, and without a picture the link placeholder is drawn - still no address', async () => {
    const renderer = await render({ title: null, url: LONG_URL, imageUrl: null });
    expect(texts(renderer)).toContain('example.com');
    expect(texts(renderer).some(text => text.includes('utm_source'))).toBe(false);
    expect(renderer.root.findAll(node => node.props.testID === 'saved-link-thumbnail-placeholder').length).toBeGreaterThan(0);
  });

  it('keeps the five reasons, the explanation field and 취소 / 신고하기', async () => {
    const renderer = await render({ title: '제목', url: LONG_URL, imageUrl: null });
    for (const reason of ['Spam', 'SexualOrInappropriate', 'Harassment', 'IntellectualProperty', 'Other']) {
      expect(renderer.root.findAll(node => node.props.testID === `report-reason-${reason}`).length).toBeGreaterThan(0);
    }
    expect(renderer.root.findAll(node => node.props.testID === 'report-details').length).toBeGreaterThan(0);
    expect(renderer.root.findAll(node => node.props.testID === 'report-cancel').length).toBeGreaterThan(0);
    expect(renderer.root.findAll(node => node.props.testID === 'report-submit').length).toBeGreaterThan(0);
  });
});
