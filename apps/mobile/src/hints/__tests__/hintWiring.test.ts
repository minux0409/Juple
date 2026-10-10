export {};

const fs = jest.requireActual<{ readFileSync(file: string, encoding: string): string }>('fs');
const path = jest.requireActual<{ join(...parts: string[]): string }>('path');

const read = (relative: string) => fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');

describe('hint wiring', () => {
  it('Home and the Archive share ONE swipe-hint completion key', () => {
    expect(read('screens/DailyInboxScreen.tsx')).toContain("useOneTimeHint('savedLinkSwipe'");
    expect(read('screens/DateHistoryScreen.tsx')).toContain("useOneTimeHint('savedLinkSwipe'");
  });

  it('the Collections tab uses its own, different key', () => {
    expect(read('screens/CollectionsScreen.tsx')).toContain("useOneTimeHint('collectionLongPress'");
    expect(read('screens/DailyInboxScreen.tsx')).not.toContain('collectionLongPress');
    expect(read('screens/DateHistoryScreen.tsx')).not.toContain('collectionLongPress');
  });

  it('the swipe hint eligibility and the row actions come from the same helper', () => {
    for (const screen of ['screens/DailyInboxScreen.tsx', 'screens/DateHistoryScreen.tsx']) {
      const source = read(screen);
      expect(source).toContain('hasSavedLinkSwipeActions');
      expect(source).toContain('getSavedLinkSwipeActions');
      // no second, hand-written lock check next to the helper
      expect(source).not.toMatch(/onShare=\{[a-z.]*item\.isCollectionLocked/);
    }
  });

  it('the hints never read the tutorial version or record', () => {
    for (const file of ['hints/useOneTimeHint.ts', 'hints/hintPreference.ts', 'hints/HintBanner.tsx']) {
      expect(read(file)).not.toMatch(/from '\.\.\/settings\/tutorialPreference'/);
    }
  });
});
