import { getLocales } from 'react-native-localize';
import { isRtlLanguage, resolveSystemLanguage } from '../index';

// The project-wide moduleNameMapper (see jest.config.js) points react-native-localize at its
// plain (non-jest.fn) mock module, which is fine for tests that only need a stable default
// locale - but resolveSystemLanguage's own mapping logic needs to drive getLocales() with many
// different return values, so this file overrides it with a real jest.fn().
jest.mock('react-native-localize', () => ({
  // i18n/index.ts calls resolveSystemLanguage() synchronously at module load (for i18next's own
  // init()), so this needs a non-empty default return value from the very first call, before any
  // test gets to install its own mockReturnValue.
  getLocales: jest.fn(() => [
    { countryCode: 'US', languageTag: 'en-US', languageCode: 'en', isRTL: false },
  ]),
}));

function mockLocales(...locales: readonly Partial<ReturnType<typeof getLocales>[number]>[]) {
  jest.mocked(getLocales).mockReturnValue(
    locales.map(locale => ({
      countryCode: 'US',
      languageTag: 'en-US',
      languageCode: 'en',
      isRTL: false,
      ...locale,
    })),
  );
}

describe('resolveSystemLanguage', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('maps a directly supported language code as-is (e.g. ko-KR -> ko)', () => {
    mockLocales({ languageCode: 'ko', countryCode: 'KR', languageTag: 'ko-KR' });
    expect(resolveSystemLanguage()).toBe('ko');
  });

  it('maps en-GB -> en (region-agnostic)', () => {
    mockLocales({ languageCode: 'en', countryCode: 'GB', languageTag: 'en-GB' });
    expect(resolveSystemLanguage()).toBe('en');
  });

  it('falls back to en for a completely unsupported language', () => {
    mockLocales({ languageCode: 'nl', countryCode: 'NL', languageTag: 'nl-NL' });
    expect(resolveSystemLanguage()).toBe('en');
  });

  it('maps zh-CN (no scriptCode, mainland region) -> zh-Hans', () => {
    mockLocales({ languageCode: 'zh', countryCode: 'CN', languageTag: 'zh-CN' });
    expect(resolveSystemLanguage()).toBe('zh-Hans');
  });

  it('maps zh-SG (no scriptCode, Singapore) -> zh-Hans', () => {
    mockLocales({ languageCode: 'zh', countryCode: 'SG', languageTag: 'zh-SG' });
    expect(resolveSystemLanguage()).toBe('zh-Hans');
  });

  it('maps zh-TW (no scriptCode, Taiwan) -> zh-Hant', () => {
    mockLocales({ languageCode: 'zh', countryCode: 'TW', languageTag: 'zh-TW' });
    expect(resolveSystemLanguage()).toBe('zh-Hant');
  });

  it('maps zh-HK (Hong Kong) -> zh-Hant', () => {
    mockLocales({ languageCode: 'zh', countryCode: 'HK', languageTag: 'zh-HK' });
    expect(resolveSystemLanguage()).toBe('zh-Hant');
  });

  it('maps zh-MO (Macau) -> zh-Hant', () => {
    mockLocales({ languageCode: 'zh', countryCode: 'MO', languageTag: 'zh-MO' });
    expect(resolveSystemLanguage()).toBe('zh-Hant');
  });

  it('prefers an explicit scriptCode over the region when both are present', () => {
    // A CN-region device explicitly reporting the Traditional script should still resolve to
    // zh-Hant - the script is the more authoritative signal than the region grouping.
    mockLocales({ languageCode: 'zh', countryCode: 'CN', scriptCode: 'Hant', languageTag: 'zh-Hant-CN' });
    expect(resolveSystemLanguage()).toBe('zh-Hant');
  });

  it('maps any other/unlisted zh region to zh-Hans as the wider-deployed default', () => {
    mockLocales({ languageCode: 'zh', countryCode: 'MY', languageTag: 'zh-MY' });
    expect(resolveSystemLanguage()).toBe('zh-Hans');
  });

  it('pins any Portuguese region to pt-BR (the only Portuguese variant Juple ships)', () => {
    mockLocales({ languageCode: 'pt', countryCode: 'PT', languageTag: 'pt-PT' });
    expect(resolveSystemLanguage()).toBe('pt-BR');
  });

  it('falls through to the next OS locale entry when the first is unsupported', () => {
    mockLocales(
      { languageCode: 'nl', countryCode: 'NL', languageTag: 'nl-NL' },
      { languageCode: 'ja', countryCode: 'JP', languageTag: 'ja-JP' },
    );
    expect(resolveSystemLanguage()).toBe('ja');
  });

  it('falls back to en when getLocales returns an empty list', () => {
    jest.mocked(getLocales).mockReturnValue([]);
    expect(resolveSystemLanguage()).toBe('en');
  });
});

describe('isRtlLanguage', () => {
  it('is true only for Arabic among the currently supported languages', () => {
    expect(isRtlLanguage('ar')).toBe(true);
    expect(isRtlLanguage('en')).toBe(false);
    expect(isRtlLanguage('ko')).toBe(false);
    expect(isRtlLanguage('hi')).toBe(false);
  });
});
