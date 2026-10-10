import { SUPPORTED_LANGUAGES } from '../index';

const locale = (language: string) => require(`../locales/${language}.json`) as Record<string, Record<string, string>>;

describe('delete wording: a soft delete is restorable, a permanent delete is not', () => {
  it('Korean: deleting a link says it can be restored from 삭제 이력', () => {
    const ko = locale('ko');
    for (const [section, titleKey, messageKey] of [
      ['inbox', 'deleteConfirmTitle', 'deleteConfirmMessage'],
      ['history', 'deleteConfirmTitle', 'deleteConfirmMessage'],
      ['item', 'deleteItemConfirmTitle', 'deleteItemConfirmMessage'],
    ] as const) {
      expect(ko[section][titleKey]).toBe('링크를 삭제할까요?');
      expect(ko[section][messageKey]).toBe('삭제한 링크는 삭제 이력에서 복구할 수 있어요.');
      expect(ko[section][messageKey]).not.toMatch(/되돌릴 수 없|복구할 수 없/);
    }
  });

  it('English: deleting a link says it can be restored from Recently Deleted', () => {
    const en = locale('en');
    for (const [section, messageKey] of [['inbox', 'deleteConfirmMessage'], ['history', 'deleteConfirmMessage'], ['item', 'deleteItemConfirmMessage']] as const) {
      expect(en[section][messageKey]).toBe('You can restore a deleted link from Recently Deleted.');
    }
  });

  it('Korean: permanent delete and emptying the trash still say they cannot be undone', () => {
    const ko = locale('ko');
    expect(ko.trash.permanentDeleteConfirmMessage).toBe('삭제된 링크는 다시 복구할 수 없습니다.');
    expect(ko.trash.emptyTrashConfirmMessage).toContain('영구 삭제');
    expect(ko.trash.emptyTrashConfirmMessage).toContain('복구할 수 없습니다');
  });

  it('English: permanent delete and emptying the trash still say they cannot be undone', () => {
    const en = locale('en');
    expect(en.trash.permanentDeleteConfirmMessage).toMatch(/can't be (restored|recovered|undone)|cannot be/i);
    expect(en.trash.emptyTrashConfirmMessage).toMatch(/permanent/i);
  });

  it.each(SUPPORTED_LANGUAGES)('%s: the soft-delete message is never the permanent-delete message', language => {
    const data = locale(language);
    const permanent = [data.trash.permanentDeleteConfirmMessage, data.trash.emptyTrashConfirmMessage];
    for (const message of [data.inbox.deleteConfirmMessage, data.history.deleteConfirmMessage, data.item.deleteItemConfirmMessage]) {
      expect(permanent).not.toContain(message);
    }
    // All three soft-delete surfaces say the same thing.
    expect(new Set([data.inbox.deleteConfirmMessage, data.history.deleteConfirmMessage, data.item.deleteItemConfirmMessage]).size).toBe(1);
  });

  it('the permanent-delete and empty-trash messages are untouched by the soft-delete wording (distinct from it in every locale)', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const data = locale(language);
      expect(data.trash.permanentDeleteConfirmMessage).not.toBe(data.inbox.deleteConfirmMessage);
    }
  });
});
