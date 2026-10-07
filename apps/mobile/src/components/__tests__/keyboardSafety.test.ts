// Node's own modules: this project has no @types/node (other structure tests use require the same way).
interface DirEntry {
  readonly name: string;
  isDirectory(): boolean;
}
const fs = require('fs') as {
  readdirSync(dir: string, options: { withFileTypes: true }): DirEntry[];
  readFileSync(file: string, encoding: 'utf8'): string;
};
const path = require('path') as {
  resolve(...parts: string[]): string;
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
  sep: string;
};

/**
 * Structure guard, not a keyboard test (Jest cannot show a keyboard - the real behavior needs a device
 * check on a modern Samsung Android and on the Android 8.1 PDA): every file that renders a TextInput must
 * either hold it inside the shared KeyboardSafeView / AppModal, or be listed here with the reason its input
 * is already safe. A new TextInput therefore cannot land without someone deciding how it avoids the keyboard.
 */
const SRC = path.resolve(__dirname, '../..');

/** Inputs that are safe without a container of their own, and why. */
const HOSTED_OR_TOP_OF_SCREEN: Readonly<Record<string, string>> = {
  'collections/CollectionUnlockPanel.tsx': 'rendered only inside KeyboardSafeView hosts (CollectionUnlockDialog, the Collection screen gate, SharePasswordCard)',
  'comments/CommentComposer.tsx': 'rendered by CollectionSharedItemScreen (inside a KeyboardSafeView) and ItemDetailsScreen (whose sheet moves for whichever editor is focused - see below)',
  'components/ContentPreviewCard.tsx': 'rendered by CollectionSharedItemScreen, which holds it in a KeyboardSafeView',
  'components/SearchField.tsx': 'the Archive search sits at the top of its list - the keyboard never covers it',
  'screens/DailyInboxScreen.tsx': 'the link field sits at the top of Home - the keyboard never covers it',
  'screens/FriendsScreen.tsx': 'the friend search sits at the top of its list - the keyboard never covers it',
  // A half-sheet must not be resized by the keyboard (that crushed its editors): it measures the focused editor in window
  // coordinates and moves up only as far as that editor needs (sheetKeyboardShift - keyboard events, measureInWindow and
  // TextInput.State only, all available on API 27), then scrolls its body for the rest.
  'screens/ItemDetailsScreen.tsx': 'its half-sheet moves up for the focused editor itself (sheetKeyboardShift)',
};

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(full);
    }
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

describe('every TextInput is keyboard-safe by construction', () => {
  const withInput = sourceFiles(SRC)
    .filter(file => fs.readFileSync(file, 'utf8').includes('<TextInput'))
    .map(file => path.relative(SRC, file).split(path.sep).join('/'));

  it('finds the known input holders (guards the scan itself)', () => {
    expect(withInput.length).toBeGreaterThanOrEqual(15);
  });

  it.each(withInput)('%s', file => {
    const source = fs.readFileSync(path.join(SRC, file), 'utf8');
    const isSafe = /<KeyboardSafeView\b/.test(source) || /<AppModal\b/.test(source) || file in HOSTED_OR_TOP_OF_SCREEN;
    expect(isSafe).toBe(true);
  });

  it('no screen builds its own KeyboardAvoidingView any more - there is one pattern', () => {
    const offenders = sourceFiles(SRC)
      .map(file => path.relative(SRC, file).split(path.sep).join('/'))
      .filter(file => file !== 'components/KeyboardSafeView.tsx')
      .filter(file => /<KeyboardAvoidingView\b/.test(fs.readFileSync(path.join(SRC, file), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the KeyboardSafeView pattern uses only APIs that exist on Android 8.1 (API 27): padding avoidance, no insets-animation or WindowInsets controller', () => {
    const source = fs.readFileSync(path.join(SRC, 'components/KeyboardSafeView.tsx'), 'utf8');
    expect(source).toContain('behavior="padding"');
    expect(source).not.toMatch(/automaticallyAdjustKeyboardInsets|WindowInsetsAnimation|useKeyboardController|react-native-keyboard-controller/);
  });
});
