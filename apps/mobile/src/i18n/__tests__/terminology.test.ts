import { SUPPORTED_LANGUAGES } from '../index';

/** Every translation value of a locale, flattened (keys are internal and may keep old names). */
function valuesOf(language: string): string[] {
  const walk = (node: unknown): string[] =>
    typeof node === 'string' ? [node] : Object.values(node as Record<string, unknown>).flatMap(walk);
  return walk(require(`../locales/${language}.json`));
}

// The retired "Category" wording, per locale, as it appeared in each language.
const OLD_TERM = /카테고리|categor|catégor|kategor|категор|カテゴリ|分类|分類|فئة|فئات|الفئ|หมวดหมู่|danh mục|श्रेण|कैटेगरी/i;

describe('product terminology: 컬렉션 / Collection, never 카테고리 / Category', () => {
  it('Korean says 컬렉션 and never 카테고리', () => {
    expect(valuesOf('ko').filter(value => value.includes('카테고리'))).toEqual([]);
    expect(valuesOf('ko').some(value => value.includes('컬렉션'))).toBe(true);
  });

  it('English never calls a Collection a category', () => {
    expect(valuesOf('en').filter(value => /\bcategor/i.test(value))).toEqual([]);
  });

  it.each(SUPPORTED_LANGUAGES)('%s has no leftover of the old term', language => {
    expect(valuesOf(language).filter(value => OLD_TERM.test(value))).toEqual([]);
  });
});

describe('sharing terminology: 공유 with 읽기 / 쓰기, never 일반 공유 / 공동작업 or internal role names', () => {
  it('Korean has no 일반 공유 / 공동작업 left', () => {
    expect(valuesOf('ko').filter(value => /일반 공유|공동작업/.test(value))).toEqual([]);
  });

  it('English never shows the internal Viewer / Contributor roles or a separate "collaboration" mode', () => {
    expect(valuesOf('en').filter(value => /\bviewer\b|\bcontributor|collaborat/i.test(value))).toEqual([]);
  });
});
