/**
 * Guided tours on the Web: the guides, the way a page marks an element for them, and the geometry of the spotlight and its card.
 * Pure (no React, no DOM objects beyond what is passed in) so it is covered by plain node tests. The mobile app has the same idea
 * in apps/mobile/src/tour; the step texts are the same mobile locale strings (mapped in appI18nMobileKeys.ts), so there is one
 * translation per step.
 */

/** Every element a guide can point at. A page marks it with tourTarget(id); nothing else in the code names a selector. */
export const TOUR_TARGETS = {
  navArchive: 'nav.archive',
  navCollections: 'nav.collections',
  navFriends: 'nav.friends',
  navSettings: 'nav.settings',
  homeInput: 'home.input',
  homeCheck: 'home.check',
  collectionsViewMode: 'collections.viewMode',
  collectionsCreate: 'collections.create',
  friendsTabs: 'friends.tabs',
  settingsLanguage: 'settings.language',
  settingsAppearance: 'settings.appearance',
  settingsHelp: 'settings.help',
  settingsAccount: 'settings.account',
} as const;

export type TourTargetId = (typeof TOUR_TARGETS)[keyof typeof TOUR_TARGETS];

/** The attribute a page spreads onto the element: `<div {...tourTarget(TOUR_TARGETS.homeInput)}>`. */
export function tourTarget(id: TourTargetId): { readonly 'data-tour-id': string } {
  return { 'data-tour-id': id };
}

/** The ONE place that turns an id into a lookup. Ids are our own constants (letters, dots), still quoted defensively. */
export function findTourTarget(root: ParentNode, id: string): Element | null {
  return root.querySelector(`[data-tour-id="${id.replace(/["\\]/g, '')}"]`);
}

const NAV_TARGETS: Readonly<Record<string, TourTargetId>> = {
  '/archive': TOUR_TARGETS.navArchive,
  '/collections': TOUR_TARGETS.navCollections,
  '/me/friends': TOUR_TARGETS.navFriends,
  '/me': TOUR_TARGETS.navSettings,
};

/** The marker for a side bar destination (by its address), or nothing for one no guide points at. */
export function navTourTarget(href: string): { readonly 'data-tour-id'?: string } {
  const id = NAV_TARGETS[href];
  return id ? tourTarget(id) : {};
}

const SETTINGS_TARGETS: Readonly<Record<string, TourTargetId>> = {
  language: TOUR_TARGETS.settingsLanguage,
  appearance: TOUR_TARGETS.settingsAppearance,
  help: TOUR_TARGETS.settingsHelp,
  account: TOUR_TARGETS.settingsAccount,
};

/** The marker for an item of the settings list (by its key), or nothing for one no guide points at. */
export function settingsTourTarget(key: string): { readonly 'data-tour-id'?: string } {
  const id = SETTINGS_TARGETS[key];
  return id ? tourTarget(id) : {};
}

export interface TourStep {
  /** Mobile locale keys `tour.steps.<key>.title` / `.body` (web keys `tourStep_<key>_Title` / `_Body`). */
  readonly key: StepKey;
  readonly targetId?: TourTargetId;
  /** The page the target lives on; the tour goes there first when the person is somewhere else. */
  readonly route?: string;
}

export interface TourGuide {
  readonly id: GuideId;
  readonly version: number;
  readonly steps: readonly TourStep[];
}

export type GuideId = 'mainOnboarding' | 'saveLink' | 'collections' | 'friends' | 'settings';
export type StepKey =
  | 'home'
  | 'collections'
  | 'archive'
  | 'myPage'
  | 'inputLink'
  | 'reviewSave'
  | 'newCollection'
  | 'viewMode'
  | 'friendsEntry'
  | 'friendsTabs'
  | 'friendsShared'
  | 'language'
  | 'appearance'
  | 'helpGuide'
  | 'account';

/**
 * The Web's guides. The mobile-only ones (sharing from another app's share menu, the 1x1 Home screen shortcut, press-and-hold
 * menus) are not here: those features do not exist in a browser, so no guide pretends they do.
 */
export const TOUR_GUIDES: readonly TourGuide[] = [
  {
    id: 'mainOnboarding',
    version: 1,
    steps: [
      { key: 'home', targetId: TOUR_TARGETS.homeInput, route: '/' },
      { key: 'collections', targetId: TOUR_TARGETS.navCollections },
      { key: 'archive', targetId: TOUR_TARGETS.navArchive },
      { key: 'myPage', targetId: TOUR_TARGETS.navSettings },
    ],
  },
  {
    id: 'saveLink',
    version: 1,
    steps: [
      { key: 'inputLink', targetId: TOUR_TARGETS.homeInput, route: '/' },
      { key: 'reviewSave', targetId: TOUR_TARGETS.homeCheck },
    ],
  },
  {
    id: 'collections',
    version: 1,
    steps: [
      { key: 'newCollection', targetId: TOUR_TARGETS.collectionsCreate, route: '/collections' },
      { key: 'viewMode', targetId: TOUR_TARGETS.collectionsViewMode },
    ],
  },
  {
    id: 'friends',
    version: 1,
    steps: [
      { key: 'friendsEntry', targetId: TOUR_TARGETS.navFriends },
      { key: 'friendsTabs', targetId: TOUR_TARGETS.friendsTabs, route: '/me/friends' },
      { key: 'friendsShared' },
    ],
  },
  {
    id: 'settings',
    version: 1,
    steps: [
      { key: 'language', targetId: TOUR_TARGETS.settingsLanguage, route: '/me/language' },
      { key: 'appearance', targetId: TOUR_TARGETS.settingsAppearance },
      { key: 'helpGuide', targetId: TOUR_TARGETS.settingsHelp },
      { key: 'account', targetId: TOUR_TARGETS.settingsAccount },
    ],
  },
];

