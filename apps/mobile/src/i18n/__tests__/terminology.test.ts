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

describe('sharing terminology: 공용 컬렉션 설정 / 접근 비밀번호 (the internal "sharePassword" keys stay)', () => {
  it('Korean says 접근 비밀번호 and 공개 링크, never 공유 비밀번호 or 모든 사용자 공유', () => {
    expect(valuesOf('ko').filter(value => /공유 비밀번호|모든 사용자/.test(value))).toEqual([]);
    expect(valuesOf('ko')).toEqual(expect.arrayContaining(['접근 비밀번호', '공용 컬렉션 설정']));
    expect(valuesOf('ko')).not.toContain('공개 링크 공유');
  });

  it('English says access password, never share password', () => {
    expect(valuesOf('en').filter(value => /share password/i.test(value))).toEqual([]);
    expect(valuesOf('en')).toContain('Access password');
  });
});

describe('Public Collection wording (공용 컬렉션)', () => {
  const ko = (group: string, key: string) => ((require('../locales/ko.json') as Record<string, Record<string, string>>)[group][key]);

  it('the Share title, the end toast, the permission warnings and the link description all say 공용 컬렉션', () => {
    expect(ko('shareSheet', 'allUsersTitle')).toBe('공용 컬렉션 설정');
    expect(ko('collections', 'publicShareEnded')).toBe('공용 컬렉션이 종료되었습니다.');
    expect(ko('shareSheet', 'belowPublicPermission')).toContain('공용 컬렉션 권한보다 낮은 권한');
    expect(ko('shareSheet', 'permissionMismatch')).toContain('공용 컬렉션 권한');
    expect(ko('shareSheet', 'raiseRolesMessage')).toContain('공용 컬렉션 권한');
    expect(ko('linkShare', 'description')).toContain('공용 컬렉션');
  });

  it('no Korean string still calls the same concept 컬렉션 공개 (a plain 공개 링크 / 공개 공유 elsewhere means something else)', () => {
    expect(valuesOf('ko').filter(value => value.includes('컬렉션 공개'))).toEqual([]);
  });
});
