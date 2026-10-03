import { SUPPORTED_LANGUAGES } from '../index';
import ar from '../locales/ar.json';
import de from '../locales/de.json';
import en from '../locales/en.json';
import es from '../locales/es.json';
import fr from '../locales/fr.json';
import hi from '../locales/hi.json';
import id from '../locales/id.json';
import itIT from '../locales/it.json';
import ja from '../locales/ja.json';
import ko from '../locales/ko.json';
import ptBR from '../locales/pt-BR.json';
import ru from '../locales/ru.json';
import th from '../locales/th.json';
import tr from '../locales/tr.json';
import vi from '../locales/vi.json';
import zhHans from '../locales/zh-Hans.json';
import zhHant from '../locales/zh-Hant.json';

type JsonRecord = { readonly [key: string]: JsonRecord | string };

// Keyed by SupportedLanguage so this list can never silently drift from SUPPORTED_LANGUAGES
// (see the exhaustiveness check below) - every locale i18n/index.ts registers is checked here.
const LOCALES: Record<(typeof SUPPORTED_LANGUAGES)[number], JsonRecord> = {
  ko,
  en,
  ja,
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
  es,
  fr,
  de,
  it: itIT,
  'pt-BR': ptBR,
  vi,
  th,
  id,
  ru,
  tr,
  ar,
  hi,
};

/** These `language.*` values are endonyms (a language's name for itself, e.g. "日本語") - the
 * same literal text in every locale by design (see i18n/locales and this round's terminology
 * rules), so they are exempt from the "value differs across languages" sanity check below without
 * that being a real translation gap. Everything else under `language.*` (the "use system
 * setting"/"restart for RTL" UI copy) is a real translated string and must NOT be in this list. */
const SHARED_LITERAL_KEYS = [
  'language.korean',
  'language.english',
  'language.japanese',
  'language.chineseSimplified',
  'language.chineseTraditional',
  'language.spanish',
  'language.french',
  'language.german',
  'language.italian',
  'language.portugueseBrazil',
  'language.vietnamese',
  'language.thai',
  'language.indonesian',
  'language.russian',
  'language.turkish',
  'language.arabic',
  'language.hindi',
];

/** Flattens a nested translation JSON object into `{ "namespace.key": "value" }` pairs. */
function flatten(node: JsonRecord, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(node)) {
    const dottedKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      result[dottedKey] = value;
    } else {
      Object.assign(result, flatten(value, dottedKey));
    }
  }
  return result;
}

/** Extracts the set of `{{placeholder}}` interpolation names used in a translation string. */
function extractPlaceholders(value: string): Set<string> {
  const matches = value.match(/\{\{\s*[\w.-]+\s*\}\}/g) ?? [];
  return new Set(matches.map(match => match.replace(/[{}\s]/g, '')));
}

const flattenedByLanguage = Object.fromEntries(
  Object.entries(LOCALES).map(([language, resource]) => [language, flatten(resource)]),
) as Record<(typeof SUPPORTED_LANGUAGES)[number], Record<string, string>>;

const sourceKeys = Object.keys(flattenedByLanguage.en).sort();

