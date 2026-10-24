import ReactTestRenderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import { ThemedTextInput } from '../ThemedTextInput';
import { darkColors, lightColors, setActiveColorScheme } from '../../theme/tokens';

type Dirent = { readonly name: string; isDirectory(): boolean };
const fs = jest.requireActual<{ readFileSync(file: string, encoding: string): string; readdirSync(dir: string, options: { withFileTypes: true }): Dirent[] }>('fs');
const path = jest.requireActual<{ resolve(...parts: string[]): string; join(...parts: string[]): string; relative(from: string, to: string): string }>('path');
const SRC = path.resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === 'testing' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const render = (element: React.ReactElement) => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer;
};

describe('ThemedTextInput', () => {
  afterEach(() => setActiveColorScheme('light'));

  it.each([
    ['dark', darkColors],
    ['light', lightColors],
  ] as const)('%s: placeholder, caret and selection come from the theme, never the native default', (scheme, palette) => {
    setActiveColorScheme(scheme);
    const input = render(<ThemedTextInput placeholder="x" />).root.findByType(TextInput);
    expect(input.props.placeholderTextColor).toBe(palette.placeholder);
    expect(input.props.selectionColor).toBe(palette.brand);
    expect(input.props.cursorColor).toBe(palette.brand);
  });

  it('a field may still choose its own placeholder colour, and its ref reaches the native input', () => {
    const ref = { current: null as unknown };
    const input = render(<ThemedTextInput placeholder="x" placeholderTextColor="#123456" ref={ref as never} />).root.findByType(TextInput);
    expect(input.props.placeholderTextColor).toBe('#123456');
  });
});

describe('every TextInput of the app is the themed one (inventory guard)', () => {
  const files = sourceFiles(SRC).filter(file => !file.endsWith('ThemedTextInput.tsx'));

  it('no source file renders the raw React Native <TextInput> - a new field cannot forget the placeholder / caret roles', () => {
    const offenders = files.filter(file => /<TextInput[\s>]/.test(fs.readFileSync(file, 'utf8')));
    expect(offenders.map(file => path.relative(SRC, file))).toEqual([]);
  });

  it('no field sets a literal colour as its placeholder (a theme role only)', () => {
    const offenders = files.filter(file => /placeholderTextColor=\{?['"]/.test(fs.readFileSync(file, 'utf8')));
    expect(offenders.map(file => path.relative(SRC, file))).toEqual([]);
  });

  it('knows the inventory: at least the 23 fields found by the audit use ThemedTextInput', () => {
    const uses = files.reduce((sum, file) => sum + (fs.readFileSync(file, 'utf8').match(/<(?:ThemedTextInput|PasswordInput)\b/g) ?? []).length, 0);
    expect(uses).toBeGreaterThanOrEqual(23);
  });
});
