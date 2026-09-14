import AsyncStorage from '@react-native-async-storage/async-storage';
import { I18nManager } from 'react-native';
import i18n from '../index';
import {
  LANGUAGE_PREFERENCES,
  applyStoredLanguagePreference,
  loadLanguagePreference,
  resolveLanguageForPreference,
  saveLanguagePreference,
  syncRtlLayoutDirection,
} from '../languagePreference';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

describe('languagePreference', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('LANGUAGE_PREFERENCES', () => {
    it('starts with "system" followed by every supported language, once each', () => {
      expect(LANGUAGE_PREFERENCES[0]).toBe('system');
      expect(new Set(LANGUAGE_PREFERENCES).size).toBe(LANGUAGE_PREFERENCES.length);
      expect(LANGUAGE_PREFERENCES).toContain('ar');
      expect(LANGUAGE_PREFERENCES).toContain('zh-Hans');
      expect(LANGUAGE_PREFERENCES).toContain('zh-Hant');
      expect(LANGUAGE_PREFERENCES).toContain('pt-BR');
    });
  });

  describe('loadLanguagePreference / saveLanguagePreference', () => {
    it('defaults to "system" when nothing is stored', async () => {
      jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
      await expect(loadLanguagePreference()).resolves.toBe('system');
    });

    it('returns a previously saved, valid preference', async () => {
      jest.mocked(AsyncStorage.getItem).mockResolvedValue('ar');
      await expect(loadLanguagePreference()).resolves.toBe('ar');
    });

    it('falls back to "system" on a stale/invalid stored value (e.g. a since-removed language)', async () => {
      jest.mocked(AsyncStorage.getItem).mockResolvedValue('not-a-real-language');
      await expect(loadLanguagePreference()).resolves.toBe('system');
    });

    it('falls back to "system" without throwing when storage itself fails', async () => {
      jest.mocked(AsyncStorage.getItem).mockRejectedValue(new Error('storage unavailable'));
      await expect(loadLanguagePreference()).resolves.toBe('system');
    });

    it('persists an explicit manual selection', async () => {
      await saveLanguagePreference('ja');
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('juple.languagePreference', 'ja');
    });

    it('persists "system" the same way as any other preference (re-selecting "use system language")', async () => {
      await saveLanguagePreference('system');
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('juple.languagePreference', 'system');
    });
  });

  describe('resolveLanguageForPreference', () => {
    it('resolves a concrete preference to itself', () => {
      expect(resolveLanguageForPreference('de')).toBe('de');
    });

    it('resolves "system" by re-reading the device locale (not a frozen snapshot)', () => {
      // The default react-native-localize mock (see jest.config.js) reports en-US.
      expect(resolveLanguageForPreference('system')).toBe('en');
    });
  });

  describe('syncRtlLayoutDirection', () => {
    const originalIsRTL = I18nManager.isRTL;

    // I18nManager.isRTL mirrors real React Native: it is a plain property snapshotted once at
    // native-module load time (see react-native/Libraries/ReactNative/I18nManager.js), which
    // forceRTL()/allowRTL() do NOT update for the current process - only a genuine app relaunch
    // re-reads the native constant. So "the native flag is currently RTL/LTR" can only be set up
    // here via a direct property override, exactly mirroring what syncRtlLayoutDirection itself
    // must treat as immutable-for-this-session.
    function setIsRTL(value: boolean) {
      Object.defineProperty(I18nManager, 'isRTL', { value, configurable: true });
    }

    afterEach(() => {
      setIsRTL(originalIsRTL);
      jest.restoreAllMocks();
    });

    it('always calls allowRTL(true), regardless of the target language', () => {
      const allowRTLSpy = jest.spyOn(I18nManager, 'allowRTL');
      syncRtlLayoutDirection('en');
      expect(allowRTLSpy).toHaveBeenCalledWith(true);
    });

    it('forces RTL on for Arabic when the native flag is currently LTR, and reports a restart is needed', () => {
      setIsRTL(false);
      const forceRTLSpy = jest.spyOn(I18nManager, 'forceRTL');

      const restartNeeded = syncRtlLayoutDirection('ar');

      expect(forceRTLSpy).toHaveBeenCalledWith(true);
      expect(restartNeeded).toBe(true);
    });

    it('forces RTL off for a non-Arabic language when the native flag is currently RTL, and reports a restart is needed', () => {
      setIsRTL(true);
      const forceRTLSpy = jest.spyOn(I18nManager, 'forceRTL');

      const restartNeeded = syncRtlLayoutDirection('ko');

      expect(forceRTLSpy).toHaveBeenCalledWith(false);
      expect(restartNeeded).toBe(true);
    });

    it('does not report a restart as needed, and does not call forceRTL, when direction already matches', () => {
      setIsRTL(false);
      const forceRTLSpy = jest.spyOn(I18nManager, 'forceRTL');

      const restartNeeded = syncRtlLayoutDirection('en');

      expect(forceRTLSpy).not.toHaveBeenCalled();
      expect(restartNeeded).toBe(false);
    });
  });

  describe('applyStoredLanguagePreference', () => {
    afterEach(async () => {
      // Leaves the live i18n singleton (shared across the whole test file/run) back on a
      // deterministic language for any test file that runs after this one.
      await i18n.changeLanguage('en');
      jest.restoreAllMocks();
    });

    it('applies a persisted manual selection to the live i18n instance', async () => {
      jest.mocked(AsyncStorage.getItem).mockResolvedValue('fr');

      await applyStoredLanguagePreference();

      expect(i18n.language).toBe('fr');
    });

    it('re-resolves the device locale when the persisted preference is "system"', async () => {
      jest.mocked(AsyncStorage.getItem).mockResolvedValue('system');

      await applyStoredLanguagePreference();

      // The default react-native-localize mock reports en-US.
      expect(i18n.language).toBe('en');
    });

    it('also syncs the native RTL flag for the resolved language on every launch', async () => {
      jest.mocked(AsyncStorage.getItem).mockResolvedValue('ar');
      const forceRTLSpy = jest.spyOn(I18nManager, 'forceRTL');

      await applyStoredLanguagePreference();

      // The native flag's module-load default (LTR - see syncRtlLayoutDirection's own tests
      // above) mismatches Arabic's RTL requirement, so a sync call is expected.
      expect(forceRTLSpy).toHaveBeenCalledWith(true);
    });
  });
});
