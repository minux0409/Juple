import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import i18n, { SUPPORTED_LANGUAGES } from '../../i18n';
import { GUIDE_SECTIONS } from '../../help/guideContent';
import { HelpGuideScreen } from '../HelpGuideScreen';
import { HelpGuideSectionScreen } from '../HelpGuideSectionScreen';

const fs = jest.requireActual<{ readFileSync(file: string, encoding: string): string }>('fs');
const path = jest.requireActual<{ join(...parts: string[]): string }>('path');

const mockNavigate = jest.fn();
let mockRouteParams: { sectionId: string } = { sectionId: 'collections' };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({ params: mockRouteParams }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
let mockSupport: { directShareSupported: boolean; homePinSupport: 'unknown' | 'supported' | 'unsupported' } = { directShareSupported: true, homePinSupport: 'supported' };
jest.mock('../../shortcuts/useCollectionShortcutSupport', () => ({
  useCollectionShortcutSupport: () => ({ ...mockSupport, refreshHomePinSupport: jest.fn() }),
}));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
beforeEach(() => {
  mockRouteParams = { sectionId: 'collections' };
  mockSupport = { directShareSupported: true, homePinSupport: 'supported' };
  mockNavigate.mockClear();
});

async function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer;
}
const texts = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(node => String(node.props.children));
const joined = (renderer: ReactTestRenderer.ReactTestRenderer) => texts(renderer).join('\n');
const byId = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.find(node => node.props.testID === testID && typeof node.props.onPress === 'function');
const topicIds = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAll(node => typeof node.type === 'string' && String(node.props.testID ?? '').startsWith('guide-topic-')).map(node => String(node.props.testID).replace('guide-topic-', ''));

const SHORTCUT_PARAGRAPH = "'홈 화면에 바로가기 추가'를 선택하면";

