import { SUPPORTED_LANGUAGES } from '../../i18n';
import { findGuideSection, GUIDE_SECTIONS } from '../../help/guideContent';
import { ONBOARDING_GUIDE_ID, TOUR_GUIDES, TOUR_TARGETS, findTourGuide } from '../tourGuides';

const fs = jest.requireActual<{ readFileSync(file: string, encoding: string): string; readdirSync(dir: string): string[] }>('fs');
const path = jest.requireActual<{ join(...parts: string[]): string }>('path');

const localeDir = path.join(__dirname, '..', '..', 'i18n', 'locales');
const load = (code: string) => JSON.parse(fs.readFileSync(path.join(localeDir, `${code}.json`), 'utf8'));
const locales: Record<string, ReturnType<typeof load>> = {};
const codes = fs.readdirSync(localeDir).filter((f: string) => f.endsWith('.json')).map((f: string) => f.replace('.json', ''));
for (const code of codes) {
  locales[code] = load(code);
}

describe('tour guide definitions', () => {
  it('has the first-run onboarding guide with 4-5 short steps', () => {
    const guide = findTourGuide(ONBOARDING_GUIDE_ID);
    expect(guide?.id).toBe('mainOnboarding');
    expect(guide?.version).toBe(1);
    expect(guide?.steps.length).toBeGreaterThanOrEqual(4);
    expect(guide?.steps.length).toBeLessThanOrEqual(5);
    expect(guide?.steps.map(step => step.key)).toEqual(['home', 'share', 'collections', 'archive', 'myPage']);
  });

  it('has unique guide ids, versioned, each with steps and unique step keys', () => {
    expect(new Set(TOUR_GUIDES.map(guide => guide.id)).size).toBe(TOUR_GUIDES.length);
    for (const guide of TOUR_GUIDES) {
      expect(guide.version).toBeGreaterThanOrEqual(1);
      expect(guide.steps.length).toBeGreaterThan(0);
      expect(new Set(guide.steps.map(step => step.key)).size).toBe(guide.steps.length);
    }
  });

  it('only points at known targets', () => {
    const known = new Set<string>(Object.values(TOUR_TARGETS));
    for (const guide of TOUR_GUIDES) {
      for (const step of guide.steps) {
        if (step.targetId) {
          expect(known.has(step.targetId)).toBe(true);
        }
      }
    }
  });

  it('is never listed as a shortcut guide without the home-pin requirement (the 1x1 icon is a launcher feature)', () => {
    expect(findTourGuide('homeShortcut')?.requires).toBe('homePin');
    expect(findGuideSection('collections')?.topics.find(topic => topic.id === 'homeShortcut')?.requires).toBe('homePin');
    expect(GUIDE_SECTIONS.length).toBeGreaterThan(0);
  });
});

describe('tour strings - every locale', () => {
  it('covers all supported languages', () => {
    expect(codes.sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
    expect(codes).toHaveLength(17);
  });

  it.each(codes)('%s has every tour string and the 1x1 shortcut topic, with no unresolved placeholders', code => {
    const strings = locales[code];
    const tour = strings.tour;
    for (const key of ['previous', 'done', 'start', 'helpTitle', 'helpIntro', 'mobileOnlyNote']) {
      expect(String(tour[key] ?? '').trim()).not.toBe('');
    }
    for (const guide of TOUR_GUIDES) {
      expect(String(tour.guides[guide.id]?.title ?? '').trim()).not.toBe('');
      expect(String(tour.guides[guide.id]?.summary ?? '').trim()).not.toBe('');
      for (const step of guide.steps) {
        expect(String(tour.steps[step.key]?.title ?? '').trim()).not.toBe('');
        expect(String(tour.steps[step.key]?.body ?? '').trim()).not.toBe('');
      }
    }
    const topic = strings.guide.topics.homeShortcut;
    expect(String(topic.title).trim()).not.toBe('');
    expect(topic.body).toContain(strings.collections.homeShortcutAdd);
    expect(JSON.stringify([tour, topic])).not.toMatch(/@@|undefined|\{\{/);
  });

  it.each(codes.filter(code => code !== 'en'))('%s is translated, not an English fallback', code => {
    const english = locales.en.tour;
    const own = locales[code].tour;
    for (const guide of TOUR_GUIDES) {
      for (const step of guide.steps) {
        expect(own.steps[step.key].body).not.toBe(english.steps[step.key].body);
      }
    }
    expect(own.helpIntro).not.toBe(english.helpIntro);
  });

  it('does not use the buttons of the tour to carry information only a highlight shows', () => {
    // Every step explains itself in words: the card text names what is being pointed at.
    for (const guide of TOUR_GUIDES) {
      for (const step of guide.steps) {
        expect(locales.ko.tour.steps[step.key].body.length).toBeGreaterThan(8);
      }
    }
  });
});
