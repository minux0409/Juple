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
  default: { setQuickSaveOnShare: jest.fn().mockResolvedValue(undefined), getQuickSaveOnShare: jest.fn().mockResolvedValue(false) },
}));

describe('quickSaveOnSharePreference', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  });

  describe('loadQuickSaveOnSharePreference', () => {
    it('defaults to false (OFF) when nothing is stored - a fresh install shares into the review screen', async () => {
      jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
      await expect(loadQuickSaveOnSharePreference()).resolves.toBe(false);
    });

    it('a stored false stays false', async () => {
      jest.mocked(AsyncStorage.getItem).mockResolvedValue('false');
      await expect(loadQuickSaveOnSharePreference()).resolves.toBe(false);
    });

    it('a stored true stays true - an update never resets what the person chose', async () => {
      jest.mocked(AsyncStorage.getItem).mockResolvedValue('true');
      await expect(loadQuickSaveOnSharePreference()).resolves.toBe(true);
      await expect(loadQuickSaveOnSharePreference()).resolves.toBe(true);
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    });

    it('falls back to false on a malformed stored value, without throwing', async () => {
      jest.mocked(AsyncStorage.getItem).mockResolvedValue('not-a-boolean');
      await expect(loadQuickSaveOnSharePreference()).resolves.toBe(false);
    });

    it('falls back to false when the storage read itself throws', async () => {
      jest.mocked(AsyncStorage.getItem).mockRejectedValue(new Error('storage unavailable'));
      await expect(loadQuickSaveOnSharePreference()).resolves.toBe(false);
    });

    describe('on Android, with no stored choice of its own', () => {
      beforeEach(() => {
        Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
        jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
      });

      it('a fresh install (no native state: the native default is OFF) is OFF', async () => {
        jest.mocked(nativeIncomingShare!.getQuickSaveOnShare).mockResolvedValue(false);
        await expect(loadQuickSaveOnSharePreference()).resolves.toBe(false);
      });

      it('an existing install whose share receiver was ON stays ON', async () => {
        jest.mocked(nativeIncomingShare!.getQuickSaveOnShare).mockResolvedValue(true);
        await expect(loadQuickSaveOnSharePreference()).resolves.toBe(true);
      });

      it('an existing install whose share receiver was OFF stays OFF', async () => {
        jest.mocked(nativeIncomingShare!.getQuickSaveOnShare).mockResolvedValue(false);
        await expect(loadQuickSaveOnSharePreference()).resolves.toBe(false);
      });

      it('a native read failure fails safe to OFF', async () => {
        jest.mocked(nativeIncomingShare!.getQuickSaveOnShare).mockRejectedValue(new Error('native'));
        await expect(loadQuickSaveOnSharePreference()).resolves.toBe(false);
      });

      it('an unreadable JS store with a native ON keeps the native value; with both unreadable it is OFF', async () => {
        jest.mocked(AsyncStorage.getItem).mockRejectedValue(new Error('storage unavailable'));
        jest.mocked(nativeIncomingShare!.getQuickSaveOnShare).mockResolvedValue(true);
        await expect(loadQuickSaveOnSharePreference()).resolves.toBe(true);
        jest.mocked(nativeIncomingShare!.getQuickSaveOnShare).mockRejectedValue(new Error('native'));
        await expect(loadQuickSaveOnSharePreference()).resolves.toBe(false);
      });

      it('reading the native value writes nothing, to JS or back to native', async () => {
        jest.mocked(nativeIncomingShare!.getQuickSaveOnShare).mockResolvedValue(true);
        await loadQuickSaveOnSharePreference();
        expect(AsyncStorage.setItem).not.toHaveBeenCalled();
        expect(nativeIncomingShare!.setQuickSaveOnShare).not.toHaveBeenCalled();
      });
    });

    it('an explicit JS choice overrides whatever native holds - the native value is not even asked', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      jest.mocked(nativeIncomingShare!.getQuickSaveOnShare).mockResolvedValue(true);
      jest.mocked(AsyncStorage.getItem).mockResolvedValue('false');
      await expect(loadQuickSaveOnSharePreference()).resolves.toBe(false);
      jest.mocked(AsyncStorage.getItem).mockResolvedValue('true');
      jest.mocked(nativeIncomingShare!.getQuickSaveOnShare).mockClear();
      await expect(loadQuickSaveOnSharePreference()).resolves.toBe(true);
      expect(nativeIncomingShare!.getQuickSaveOnShare).not.toHaveBeenCalled();
    });

    it('reading never writes a default back (nothing is stored until the person chooses)', async () => {
      jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
      await loadQuickSaveOnSharePreference();
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
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

  describe('explicit choices', () => {
    it('writing true persists true and writing false persists false', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      await saveQuickSaveOnSharePreference(true);
      expect(AsyncStorage.setItem).toHaveBeenLastCalledWith('juple.quickSaveOnShare', 'true');
      await saveQuickSaveOnSharePreference(false);
      expect(AsyncStorage.setItem).toHaveBeenLastCalledWith('juple.quickSaveOnShare', 'false');
    });
  });

  describe('applyStoredQuickSaveOnSharePreference', () => {
    it('with nothing stored on a fresh install it mirrors OFF to native, so an incoming share opens the review flow', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
      jest.mocked(nativeIncomingShare!.getQuickSaveOnShare).mockResolvedValue(false);

      await applyStoredQuickSaveOnSharePreference();

      expect(nativeIncomingShare?.setQuickSaveOnShare).toHaveBeenCalledWith(false);
    });

    it('with nothing stored on an existing install it re-mirrors the value native already had (ON stays ON)', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
      jest.mocked(nativeIncomingShare!.getQuickSaveOnShare).mockResolvedValue(true);

      await applyStoredQuickSaveOnSharePreference();

      expect(nativeIncomingShare?.setQuickSaveOnShare).toHaveBeenCalledWith(true);
    });

    it('with an explicit true it mirrors ON to native, so an incoming share saves at once', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      jest.mocked(AsyncStorage.getItem).mockResolvedValue('true');

      await applyStoredQuickSaveOnSharePreference();

      expect(nativeIncomingShare?.setQuickSaveOnShare).toHaveBeenCalledWith(true);
    });

    it('re-syncs the persisted value to native on bootstrap', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      jest.mocked(AsyncStorage.getItem).mockResolvedValue('false');

      await applyStoredQuickSaveOnSharePreference();

      expect(nativeIncomingShare?.setQuickSaveOnShare).toHaveBeenCalledWith(false);
    });
  });
});
