import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import nativeIncomingShare from '../../share/specs/NativeIncomingShare';
import {
  applyStoredQuickSaveOnSharePreference,
  loadQuickSaveOnSharePreference,
  saveQuickSaveOnSharePreference,
} from '../quickSaveOnSharePreference';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

jest.mock('../../share/specs/NativeIncomingShare', () => ({
  __esModule: true,
  default: { setQuickSaveOnShare: jest.fn().mockResolvedValue(undefined) },
}));

describe('quickSaveOnSharePreference', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  });

  describe('loadQuickSaveOnSharePreference', () => {
    it('defaults to true (ON) when nothing is stored', async () => {
      jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
      await expect(loadQuickSaveOnSharePreference()).resolves.toBe(true);
    });

    it('returns the stored value when it is a valid boolean string', async () => {
      jest.mocked(AsyncStorage.getItem).mockResolvedValue('false');
      await expect(loadQuickSaveOnSharePreference()).resolves.toBe(false);
    });

    it('falls back to true on a malformed stored value, without throwing', async () => {
      jest.mocked(AsyncStorage.getItem).mockResolvedValue('not-a-boolean');
      await expect(loadQuickSaveOnSharePreference()).resolves.toBe(true);
    });

    it('falls back to true when the storage read itself throws', async () => {
      jest.mocked(AsyncStorage.getItem).mockRejectedValue(new Error('storage unavailable'));
      await expect(loadQuickSaveOnSharePreference()).resolves.toBe(true);
    });
  });

  describe('saveQuickSaveOnSharePreference', () => {
    it('persists the value and mirrors it to the native module on Android', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

      await saveQuickSaveOnSharePreference(false);

      expect(AsyncStorage.setItem).toHaveBeenCalledWith('juple.quickSaveOnShare', 'false');
      expect(nativeIncomingShare?.setQuickSaveOnShare).toHaveBeenCalledWith(false);
    });

    it('does not call the native module on iOS', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });

      await saveQuickSaveOnSharePreference(true);

      expect(AsyncStorage.setItem).toHaveBeenCalledWith('juple.quickSaveOnShare', 'true');
      expect(nativeIncomingShare?.setQuickSaveOnShare).not.toHaveBeenCalled();
    });

    it('does not throw when the native mirror call itself fails', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      jest.mocked(nativeIncomingShare!.setQuickSaveOnShare).mockRejectedValueOnce(new Error('native failure'));

      await expect(saveQuickSaveOnSharePreference(true)).resolves.toBeUndefined();
    });
  });

  describe('applyStoredQuickSaveOnSharePreference', () => {
    it('re-syncs the persisted value to native on bootstrap', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      jest.mocked(AsyncStorage.getItem).mockResolvedValue('false');

      await applyStoredQuickSaveOnSharePreference();

      expect(nativeIncomingShare?.setQuickSaveOnShare).toHaveBeenCalledWith(false);
    });
  });
});
