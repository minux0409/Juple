import ReactTestRenderer, { act } from 'react-test-renderer';
import { Image, Text } from 'react-native';
import i18n from '../../i18n';
import { TutorialIllustration } from '../TutorialIllustration';
import { TutorialPage } from '../TutorialPage';
import { TUTORIAL_PAGES } from '../tutorialPages';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer;
}
const textsOf = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(node => String(node.props.children));

describe('TutorialIllustration', () => {
  it.each(TUTORIAL_PAGES.map(page => page.id))('%s: is a decorative, non-interactive mini-UI hidden from assistive technology', pageId => {
    const renderer = render(<TutorialIllustration pageId={pageId} />);
    const frame = renderer.root.find(node => node.props.testID === `tutorial-illustration-${pageId}` && typeof node.type === 'string');
    expect(frame.props.accessibilityElementsHidden).toBe(true);
    expect(frame.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(frame.props.pointerEvents).toBe('none');
  });

  it.each(TUTORIAL_PAGES.map(page => page.id))('%s: uses no bitmap or remote image', pageId => {
    const renderer = render(<TutorialIllustration pageId={pageId} />);
    expect(renderer.root.findAllByType(Image)).toHaveLength(0);
  });

  it('shows the Home / 보관함 labels and the date cue, and no search field on Home', () => {
    const texts = textsOf(render(<TutorialIllustration pageId="today" />));
    expect(texts).toEqual(expect.arrayContaining([i18n.t('tabs.home'), i18n.t('tabs.history'), i18n.t('history.today')]));
    expect(texts).not.toContain(i18n.t('history.searchPlaceholder'));
  });

  it('shows the search field, the sort controls and the three view modes on the find page', () => {
    const renderer = render(<TutorialIllustration pageId="find" />);
    const texts = textsOf(renderer);
    expect(texts).toEqual(expect.arrayContaining([i18n.t('history.searchPlaceholder'), i18n.t('collections.sortDate'), i18n.t('collections.sortName')]));
    const glyphs = renderer.root.findAll(node => ['view-mode-list-glyph', 'view-mode-grid-glyph', 'view-mode-image-glyph'].includes(String(node.props.testID)) && typeof node.type === 'string');
    expect(glyphs).toHaveLength(3);
  });

  it('shows Collection tiles with their own icon and color on the collections page', () => {
    const renderer = render(<TutorialIllustration pageId="collections" />);
    const backgrounds = renderer.root
      .findAll(node => typeof node.type === 'string' && node.props.style)
      .map(node => JSON.stringify(node.props.style))
      .filter(style => /"backgroundColor":"#[0-9A-Fa-f]{6}"/.test(style));
    expect(new Set(backgrounds.filter(style => style.includes('borderRadius'))).size).toBeGreaterThanOrEqual(3);
  });

  it('points to the Help Guide on the last page', () => {
    const texts = textsOf(render(<TutorialIllustration pageId="start" />));
    expect(texts).toEqual(expect.arrayContaining(['Juple', i18n.t('guide.title')]));
  });

  it('keeps the visible title and description on every page (the illustration carries no essential meaning)', () => {
    for (const page of TUTORIAL_PAGES) {
      const texts = textsOf(render(<TutorialPage page={page} />));
      expect(texts).toContain(i18n.t(`tutorial.pages.${page.id}.title`));
      expect(texts).toContain(i18n.t(`tutorial.pages.${page.id}.description`));
    }
  });
});
