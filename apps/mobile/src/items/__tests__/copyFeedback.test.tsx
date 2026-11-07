import Clipboard from '@react-native-clipboard/clipboard';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Platform, StyleSheet } from 'react-native';
import { systemAnnouncesCopy } from '../copyLink';
import { SelectionOverlay } from '../../selection/SelectionOverlay';

function setPlatform(os: string, version: number | string) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  Object.defineProperty(Platform, 'Version', { value: version, configurable: true });
}

describe('systemAnnouncesCopy - when the OS already says "copied" (so the app must not say it too)', () => {
  const originalOS = Platform.OS;
  const originalVersion = Platform.Version;
  afterEach(() => setPlatform(originalOS, originalVersion));

  it.each([[33, true], [34, true], [36, true], [32, false], [31, false], [29, false]])('Android API %s -> %s', (version, expected) => {
    setPlatform('android', version);
    expect(systemAnnouncesCopy()).toBe(expected);
  });

  it('reads the real API level even when it arrives as a string', () => {
    setPlatform('android', '33');
    expect(systemAnnouncesCopy()).toBe(true);
  });

  it('iOS shows nothing of its own, so the app keeps its confirmation', () => {
    setPlatform('ios', '17.4');
    expect(systemAnnouncesCopy()).toBe(false);
  });
});

describe('clipboard writes are unchanged', () => {
  it('copySavedLinkUrl still writes exactly the given text and reports failure', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { copySavedLinkUrl } = require('../copyLink') as typeof import('../copyLink');
    expect(copySavedLinkUrl('https://a.test\n\nhttps://b.test')).toBe(true);
    expect(Clipboard.setString).toHaveBeenLastCalledWith('https://a.test\n\nhttps://b.test');
    jest.mocked(Clipboard.setString).mockImplementationOnce(() => { throw new Error('denied'); });
    expect(copySavedLinkUrl('x')).toBe(false);
  });
});

describe('SelectionOverlay check mark position', () => {
  const markStyle = (renderer: ReactTestRenderer.ReactTestRenderer) => StyleSheet.flatten(renderer.root.findAll(node => node.props.pointerEvents === 'none' && node.props.importantForAccessibility === 'no-hide-descendants')[0].props.style);

  it('defaults to inside the corner; a negative offset straddles the frame - the same for chosen and not-chosen cards', () => {
    const create = (element: React.ReactElement) => { let r!: ReactTestRenderer.ReactTestRenderer; act(() => { r = ReactTestRenderer.create(element); }); return r; };
    const inside = markStyle(create(<SelectionOverlay onToggle={jest.fn()} selected={false} />));
    const offChosen = markStyle(create(<SelectionOverlay markOffset={-6} onToggle={jest.fn()} selected />));
    const offPlain = markStyle(create(<SelectionOverlay markOffset={-6} onToggle={jest.fn()} selected={false} />));
    expect(inside.start).toBeGreaterThan(0);
    expect(offChosen.start).toBe(-6);
    expect(offChosen.top).toBe(-6);
    expect(offPlain.start).toBe(offChosen.start);
    expect(offPlain.top).toBe(offChosen.top);
  });
});
