/** Every element a guide can point at. Screens mark them with useTourTarget(id). */
export const TOUR_TARGETS = {
  homeInput: 'home.input',
  homeCheck: 'home.check',
  tabCollections: 'tab.collections',
  tabHistory: 'tab.history',
  tabMyPage: 'tab.myPage',
  collectionsViewMode: 'collections.viewMode',
  collectionsCreate: 'collections.create',
  myLanguage: 'myPage.language',
  myAppearance: 'myPage.appearance',
  myFriends: 'myPage.friends',
  myHelp: 'myPage.help',
  myAccount: 'myPage.account',
  friendsTabs: 'friends.tabs',
} as const;

/** What a device must offer before a guide is listed: the Home-screen icon feature (Android launchers that can pin). */
export type TourRequirement = 'homePin';

export type TourTab = 'Home' | 'History' | 'Collections' | 'MyPage';
export type TourDestination = { readonly tab: TourTab } | { readonly screen: 'Friends' };

export interface TourStep {
  /** Locale keys: `tour.steps.<key>.title` and `.body`. */
  readonly key: string;
  /** The element to spotlight; without one the card is simply centred (an explanation with nothing to point at). */
  readonly targetId?: string;
  /** Where this step's target lives: the tour moves the app there (a main tab or a screen) before it looks for the target. */
  readonly goTo?: TourDestination;
  /**
   * 'block' (default): the spotlight is not tappable; only the card's buttons work. 'passThrough': a tap on the spotlighted
   * element reaches it (for a step that asks the person to press it).
   */
  readonly interaction?: 'block' | 'passThrough';
}

export interface TourGuide {
  readonly id: string;
  /** Raise only when the steps change so much that people should see the guide again. */
  readonly version: number;
  readonly requires?: TourRequirement;
  readonly steps: readonly TourStep[];
}

const tab = (name: TourTab): TourDestination => ({ tab: name });
const friendsScreen: TourDestination = { screen: 'Friends' };

/** The guides, in the order Help lists them. Step texts live in the locale files under `tour.steps.<key>`. */
export const TOUR_GUIDES: readonly TourGuide[] = [
  {
    id: 'mainOnboarding',
    version: 1,
    steps: [
      { key: 'home', targetId: TOUR_TARGETS.homeInput, goTo: tab('Home') },
      { key: 'share' },
      { key: 'collections', targetId: TOUR_TARGETS.tabCollections },
      { key: 'archive', targetId: TOUR_TARGETS.tabHistory },
      { key: 'myPage', targetId: TOUR_TARGETS.tabMyPage },
    ],
  },
  {
    id: 'saveLink',
    version: 1,
    steps: [
      { key: 'inputLink', targetId: TOUR_TARGETS.homeInput, goTo: tab('Home') },
      { key: 'reviewSave', targetId: TOUR_TARGETS.homeCheck },
    ],
  },
  { id: 'shareMenu', version: 1, steps: [{ key: 'share' }, { key: 'quickSave' }] },
  {
    id: 'collections',
    version: 1,
    steps: [
      { key: 'newCollection', targetId: TOUR_TARGETS.collectionsCreate, goTo: tab('Collections') },
      { key: 'viewMode', targetId: TOUR_TARGETS.collectionsViewMode },
      { key: 'longPress' },
      { key: 'shareCollection' },
    ],
  },
  {
    id: 'friends',
    version: 1,
    steps: [
      { key: 'friendsEntry', targetId: TOUR_TARGETS.myFriends, goTo: tab('MyPage') },
      { key: 'friendsTabs', targetId: TOUR_TARGETS.friendsTabs, goTo: friendsScreen },
      { key: 'friendsShared' },
    ],
  },
  {
    id: 'settings',
    version: 1,
    steps: [
      { key: 'language', targetId: TOUR_TARGETS.myLanguage, goTo: tab('MyPage') },
      { key: 'appearance', targetId: TOUR_TARGETS.myAppearance },
      { key: 'helpGuide', targetId: TOUR_TARGETS.myHelp },
      { key: 'account', targetId: TOUR_TARGETS.myAccount },
    ],
  },
  { id: 'homeShortcut', version: 1, requires: 'homePin', steps: [{ key: 'shortcutLong', goTo: tab('Collections') }, { key: 'shortcutAdd' }] },
];

/** The guide the signed-in first run starts by itself (once, after the first-run tutorial). */
export const ONBOARDING_GUIDE_ID = 'mainOnboarding';

export function findTourGuide(id: string): TourGuide | undefined {
  return TOUR_GUIDES.find(guide => guide.id === id);
}
