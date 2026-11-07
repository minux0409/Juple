import { SUPPORTED_LANGUAGES } from '../index';

/** Copying a link's address, copying links into another collection and moving them are three different things in every language. */
describe('selection action names: Copy link / Copy to collection / Move to collection', () => {
  const read = (language: string) => require(`../locales/${language}.json`) as Record<string, Record<string, string>>;

  it.each(SUPPORTED_LANGUAGES)('%s names the three apart and never uses the bare "Copy" / "Move" for the collection actions', language => {
    const locale = read(language);
    const copyLink = locale.item.copyLink;
    const copyToCollection = locale.selection.copyToCollection;
    const moveToCollection = locale.selection.moveToCollection;
    expect(copyToCollection).toBeTruthy();
    expect(moveToCollection).toBeTruthy();
    expect(copyToCollection).not.toBe(locale.collections.copyAction);
    expect(moveToCollection).not.toBe(locale.collections.moveAction);
    expect(new Set([copyLink, copyToCollection, moveToCollection]).size).toBe(3);
  });

  it('Korean and English read as specified', () => {
    expect(read('ko').item.copyLink).toBe('링크 복사');
    expect(read('ko').selection.copyToCollection).toBe('컬렉션에 복사');
    expect(read('ko').selection.moveToCollection).toBe('컬렉션으로 이동');
    expect(read('en').item.copyLink).toBe('Copy link');
    expect(read('en').selection.copyToCollection).toBe('Copy to collection');
    expect(read('en').selection.moveToCollection).toBe('Move to collection');
  });
});
