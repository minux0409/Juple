import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import i18n, { SUPPORTED_LANGUAGES } from '../../i18n';
import { GUIDE_SECTIONS } from '../../help/guideContent';
import { HelpGuideScreen } from '../HelpGuideScreen';
import { HelpGuideSectionScreen } from '../HelpGuideSectionScreen';
import { startTour } from '../../tour/tourController';

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
jest.mock('../../tour/tourController', () => ({ startTour: jest.fn(() => true) }));
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

  it('can open the six-page introduction (records nothing)', async () => {
    const renderer = await render(<HelpGuideScreen />);
    await act(async () => byId(renderer, 'guide-replay-tutorial').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Tutorial');
  });

  it('keeps the three different ideas as separate topics: invitation, join request and link approval', () => {
    const sharing = GUIDE_SECTIONS.find(section => section.id === 'sharing')!;
    expect(sharing.topics.map(topic => topic.id)).toEqual(expect.arrayContaining(['invite', 'joinRequests', 'approvals']));
  });
});

describe('Help Guide - selecting several (long-press starts multi-selection)', () => {
  beforeEach(() => {
    mockRouteParams = { sectionId: 'selection' };
  });

  it('has its own section with one topic for links and one for Collections', async () => {
    const renderer = await render(<HelpGuideSectionScreen />);
    expect(topicIds(renderer)).toEqual(['selectLinks', 'selectCollections']);
  });

  it('describes the real bottom-bar actions: Home/Archive vs inside a Collection, and the Collection bar (no favorite on it)', async () => {
    const text = joined(await render(<HelpGuideSectionScreen />));
    expect(text).toContain('링크를 길게 누르면 선택 모드가 시작되고');
    expect(text).toContain('컬렉션 변경으로 선택한 링크가 담길 컬렉션을 한 번에 정하고');
    expect(text).toContain('공유 컬렉션에서는 내가 추가한 링크만 이동할 수 있고');
    expect(text).toContain('아래 막대에서 잠금과 삭제 또는 나가기를 쓸 수 있어요.');
    expect(text).toContain('더보기에서 알림 켜기·끄기, 공유, 수정을 쓸 수 있어요.');
    expect(text).not.toMatch(/막대[^.]*즐겨찾기/);
  });

  it('explains the mixed delete-and-leave confirmation with the real button name, and that links survive a deleted Collection', async () => {
    const text = joined(await render(<HelpGuideSectionScreen />));
    expect(text).toContain(`'${i18n.t('selection.deleteAndLeaveConfirm')}'`);
    expect(text).toContain('컬렉션을 삭제해도 안에 있던 링크는 삭제되지 않아요.');
  });

  it('says the buttons depend on the Collection and the role - never a fixed list', async () => {
    const text = joined(await render(<HelpGuideSectionScreen />));
    expect(text).toContain('보이는 버튼은 컬렉션과 내 권한에 따라 달라요.');
    expect(text).not.toMatch(/항상|모든 컬렉션에서/);
  });
});