export function findTourGuide(id: string): TourGuide | undefined {
  return TOUR_GUIDES.find(guide => guide.id === id);
}

/** Whether the person is already on the step's page (a trailing slash does not matter). */
export function isOnRoute(pathname: string, route: string | undefined): boolean {
  if (!route) {
    return true;
  }
  const clean = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path);
  return clean(pathname) === clean(route);
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export const TOUR_GAP = 12;
export const TOUR_EDGE = 16;
export const TOUR_SPOTLIGHT_PADDING = 6;

/**
 * The target's own corner radius in px from a computed `border-*-radius` value ("20px", "8px 12px" - the horizontal radius is taken -
 * or a percentage of the box, 50% being a pill / circle). Anything else (a var() that did not resolve, `auto`, nothing) is null:
 * the spotlight then keeps its stylesheet default. No attempt is made to read four different corners; the top-start corner stands
 * for the control, which is how every Juple control is drawn.
 */
export function parseCornerRadius(value: string | null | undefined, box: Size): number | null {
  const first = (value ?? '').trim().split(/[\s/]+/)[0] ?? '';
  const match = /^(\d+(?:\.\d+)?)(px|%)$/.exec(first);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  return match[2] === '%' ? (Math.min(box.width, box.height) * amount) / 100 : amount;
}

/**
 * The spotlight ring's radius: the target's radius grown by the padding the ring reaches beyond it (R + P), never more than a pill of
 * the ring's own size. Null (unknown) stays null so the stylesheet default applies.
 */
export function spotlightRadius(targetRadius: number | null, spotlight: Size): number | null {
  if (targetRadius === null || !Number.isFinite(targetRadius) || targetRadius < 0) {
    return null;
  }
  return Math.min(targetRadius + TOUR_SPOTLIGHT_PADDING, Math.min(spotlight.width, spotlight.height) / 2);
}

/** The target grown by the padding, kept inside the viewport. */
export function spotlightFor(target: Rect, viewport: Size): Rect {
  const x = Math.max(0, target.x - TOUR_SPOTLIGHT_PADDING);
  const y = Math.max(0, target.y - TOUR_SPOTLIGHT_PADDING);
  const right = Math.min(viewport.width, target.x + target.width + TOUR_SPOTLIGHT_PADDING);
  const bottom = Math.min(viewport.height, target.y + target.height + TOUR_SPOTLIGHT_PADDING);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

export type TourSide = 'below' | 'above' | 'right' | 'left' | 'center';

export interface Placement {
  readonly left: number;
  readonly top: number;
  readonly side: TourSide;
}

/**
 * Where the card goes: beside the spotlight on a wide window when there is room (a side bar item), else below, else above, else
 * centred - never over the spotlight and never past the viewport edge. Without a spotlight it is centred.
 */
export function placeCard(spotlight: Rect | null, viewport: Size, card: Size): Placement {
  const maxLeft = Math.max(TOUR_EDGE, viewport.width - card.width - TOUR_EDGE);
  const maxTop = Math.max(TOUR_EDGE, viewport.height - card.height - TOUR_EDGE);
  const clampLeft = (left: number) => Math.min(Math.max(TOUR_EDGE, left), maxLeft);
  const clampTop = (top: number) => Math.min(Math.max(TOUR_EDGE, top), maxTop);
  const centered: Placement = { left: clampLeft((viewport.width - card.width) / 2), top: clampTop((viewport.height - card.height) / 2), side: 'center' };
  if (!spotlight) {
    return centered;
  }
  const centreX = spotlight.x + spotlight.width / 2 - card.width / 2;
  const centreY = spotlight.y + spotlight.height / 2 - card.height / 2;
  const below = spotlight.y + spotlight.height + TOUR_GAP;
  if (below + card.height <= viewport.height - TOUR_EDGE) {
    return { left: clampLeft(centreX), top: below, side: 'below' };
  }
  const above = spotlight.y - TOUR_GAP - card.height;
  if (above >= TOUR_EDGE) {
    return { left: clampLeft(centreX), top: above, side: 'above' };
  }
  const right = spotlight.x + spotlight.width + TOUR_GAP;
  if (right + card.width <= viewport.width - TOUR_EDGE) {
    return { left: right, top: clampTop(centreY), side: 'right' };
  }
  const left = spotlight.x - TOUR_GAP - card.width;
  if (left >= TOUR_EDGE) {
    return { left, top: clampTop(centreY), side: 'left' };
  }
  return centered;
}

export function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
}

/** How long the tour waits for a step's target to appear (a route change, a slow load) before it explains the step without a spotlight. */
export const TOUR_FIND_TIMEOUT_MS = 3000;
export const TOUR_FIND_INTERVAL_MS = 100;
