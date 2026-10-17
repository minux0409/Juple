import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { getAppDictionary } from '../lib/appDictionary.ts';
import { APP_LANGUAGES } from '../lib/appI18n.ts';
import {
  TOUR_EDGE,
  TOUR_GAP,
  TOUR_GUIDES,
  TOUR_SPOTLIGHT_PADDING,
  TOUR_TARGETS,
  findTourGuide,
  findTourTarget,
  isOnRoute,
  navTourTarget,
  placeCard,
  sameRect,
  settingsTourTarget,
  spotlightFor,
  tourTarget,
} from '../lib/tour.ts';

const root = new URL('../', import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), 'utf8');
const VIEWPORT = { width: 1200, height: 800 };
const CARD = { width: 360, height: 200 };

function walk(directory: string, found: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) {
      continue;
    }
    const full = join(directory, name);
    if (statSync(full).isDirectory()) {
      walk(full, found);
    } else if (/\.(ts|tsx)$/.test(name)) {
      found.push(full);
    }
  }
  return found;
}

describe('tour guides (Web)', () => {
  it('has the main onboarding guide with 4-5 short steps, versioned', () => {
    const guide = findTourGuide('mainOnboarding');
    assert.ok(guide);
    assert.equal(guide.version, 1);
    assert.ok(guide.steps.length >= 4 && guide.steps.length <= 5);
  });

  it('only lists guides for features a browser has: no share-menu or 1x1 Home screen shortcut guide', () => {
    assert.deepEqual(TOUR_GUIDES.map(guide => guide.id), ['mainOnboarding', 'saveLink', 'collections', 'friends', 'settings']);
    assert.equal(findTourGuide('shareMenu'), undefined);
    assert.equal(findTourGuide('homeShortcut'), undefined);
    const help = source('app/(app)/me/help/page.tsx');
    assert.match(help, /dictionary\.tourMobileOnlyNote/, 'the page says some guides are mobile-only');
    assert.doesNotMatch(help, /homeShortcut|1×1/);
  });

  it('every step has a title and a body in all 17 languages, translated (not the English text)', () => {
    const english = getAppDictionary('en');
    for (const language of APP_LANGUAGES) {
      const words = getAppDictionary(language);
      for (const guide of TOUR_GUIDES) {
        assert.ok(words[`tourGuide_${guide.id}_Title`].trim().length > 0, `${language} ${guide.id} title`);
        assert.ok(words[`tourGuide_${guide.id}_Summary`].trim().length > 0, `${language} ${guide.id} summary`);
        for (const step of guide.steps) {
          const title = words[`tourStep_${step.key}_Title`];
          const body = words[`tourStep_${step.key}_Body`];
          assert.ok(title.trim().length > 0 && body.trim().length > 0, `${language} ${step.key}`);
          assert.doesNotMatch(`${title}${body}`, /\{\{|undefined|@@/);
          if (language !== 'en') {
            assert.notEqual(body, english[`tourStep_${step.key}_Body`], `${language} ${step.key} is translated`);
          }
        }
      }
      for (const key of ['tourPrevious', 'tourDone', 'tourStart', 'tourHelpTitle', 'tourHelpIntro', 'tourMobileOnlyNote', 'tourNext', 'tourSkip', 'tourProgress', 'helpGuideTitle'] as const) {
        assert.ok(words[key].trim().length > 0, `${language}.${key}`);
      }
      assert.match(words.tourProgress, /\{current\}.*\{total\}/);
    }
    assert.equal(getAppDictionary('ko').tourPrevious, '이전');
    assert.equal(getAppDictionary('ko').tourDone, '완료');
    assert.equal(getAppDictionary('ko').tourSkip, '건너뛰기');
  });

  it('every target a step names is marked on a real page, through tourTarget (no selector strings elsewhere)', () => {
    const files = walk(fileURLToPath(new URL('app/', root)));
    const text = files.map(file => readFileSync(file, 'utf8')).join('\n');
    const used = new Set([TOUR_TARGETS.homeInput, TOUR_TARGETS.homeCheck, TOUR_TARGETS.collectionsCreate, TOUR_TARGETS.collectionsViewMode, TOUR_TARGETS.friendsTabs]);
    for (const id of used) {
      const key = Object.entries(TOUR_TARGETS).find(([, value]) => value === id)![0];
      assert.match(text, new RegExp(`TOUR_TARGETS\\.${key}`), `${key} is marked`);
    }
    assert.match(source('app/(app)/AppShell.tsx'), /navTourTarget\(item\.href\)/);
    assert.match(source('app/(app)/me/layout.tsx'), /settingsTourTarget\(item\.key\)/);
    for (const guide of TOUR_GUIDES) {
      for (const step of guide.steps) {
        if (step.targetId) {
          assert.ok(Object.values(TOUR_TARGETS).includes(step.targetId), `${guide.id}/${step.key}`);
        }
      }
    }
    // the attribute name appears in the one library only
    const offenders = files.filter(file => /data-tour-id|querySelector\(.*tour/.test(readFileSync(file, 'utf8')));
    assert.deepEqual(offenders, [], 'pages use tourTarget(), not hand-written attributes or selectors');
  });

  it('nav and settings markers map the real destinations', () => {
    assert.deepEqual(navTourTarget('/collections'), { 'data-tour-id': 'nav.collections' });
    assert.deepEqual(navTourTarget('/me/trash'), {});
    assert.deepEqual(settingsTourTarget('language'), { 'data-tour-id': 'settings.language' });
    assert.deepEqual(settingsTourTarget('profile'), {});
    assert.deepEqual(tourTarget(TOUR_TARGETS.homeInput), { 'data-tour-id': 'home.input' });
  });

  it('finds a target through one lookup and never throws on an odd id', () => {
    const seen: string[] = [];
    const fakeRoot = { querySelector: (selector: string) => { seen.push(selector); return null; } } as unknown as ParentNode;
    assert.equal(findTourTarget(fakeRoot, 'home.input'), null);
    findTourTarget(fakeRoot, 'a"]b');
    assert.equal(seen[0], '[data-tour-id="home.input"]');
    assert.equal(seen[1], '[data-tour-id="a]b"]');
  });
});

describe('tour placement (Web)', () => {
  it('centres the card without a spotlight', () => {
    const placement = placeCard(null, VIEWPORT, CARD);
    assert.equal(placement.side, 'center');
    assert.equal(placement.left, 420);
    assert.equal(placement.top, 300);
  });

  it('puts the card below a target near the top and above one near the bottom, never over it', () => {
    const high = spotlightFor({ x: 400, y: 100, width: 300, height: 56 }, VIEWPORT);
    const below = placeCard(high, VIEWPORT, CARD);
    assert.equal(below.side, 'below');
    assert.equal(below.top, high.y + high.height + TOUR_GAP);
    const low = spotlightFor({ x: 400, y: 700, width: 300, height: 56 }, VIEWPORT);
    const above = placeCard(low, VIEWPORT, CARD);
    assert.equal(above.side, 'above');
    assert.ok(above.top + CARD.height + TOUR_GAP <= low.y);
  });

  it('uses the side when a tall target leaves no room above or below (the side bar)', () => {
    const rail = spotlightFor({ x: 0, y: 20, width: 220, height: 760 }, VIEWPORT);
    const placement = placeCard(rail, VIEWPORT, CARD);
    assert.equal(placement.side, 'right');
    assert.ok(placement.left >= rail.x + rail.width + TOUR_GAP - 1);
    const right = spotlightFor({ x: 980, y: 20, width: 220, height: 760 }, VIEWPORT);
    assert.equal(placeCard(right, VIEWPORT, CARD).side, 'left');
  });

  it('never leaves the viewport, on a phone-width window either', () => {
    const phone = { width: 360, height: 640 };
    const card = { width: 328, height: 220 };
    for (const target of [
      { x: 0, y: 8, width: 60, height: 40 },
      { x: 300, y: 590, width: 60, height: 40 },
      { x: 10, y: 100, width: 340, height: 56 },
    ]) {
      const placement = placeCard(spotlightFor(target, phone), phone, card);
      assert.ok(placement.left >= TOUR_EDGE && placement.left + card.width <= phone.width - TOUR_EDGE + 0.001, JSON.stringify(placement));
      assert.ok(placement.top >= TOUR_EDGE - 0.001 && placement.top + card.height <= phone.height, JSON.stringify(placement));
    }
  });

  it('falls back to the centre when nothing fits, and grows the target by the padding inside the viewport', () => {
    const everything = spotlightFor({ x: 0, y: 0, width: 1200, height: 800 }, VIEWPORT);
    assert.deepEqual(everything, { x: 0, y: 0, width: 1200, height: 800 });
    assert.equal(placeCard(everything, VIEWPORT, CARD).side, 'center');
    assert.deepEqual(spotlightFor({ x: 100, y: 100, width: 50, height: 50 }, VIEWPORT), { x: 100 - TOUR_SPOTLIGHT_PADDING, y: 100 - TOUR_SPOTLIGHT_PADDING, width: 50 + 12, height: 50 + 12 });
  });

  it('sees sub-pixel changes as no change, and knows which page a step belongs to', () => {
    assert.equal(sameRect({ x: 1, y: 1, width: 5, height: 5 }, { x: 1.3, y: 1, width: 5, height: 5 }), true);
    assert.equal(sameRect({ x: 1, y: 1, width: 5, height: 5 }, { x: 9, y: 1, width: 5, height: 5 }), false);
    assert.equal(isOnRoute('/collections/', '/collections'), true);
    assert.equal(isOnRoute('/me/friends', '/collections'), false);
    assert.equal(isOnRoute('/anything', undefined), true);
  });
});

describe('tour engine (Web) - behaviour in the source', () => {
  const provider = source('app/(app)/TourProvider.tsx');
  const css = source('app/(app)/app.module.css');

  it('is a modal dialog named by its title and described by its text, with a step counter', () => {
    assert.match(provider, /role="dialog"/);
    assert.match(provider, /aria-modal="true"/);
    assert.match(provider, /aria-labelledby="tour-title"/);
    assert.match(provider, /aria-describedby="tour-body"/);
    assert.match(provider, /dictionary\.tourProgress/);
  });

  it('Escape ends it, the arrows move, focus goes into the card and back out, and Tab stays inside', () => {
    assert.match(provider, /event\.key === 'Escape'[\s\S]*keys\.onClose\(\)/);
    assert.match(provider, /event\.key === 'ArrowRight'[\s\S]*keys\.goNext\(\)/);
    assert.match(provider, /event\.key === 'ArrowLeft'[\s\S]*keys\.goPrevious\(\)/);
    assert.match(provider, /nextRef\.current\?\.focus\(\)/);
    assert.match(provider, /previous\.focus\(\)/);
    assert.match(provider, /event\.key !== 'Tab'/);
  });

  it('follows resize, scroll and layout changes, scrolls the target into view, and waits a bounded time for a target to render', () => {
    assert.match(provider, /addEventListener\('resize', measure\)/);
    assert.match(provider, /addEventListener\('scroll', measure, true\)/);
    assert.match(provider, /scrollIntoView/);
    assert.match(provider, /TOUR_FIND_TIMEOUT_MS/);
    assert.match(provider, /setMissing\(true\)/);
    assert.match(provider, /waiting = targetId !== undefined && rect === null && !missing/);
  });

  it('goes to the step\'s page first (route change) once, and each step is a fresh component', () => {
    assert.match(provider, /router\.push\(routePath\)/);
    assert.match(provider, /navigated\.current/);
    assert.match(provider, /key=\{`\$\{running\.guide\.id\}:\$\{running\.index\}`\}/);
  });

  it('never starts by itself: only Help calls start()', () => {
    const callers = walk(fileURLToPath(new URL('app/', root))).filter(file => /\bstart\(guide\.id\)|useTour\(\)/.test(readFileSync(file, 'utf8')));
    assert.deepEqual(callers.map(file => file.replace(/\\/g, '/').split('/web/app/')[1]).sort(), ['(app)/TourProvider.tsx', '(app)/me/help/page.tsx'].sort());
    assert.match(source('app/(app)/AppRoot.tsx'), /<TourProvider>\s*<ToastProvider>\s*<SafetyProvider>\s*<AppShell>/);
  });

  it('Help starts any guide at any time; the settings list links to it', () => {
    const help = source('app/(app)/me/help/page.tsx');
    assert.match(help, /onClick=\{\(\) => start\(guide\.id\)\}/);
    assert.doesNotMatch(help, /localStorage|completed/);
    const nav = source('lib/settingsNav.ts');
    assert.match(nav, /key: 'help', href: '\/me\/help'/);
  });

  it('Light / Dark: only theme tokens; the target itself is never recoloured; motion respects reduce-motion', () => {
    const block = css.slice(css.indexOf('/* ---- Guided tour'), css.indexOf('/* ---- Help page: guide list'));
    assert.ok(block.length > 500);
    assert.match(block, /var\(--scrim\)/);
    assert.match(block, /\.tourCard,\s*\.tourCardStatic \{[\s\S]*background: var\(--app-surface\)/);
    assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'no literal colours in the tour styles');
    assert.match(block, /@media \(prefers-reduced-motion: reduce\)/);
    assert.doesNotMatch(block, /infinite|pulse/);
    assert.match(provider, /prefers-reduced-motion: reduce/);
    const spotlight = block.slice(block.indexOf('.tourSpotlight,'), block.indexOf('.tourSpotlight {'));
    assert.doesNotMatch(spotlight, /background:|filter|opacity/, 'the spotlight ring paints a border and a shadow around the target, nothing over it');
  });
});

describe('tour targets (Web) - audit', () => {
  it('has no duplicate ids, and every id is named by a step', () => {
    const ids = Object.values(TOUR_TARGETS);
    assert.equal(new Set(ids).size, ids.length);
    const used = new Set(TOUR_GUIDES.flatMap(guide => guide.steps.map(step => step.targetId)));
    for (const id of ids) {
      assert.ok(used.has(id), `${id} is used by a guide`);
    }
  });

  it('every id is marked exactly once in the app (nav and settings ids come from their lists, once each)', () => {
    const text = walk(fileURLToPath(new URL('app/', root))).map(file => readFileSync(file, 'utf8')).join('\n');
    const direct = ['homeInput', 'homeCheck', 'collectionsCreate', 'collectionsViewMode', 'friendsTabs'];
    for (const key of direct) {
      assert.equal(text.match(new RegExp(`TOUR_TARGETS\\.${key}\\b`, 'g'))?.length, 1, key);
    }
    for (const href of ['/archive', '/collections', '/me/friends', '/me']) {
      assert.ok(Object.keys(navTourTarget(href)).length === 1, href);
    }
    assert.equal(Object.keys(navTourTarget('/')).length, 0, 'Home is not a tour target');
    for (const key of ['language', 'appearance', 'help', 'account']) {
      assert.ok(Object.keys(settingsTourTarget(key)).length === 1, key);
    }
  });

  it('a step\'s page really contains its target: route and marker live on the same page', () => {
    const pages: Record<string, string> = {
      '/': 'app/(app)/HomeView.tsx',
      '/collections': 'app/(app)/collections/CollectionsView.tsx',
      '/me/friends': 'app/(app)/me/friends/page.tsx',
    };
    for (const guide of TOUR_GUIDES) {
      for (const step of guide.steps) {
        if (step.route && step.targetId && pages[step.route]) {
          const key = Object.entries(TOUR_TARGETS).find(([, value]) => value === step.targetId)![0];
          assert.match(source(pages[step.route]), new RegExp(`TOUR_TARGETS\\.${key}\\b`), `${guide.id}/${step.key}`);
        }
      }
    }
  });
});