describe('locale key parity (en is the source of truth)', () => {
  it('registers every SUPPORTED_LANGUAGES entry as an actual locale file', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      expect(flattenedByLanguage[language]).toBeDefined();
    }
  });

  it('has no key that exists only in ko (every ko key must also exist in en)', () => {
    const koOnly = Object.keys(flattenedByLanguage.ko)
      .filter(key => !(key in flattenedByLanguage.en))
      .sort();
    expect(koOnly).toEqual([]);
  });

  it.each(SUPPORTED_LANGUAGES.filter(language => language !== 'en'))(
    '%s has exactly the same key set as en (no missing, no extra keys)',
    language => {
      const keys = Object.keys(flattenedByLanguage[language]).sort();
      const missing = sourceKeys.filter(key => !keys.includes(key));
      const extra = keys.filter(key => !sourceKeys.includes(key));
      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    },
  );

  it.each(SUPPORTED_LANGUAGES)('%s has no empty translation value', language => {
    const emptyKeys = Object.entries(flattenedByLanguage[language])
      .filter(([, value]) => value.trim().length === 0)
      .map(([key]) => key);
    expect(emptyKeys).toEqual([]);
  });

  it.each(SUPPORTED_LANGUAGES.filter(language => language !== 'en'))(
    '%s uses the exact same {{placeholder}} names as en for every shared key',
    language => {
      const target = flattenedByLanguage[language];
      const mismatches: string[] = [];
      for (const key of sourceKeys) {
        const targetValue = target[key];
        if (targetValue === undefined) {
          // Already reported by the key-parity test above - avoid double-reporting here.
          continue;
        }
        const sourcePlaceholders = extractPlaceholders(flattenedByLanguage.en[key]);
        const targetPlaceholders = extractPlaceholders(targetValue);
        const isSame =
          sourcePlaceholders.size === targetPlaceholders.size &&
          [...sourcePlaceholders].every(placeholder => targetPlaceholders.has(placeholder));
        if (!isSame) {
          mismatches.push(
            `${key}: en has [${[...sourcePlaceholders].join(', ')}], ${language} has [${[...targetPlaceholders].join(', ')}]`,
          );
        }
      }
      expect(mismatches).toEqual([]);
    },
  );

  it('every language.* endonym value is identical across all locales (never translated)', () => {
    const mismatches: string[] = [];
    for (const key of SHARED_LITERAL_KEYS) {
      const referenceValue = flattenedByLanguage.en[key];
      for (const language of SUPPORTED_LANGUAGES) {
        if (flattenedByLanguage[language][key] !== referenceValue) {
          mismatches.push(`${key} differs in ${language}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe('participants wording', () => {
  it('the Share screen section is 참여자 (no 공유 상태), matching the participants popup, in every locale', () => {
    for (const [language, locale] of Object.entries(LOCALES)) {
      expect([language, (locale.shareSheet as JsonRecord).statusTitle]).toEqual([language, (locale.collections as JsonRecord).participantsTitle]);
    }
    expect((ko.shareSheet as JsonRecord).statusTitle).toBe('참여자');
    expect((ko.shareSheet as JsonRecord).statusTabMembers).toBe('참여 중 {{count}}');
    expect((ko.shareSheet as JsonRecord).statusTabPending).toBe('초대 대기 {{count}}');
  });
});

describe('requester vs owner approval wording', () => {
  const get = (locale: JsonRecord, group: string, key: string) => ((locale[group] as JsonRecord)[key] as string);
  const PAIRS: ReadonlyArray<readonly [string, string, string, string]> = [
    ['collections', 'myPendingSubmissions', 'collections', 'pendingSubmissions'],
    ['submissions', 'mySheetTitle', 'submissions', 'ownerSheetTitle'],
  ];

  it('never shows the requester (awaiting) and the owner (approval requests) the same text, in any locale', () => {
    const same: string[] = [];
    for (const [language, locale] of Object.entries(LOCALES)) {
      for (const [g1, k1, g2, k2] of PAIRS) {
        if (get(locale, g1, k1) === get(locale, g2, k2)) {
          same.push(`${language}: ${g1}.${k1} === ${g2}.${k2}`);
        }
      }
    }
    expect(same).toEqual([]);
  });

  it('Korean: requester says 보낸 승인 요청, owner says 받은 승인 요청', () => {
    expect(get(ko, 'collections', 'myPendingSubmissions')).toBe('보낸 승인 요청 {{count}}');
    expect(get(ko, 'submissions', 'mySheetTitle')).toBe('보낸 승인 요청');
    expect(get(ko, 'collections', 'pendingSubmissions')).toBe('받은 승인 요청 {{count}}');
    expect(get(ko, 'submissions', 'ownerSheetTitle')).toBe('받은 승인 요청');
    expect(JSON.stringify(ko)).not.toContain('내 승인 대기');
    expect(JSON.stringify(ko)).not.toContain('승인 대기중');
    expect(JSON.stringify(ko)).not.toContain('내 링크 승인 대기');
  });
});
