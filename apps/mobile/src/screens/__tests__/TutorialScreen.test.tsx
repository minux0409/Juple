import ReactTestRenderer, { act } from 'react-test-renderer';
import { BackHandler, PanResponder, ScrollView, Text } from 'react-native';
import i18n from '../../i18n';
import { TutorialScreen } from '../TutorialScreen';
import { TUTORIAL_PAGES } from '../../support/tutorialPages';
import { markTutorialCompleted } from '../../settings/tutorialPreference';

const mockGoBack = jest.fn();
let mockParams: { mode: 'firstRun'; userKey: string } | { mode: 'replay' } = { mode: 'firstRun', userKey: 'JUPLE-1' };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../../settings/tutorialPreference', () => ({ markTutorialCompleted: jest.fn(async () => undefined) }));

let backHandlers: (() => boolean)[] = [];
let panConfig: { onPanResponderRelease: (event: unknown, gesture: { dx: number; dy: number }) => void; onMoveShouldSetPanResponder: (event: unknown, gesture: { dx: number; dy: number }) => boolean };

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
beforeEach(() => {
  mockParams = { mode: 'firstRun', userKey: 'JUPLE-1' };
  backHandlers = [];
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    backHandlers.push(handler as () => boolean);
    return { remove: () => undefined };
  });
  const create = PanResponder.create.bind(PanResponder);
  jest.spyOn(PanResponder, 'create').mockImplementation(config => {
    panConfig = config as unknown as typeof panConfig;
    return create(config);
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<TutorialScreen />);
  });
  return renderer;
}
const byId = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.find(node => node.props.testID === testID && typeof node.props.onPress === 'function');
const exists = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => renderer.root.findAll(node => node.props.testID === testID).length > 0;
const texts = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(node => String(node.props.children));
const next = async (renderer: ReactTestRenderer.ReactTestRenderer) => {
  await act(async () => {
    byId(renderer, 'tutorial-next').props.onPress();
  });
};

describe('TutorialScreen - content and navigation', () => {
  it('is six short pages (at most seven), each with a title and a description in every locale', () => {
    expect(TUTORIAL_PAGES.map(page => page.id)).toEqual(['save', 'today', 'collections', 'share', 'find', 'start']);
    expect(TUTORIAL_PAGES.length).toBeLessThanOrEqual(7);
    for (const page of TUTORIAL_PAGES) {
      expect(i18n.exists(`tutorial.pages.${page.id}.title`)).toBe(true);
      expect(i18n.exists(`tutorial.pages.${page.id}.description`)).toBe(true);
    }
  });

  it('starts on 링크 저장 (v2 copy) with 건너뛰기 and 다음; Next walks the pages in order up to 시작하기', async () => {
    const renderer = await renderScreen();
    expect(texts(renderer)).toContain('링크는 어디서든 저장해요');
    expect(texts(renderer)).toContain('건너뛰기');
    expect(texts(renderer)).toContain('다음');

    const seen: string[] = [];
    for (let index = 0; index < TUTORIAL_PAGES.length; index++) {
      seen.push(texts(renderer).find(text => TUTORIAL_PAGES.some(page => text === i18n.t(`tutorial.pages.${page.id}.title`)))!);
      if (index < TUTORIAL_PAGES.length - 1) {
        await next(renderer);
      }
    }
    expect(seen).toEqual(TUTORIAL_PAGES.map(page => i18n.t(`tutorial.pages.${page.id}.title`)));
    expect(texts(renderer)).toContain('시작하기');
    expect(texts(renderer)).not.toContain('다음');
  });

  it('shows one progress announcement for the whole indicator, not one per dot', async () => {
    const renderer = await renderScreen();
    const progress = renderer.root.find(node => node.props.testID === 'tutorial-progress' && typeof node.type === 'string');
    expect(progress.props.accessibilityLabel).toBe('1 / 6');
    expect(progress.props.accessible).toBe(true);
    await next(renderer);
    expect(renderer.root.find(node => node.props.testID === 'tutorial-progress' && typeof node.type === 'string').props.accessibilityLabel).toBe('2 / 6');
    expect(renderer.root.find(node => node.props.testID === 'tutorial-progress' && typeof node.type === 'string').findAll(node => node.props.importantForAccessibility === 'no-hide-descendants')).not.toHaveLength(0);
  });

  it('swipes between pages when the gesture is clearly horizontal, and never past either end', async () => {
    const renderer = await renderScreen();
    expect(panConfig.onMoveShouldSetPanResponder({}, { dx: 40, dy: 5 })).toBe(true);
    expect(panConfig.onMoveShouldSetPanResponder({}, { dx: 40, dy: 60 })).toBe(false);

    await act(async () => panConfig.onPanResponderRelease({}, { dx: -80, dy: 0 }));
    expect(texts(renderer)).toContain(i18n.t('tutorial.pages.today.title'));
    await act(async () => panConfig.onPanResponderRelease({}, { dx: 80, dy: 0 }));
    expect(texts(renderer)).toContain(i18n.t('tutorial.pages.save.title'));
    await act(async () => panConfig.onPanResponderRelease({}, { dx: 80, dy: 0 }));
    expect(texts(renderer)).toContain(i18n.t('tutorial.pages.save.title'));
    await act(async () => panConfig.onPanResponderRelease({}, { dx: -10, dy: 0 }));
    expect(texts(renderer)).toContain(i18n.t('tutorial.pages.save.title'));
  });

  it('keeps its buttons outside the scrolling page, so a long translation never pushes them off screen', async () => {
    const renderer = await renderScreen();
    const scroll = renderer.root.findByType(ScrollView);
    expect(scroll.findAll(node => node.props.testID === 'tutorial-next')).toHaveLength(0);
    expect(scroll.findAll(node => node.props.testID === 'tutorial-skip')).toHaveLength(0);
  });
});