describe('Help Guide - Collections', () => {
  it('favorites are the star on each Collection, plus the filter buttons', async () => {
    const text = joined(await render(<HelpGuideSectionScreen />));
    expect(text).toContain('컬렉션의 별을 누르면 즐겨찾기에 추가되고');
    expect(text).toContain('나에게만 적용돼요.');
  });

  it('shows the Home-screen shortcut topic - with the locked note and the "delete it yourself" note - only when the launcher supports it', async () => {
    mockSupport = { directShareSupported: true, homePinSupport: 'supported' };
    const supported = joined(await render(<HelpGuideSectionScreen />));
    expect(supported).toContain('잠긴 컬렉션은 아이콘으로 열어도 비밀번호를 입력해야 해요.');
    expect(supported).toContain('아이콘을 없애려면 홈 화면에서 직접 삭제해야 해요.');
    for (const homePinSupport of ['unsupported', 'unknown'] as const) {
      mockSupport = { directShareSupported: true, homePinSupport };
      const text = joined(await render(<HelpGuideSectionScreen />));
      expect(text).not.toContain('1×1');
      expect(text).toContain('컬렉션 탭의 + 버튼을 누르세요.');
    }
  });

  it('never advertises the shortcut where the native module is absent (iOS and other platforms)', async () => {
    mockSupport = { directShareSupported: false, homePinSupport: 'unsupported' };
    const text = joined(await render(<HelpGuideSectionScreen />));
    expect(text).not.toContain('바로가기');
  });

  it('copy/move is the selection bar inside a Collection, and removing is not deleting', async () => {
    const text = joined(await render(<HelpGuideSectionScreen />));
    expect(text).toContain('링크를 길게 눌러 선택한 뒤 아래 막대에서 다른 컬렉션으로 이동하거나 복사할 수 있어요.');
    expect(text).toContain('이 컬렉션에서만 빠지고 내 링크는 그대로 남아요.');
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

  it('cross-references the Home screen shortcut topic instead of repeating it', async () => {
    const text = joined(await render(<HelpGuideSectionScreen />));
    expect(text).toContain(`'${i18n.t('guide.topics.homeShortcut.title').replace(' (1×1)', '')}'`);
    expect(text).not.toContain('아이콘을 없애려면 홈 화면에서 직접 삭제해야 해요.');
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

  it('the Collection selection bar and the guide both derive it from useCollectionShortcutSupport', () => {
    expect(read('collections/useCollectionSelection.tsx')).toContain("from '../shortcuts/useCollectionShortcutSupport'");
    expect(read('screens/HelpGuideSectionScreen.tsx')).toContain("from '../shortcuts/useCollectionShortcutSupport'");
  });

  it('neither the guide nor the shared hook introduces a Platform.OS source of truth', () => {
    for (const file of ['screens/HelpGuideSectionScreen.tsx', 'screens/HelpGuideScreen.tsx', 'help/guideContent.ts', 'shortcuts/useCollectionShortcutSupport.ts']) {
      expect(read(file)).not.toMatch(/Platform\.OS|Platform\.select/);
    }
  });

  it('the selection no longer keeps a separate launcher-support state of its own', () => {
    expect(read('collections/useCollectionSelection.tsx')).not.toContain('setHomeSupported');
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

describe('Help Guide - 기능 가이드 (guided tours)', () => {
  beforeEach(() => {
    (startTour as jest.Mock).mockClear();
  });

  const tourIds = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    renderer.root.findAll(node => typeof node.props.onPress === 'function' && String(node.props.testID ?? '').startsWith('guide-tour-')).map(node => String(node.props.testID).replace('guide-tour-', ''));

  it('lists the guides with a short title, a one-line summary and a 가이드 보기 button, and starts the chosen one', async () => {
    const renderer = await render(<HelpGuideScreen />);
    expect(texts(renderer)).toContain(i18n.t('tour.helpTitle'));
    expect(tourIds(renderer)).toEqual(['mainOnboarding', 'saveLink', 'shareMenu', 'collections', 'friends', 'settings', 'homeShortcut']);
    expect(texts(renderer)).toContain(i18n.t('tour.guides.saveLink.title'));
    expect(texts(renderer)).toContain(i18n.t('tour.guides.saveLink.summary'));
    await act(async () => byId(renderer, 'guide-tour-saveLink').props.onPress());
    expect(startTour).toHaveBeenCalledWith('saveLink');
  });

  it('can start any guide again, finished or not (nothing is recorded or disabled)', async () => {
    const renderer = await render(<HelpGuideScreen />);
    await act(async () => byId(renderer, 'guide-tour-mainOnboarding').props.onPress());
    await act(async () => byId(renderer, 'guide-tour-mainOnboarding').props.onPress());
    expect(startTour).toHaveBeenCalledTimes(2);
  });

  it('lists the 1x1 Home screen shortcut guide only where the launcher can pin icons (never promised where it cannot)', async () => {
    mockSupport = { directShareSupported: false, homePinSupport: 'unsupported' };
    const unsupported = await render(<HelpGuideScreen />);
    expect(tourIds(unsupported)).not.toContain('homeShortcut');
    mockSupport = { directShareSupported: true, homePinSupport: 'unknown' };
    const unknown = await render(<HelpGuideScreen />);
    expect(tourIds(unknown)).not.toContain('homeShortcut');
  });

  it('explains the 1x1 shortcut as a Help topic with the real menu entry, only where supported', async () => {
    const supported = await render(<HelpGuideSectionScreen />);
    expect(topicIds(supported)).toContain('homeShortcut');
    expect(joined(supported)).toContain(i18n.t('selection.shortcut'));
    expect(joined(supported)).toContain('1×1');
    mockSupport = { directShareSupported: false, homePinSupport: 'unsupported' };
    const unsupported = await render(<HelpGuideSectionScreen />);
    expect(topicIds(unsupported)).not.toContain('homeShortcut');
  });
});

describe('Help Guide - features without a spotlight tour are still findable', () => {
  it('has a written topic for profile photo, notifications, locked Collections, shared Collections and the 1x1 shortcut, in every locale', () => {
    const ids = GUIDE_SECTIONS.flatMap(section => section.topics.map(topic => topic.id));
    for (const id of ['profilePhoto', 'notificationCenter', 'collectionLock', 'invite', 'roles', 'homeShortcut']) {
      expect(ids).toContain(id);
    }
    for (const language of SUPPORTED_LANGUAGES) {
      for (const id of ['profilePhoto', 'notificationCenter', 'collectionLock', 'homeShortcut']) {
        expect(i18n.getResource(language, 'translation', `guide.topics.${id}.title`)).toEqual(expect.any(String));
        expect(i18n.getResource(language, 'translation', `guide.topics.${id}.body`)).toEqual(expect.any(String));
      }
    }
  });

  it('calls the 1x1 icon a Home screen shortcut, never a widget', () => {
    const fsx = jest.requireActual<{ readFileSync(file: string, encoding: string): string }>('fs');
    const pathx = jest.requireActual<{ join(...parts: string[]): string }>('path');
    const ko = JSON.parse(fsx.readFileSync(pathx.join(__dirname, '..', '..', 'i18n', 'locales', 'ko.json'), 'utf8'));
    const text = JSON.stringify([ko.tour, ko.guide.topics.homeShortcut, ko.guide.topics.androidShortcuts]);
    expect(text).not.toMatch(/위젯|widget/i);
    expect(text).toContain('바로가기');
  });
});

describe('Help Guide - the selection topic in every language', () => {
  it('names 공유 and the mixed delete-and-leave button in each language own words; the friend tour offers no 신고 / 차단 as friend actions', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const body = String(i18n.getResource(language, 'translation', 'guide.topics.selectCollections.body'));
      expect(body).toContain(String(i18n.getResource(language, 'translation', 'common.share')));
      expect(body).toContain(String(i18n.getResource(language, 'translation', 'selection.deleteAndLeaveConfirm')));
    }
    const ko = (key: string) => String(i18n.getResource('ko', 'translation', key));
    for (const key of ['tour.steps.friendsEntry.body', 'tour.steps.friendsTabs.body', 'tour.guides.friends.summary']) {
      // 차단한 사용자 is a tab (to release an existing block); nothing says a friend can be reported or newly blocked.
      expect(ko(key)).not.toMatch(/신고|친구를 차단|차단하/);
    }
    expect(ko('tour.steps.friendsTabs.body')).toContain(ko('safety.blockedUsers'));
  });
});