describe('Help Guide - the list', () => {
  it('lists every goal-based section with its title and summary, and opens a section', async () => {
    const renderer = await render(<HelpGuideScreen />);
    for (const section of GUIDE_SECTIONS) {
      expect(texts(renderer)).toContain(i18n.t(`guide.sections.${section.id}.title`));
      expect(texts(renderer)).toContain(i18n.t(`guide.sections.${section.id}.summary`));
    }
    await act(async () => byId(renderer, 'guide-section-sharing').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('HelpGuideSection', { sectionId: 'sharing' });
  });

  it('can replay the first-run introduction (records nothing)', async () => {
    const renderer = await render(<HelpGuideScreen />);
    await act(async () => byId(renderer, 'guide-replay-tutorial').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Tutorial', { mode: 'replay' });
  });

  it('keeps the three different ideas as separate topics: invitation, join request and link approval', () => {
    const sharing = GUIDE_SECTIONS.find(section => section.id === 'sharing')!;
    expect(sharing.topics.map(topic => topic.id)).toEqual(expect.arrayContaining(['invite', 'joinRequests', 'approvals']));
  });
});

describe('Help Guide - the long-press topic', () => {
  it('exists under 컬렉션으로 정리하기 with the approved title', async () => {
    const renderer = await render(<HelpGuideSectionScreen />);
    expect(topicIds(renderer)).toContain('longPress');
    expect(texts(renderer)).toContain('컬렉션을 길게 눌러 빠르게 관리하기');
  });

  it('says the menu depends on the Collection and the role - never a fixed list', async () => {
    const renderer = await render(<HelpGuideSectionScreen />);
    const text = joined(renderer);
    expect(text).toContain('컬렉션을 길게 누르면 자주 쓰는 기능이 바로 나와요.');
    expect(text).toContain('컬렉션과 내 권한에 따라 보이는 메뉴가 달라질 수 있어요.');
    expect(text).not.toMatch(/항상|모든 컬렉션에서/);
  });

  it('describes favorite, notifications, edit, lock and delete/leave with the approved copy', async () => {
    const text = joined(await render(<HelpGuideSectionScreen />));
    expect(text).toContain('자주 보는 컬렉션을 즐겨찾기에 모아요. 나에게만 적용돼요.');
    expect(text).toContain('함께 쓰는 컬렉션의 알림을 받을지 정해요.');
    expect(text).toContain('컬렉션 소유자만 사용할 수 있어요.');
    expect(text).toContain('공유 링크의 접근 비밀번호와는 다른 기능이에요.');
    expect(text).toContain('컬렉션을 삭제해도 안에 있던 링크는 삭제되지 않아요.');
  });

  it('describes the accessibility alternative to a long press', async () => {
    const text = joined(await render(<HelpGuideSectionScreen />));
    expect(text).toContain("컬렉션을 길게 누르거나 접근성 메뉴에서 '옵션'을 선택하세요.");
  });

  it('shows the Home-screen shortcut paragraph - with the locked note and the "delete it yourself" note - when the launcher supports it', async () => {
    mockSupport = { directShareSupported: true, homePinSupport: 'supported' };
    const text = joined(await render(<HelpGuideSectionScreen />));
    expect(text).toContain(SHORTCUT_PARAGRAPH);
    expect(text).toContain('잠긴 컬렉션은 바로가기로 열어도 비밀번호가 필요해요.');
    expect(text).toContain('만든 바로가기는 홈 화면에서 직접 삭제해야 해요.');
  });

  it.each(['unsupported', 'unknown'] as const)('omits the shortcut paragraph while support is %s', async homePinSupport => {
    mockSupport = { directShareSupported: true, homePinSupport };
    const text = joined(await render(<HelpGuideSectionScreen />));
    expect(text).not.toContain(SHORTCUT_PARAGRAPH);
    expect(text).not.toContain('만든 바로가기는');
    // the rest of the topic is still there
    expect(text).toContain('컬렉션을 길게 누르면 자주 쓰는 기능이 바로 나와요.');
  });

  it('never advertises the shortcut where the native module is absent (iOS and other platforms)', async () => {
    mockSupport = { directShareSupported: false, homePinSupport: 'unsupported' };
    const text = joined(await render(<HelpGuideSectionScreen />));
    expect(text).not.toContain('바로가기');
  });

  it('does not put 공유 대상에서 제거 in the general long-press topic', async () => {
    const renderer = await render(<HelpGuideSectionScreen />);
    const longPress = renderer.root.find(node => node.props.testID === 'guide-topic-longPress' && typeof node.type === 'string');
    const topicText = longPress.findAllByType(Text).map(node => String(node.props.children)).join('\n');
    expect(topicText).not.toContain(i18n.t('collections.shortcutRemove'));
  });
});

describe('Help Guide - Android shortcuts and Direct Share', () => {
  beforeEach(() => {
    mockRouteParams = { sectionId: 'save' };
  });

  it('is shown when the native shortcut module exists and explains that removal only affects Direct Share', async () => {
    const renderer = await render(<HelpGuideSectionScreen />);
    expect(topicIds(renderer)).toContain('androidShortcuts');
    const text = joined(renderer);
    expect(text).toContain(i18n.t('collections.shortcutRemove'));
    expect(text).toContain('공유 메뉴에서만 빼는 기능이에요. 컬렉션과 링크, 만들어 둔 홈 화면 바로가기는 그대로예요.');
    expect(text).toContain('잠겼거나 비밀번호가 있는 컬렉션, 링크를 추가할 수 없는 컬렉션은 공유 대상에 나오지 않아요.');
    expect(text).not.toMatch(/홈 화면(의)? 아이콘(을|도)? (제거|삭제)/);
  });

  it('cross-references the long-press topic instead of repeating it', async () => {
    const text = joined(await render(<HelpGuideSectionScreen />));
    expect(text).toContain('컬렉션을 길게 눌러 빠르게 관리하기');
    expect(text).not.toContain('만든 바로가기는 홈 화면에서 직접 삭제해야 해요.');
  });

  it('is omitted entirely where there is no native shortcut support', async () => {
    mockSupport = { directShareSupported: false, homePinSupport: 'unsupported' };
    const renderer = await render(<HelpGuideSectionScreen />);
    expect(topicIds(renderer)).not.toContain('androidShortcuts');
    expect(topicIds(renderer)).toEqual(expect.arrayContaining(['pasteShare', 'quickSave', 'review']));
  });
});

describe('Help Guide - the shortcut capability has one source', () => {
  const read = (relative: string) => fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');

  it('the Collection menu and the guide both derive it from useCollectionShortcutSupport', () => {
    expect(read('collections/useCollectionLongPressMenu.tsx')).toContain("from '../shortcuts/useCollectionShortcutSupport'");
    expect(read('screens/HelpGuideSectionScreen.tsx')).toContain("from '../shortcuts/useCollectionShortcutSupport'");
  });

  it('neither the guide nor the shared hook introduces a Platform.OS source of truth', () => {
    for (const file of ['screens/HelpGuideSectionScreen.tsx', 'screens/HelpGuideScreen.tsx', 'help/guideContent.ts', 'shortcuts/useCollectionShortcutSupport.ts']) {
      expect(read(file)).not.toMatch(/Platform\.OS|Platform\.select/);
    }
  });

  it('the menu no longer keeps a separate launcher-support state of its own', () => {
    expect(read('collections/useCollectionLongPressMenu.tsx')).not.toContain('setHomeSupported');
  });
});

describe('Help Guide - content in every locale', () => {
  const keys = [
    ...GUIDE_SECTIONS.flatMap(section => [`guide.sections.${section.id}.title`, `guide.sections.${section.id}.summary`]),
    ...GUIDE_SECTIONS.flatMap(section => section.topics.flatMap(topic => [
      `guide.topics.${topic.id}.title`,
      `guide.topics.${topic.id}.body`,
      ...(topic.extra ? [`guide.topics.${topic.id}.${topic.extra.key}`] : []),
    ])),
    'guide.title', 'guide.replayTutorial', 'hints.savedLinkSwipe', 'hints.collectionLongPress',
  ];

  it.each(SUPPORTED_LANGUAGES)('%s has every guide string', language => {
    const missing = keys.filter(key => !i18n.exists(key, { lng: language }));
    expect(missing).toEqual([]);
  });

  it('the swipe hint does not promise specific actions', () => {
    expect(i18n.t('hints.savedLinkSwipe', { lng: 'ko' })).toBe('링크를 옆으로 밀면 빠른 작업을 할 수 있어요.');
    expect(i18n.t('hints.collectionLongPress', { lng: 'ko' })).toBe('컬렉션을 길게 눌러 빠른 관리 기능을 확인해 보세요.');
  });
});