describe('TutorialScreen - first run', () => {
  it('건너뛰기 marks this person\'s tutorial completed and closes', async () => {
    const renderer = await renderScreen();
    await act(async () => {
      byId(renderer, 'tutorial-skip').props.onPress();
    });
    expect(markTutorialCompleted).toHaveBeenCalledWith('JUPLE-1');
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('시작하기 on the last page marks completed and closes', async () => {
    const renderer = await renderScreen();
    for (let index = 0; index < TUTORIAL_PAGES.length - 1; index++) {
      await next(renderer);
    }
    expect(markTutorialCompleted).not.toHaveBeenCalled();
    await next(renderer);
    expect(markTutorialCompleted).toHaveBeenCalledWith('JUPLE-1');
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('Android back is Skip: marks completed, closes and is handled (never leaves it to repeat every launch)', async () => {
    await renderScreen();
    expect(backHandlers).toHaveLength(1);
    let handled = false;
    await act(async () => {
      handled = backHandlers[0]();
    });
    expect(handled).toBe(true);
    expect(markTutorialCompleted).toHaveBeenCalledWith('JUPLE-1');
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('closes only once however it is dismissed twice', async () => {
    const renderer = await renderScreen();
    await act(async () => {
      byId(renderer, 'tutorial-skip').props.onPress();
      backHandlers[0]();
    });
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(markTutorialCompleted).toHaveBeenCalledTimes(1);
  });
});

describe('TutorialScreen - replay', () => {
  beforeEach(() => {
    mockParams = { mode: 'replay' };
  });

  it('has a close button instead of 건너뛰기, and closing records nothing', async () => {
    const renderer = await renderScreen();
    expect(exists(renderer, 'tutorial-skip')).toBe(false);
    expect(byId(renderer, 'tutorial-close').props.accessibilityLabel).toBe('닫기');
    await act(async () => {
      byId(renderer, 'tutorial-close').props.onPress();
    });
    expect(markTutorialCompleted).not.toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('back and 시작하기 simply close - the first-run record is never touched', async () => {
    const renderer = await renderScreen();
    await act(async () => {
      backHandlers[0]();
    });
    expect(mockGoBack).toHaveBeenCalledTimes(1);

    mockGoBack.mockClear();
    const second = await renderScreen();
    for (let index = 0; index < TUTORIAL_PAGES.length; index++) {
      await next(second);
    }
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(markTutorialCompleted).not.toHaveBeenCalled();
    renderer.unmount();
  });
});
