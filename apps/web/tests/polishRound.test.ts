import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { APP_LANGUAGES } from '../lib/appI18n.ts';
import { getAppDictionary } from '../lib/appDictionary.ts';
import { collectionNotificationPreferencePath } from '../lib/collectionNotifications.ts';
import { STATUS_ICON_MARKUP } from '../lib/collectionIconMarkup.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const detail = source('app/(app)/collections/[collectionId]/CollectionDetailsView.tsx');
const picker = source('app/(app)/CollectionPicker.tsx');
const mergeDialog = source('app/(app)/collections/[collectionId]/MergeCollection.tsx');
const destination = source('app/(app)/DestinationDialog.tsx');
const css = source('app/(app)/app.module.css');

describe('Collection merge picker: List | Grid', () => {
  it('only the merge dialog turns the switch on; the dialog passes it through to the picker', () => {
    assert.match(mergeDialog, /<DestinationDialog[\s\S]*viewModes\s*\/>/);
    assert.match(destination, /viewModes=\{viewModes\}/);
    assert.equal((source('app/(app)/collections/[collectionId]/CollectionDetailsView.tsx').match(/viewModes/g) ?? []).length, 0);
  });

  it('the picker offers the existing ViewModeToggle with List and Grid only, kept in memory (no storage key)', () => {
    assert.match(picker, /import \{ ViewModeToggle \} from '\.\/ViewModeToggle'/);
    assert.match(picker, /PICKER_VIEW_MODES = \['list', 'grid'\] as const/);
    assert.match(picker, /groupLabel=\{dictionary\.viewModeLabel\}/);
    assert.match(picker, /list: dictionary\.viewList, grid: dictionary\.viewGrid/);
    assert.doesNotMatch(picker, /localStorage|useStoredChoice/);
  });

  it('Grid draws icon tiles with the name underneath; List keeps a compact row; the toggle exposes the selected mode', () => {
    assert.match(picker, /styles\.choiceGridTiles/);
    assert.match(picker, /styles\.choiceListRows/);
    assert.match(picker, /styles\.choiceTile/);
    assert.match(css, /\.choice\.choiceTile,\s*\.choiceSelected\.choiceTile \{[^}]*flex-direction: column;/);
    assert.match(css, /\.choiceTile \.choiceName \{[^}]*-webkit-line-clamp: 2;/);
    const toggle = source('app/(app)/ViewModeToggle.tsx');
    assert.match(toggle, /aria-pressed=\{value === mode\}/);
    assert.match(toggle, /aria-label=\{labels\[mode\]\}/);
  });

  it('the Collection being merged is still excluded and the existing merge request / confirmation is untouched', () => {
    assert.match(mergeDialog, /excluded=\{\[collection\.id\]\}/);
    assert.match(mergeDialog, /eligible=\{candidate => isMergeTarget\(candidate, collection\.id\)\}/);
    assert.match(mergeDialog, /path: mergePath\(collection\.id\)/);
    assert.match(mergeDialog, /body: \{ targetCollectionId: target\.collection\.id \}/);
    assert.match(mergeDialog, /<ConfirmDialog[\s\S]*destructive/);
  });

  it('the choices are real buttons (Tab / Enter / Space) in the shared Modal', () => {
    assert.match(picker, /<button[\s\S]*aria-pressed=\{selected\}[\s\S]*type="button"/);
    assert.match(destination, /<Modal /);
  });
});

describe('Collection report is gone from the Collection menu', () => {
  it('no 신고 for a whole Collection; the view no longer reaches the safety provider', () => {
    assert.doesNotMatch(detail, /key: 'report'/);
    assert.doesNotMatch(detail, /type: 'Collection'/);
    assert.doesNotMatch(detail, /useSafety|dictionary\.safetyReport/);
  });

  it('comment reports still exist', () => {
    assert.match(source('app/(app)/ItemCollaboration.tsx'), /onReport=\{\(\) => safety\.report\(\{ type: 'Comment'/);
  });
});

describe('Shared Collection 알림 켜기 / 끄기', () => {
  it('uses the existing preference endpoint and payload', () => {
    assert.equal(collectionNotificationPreferencePath(7), '/api/v1/collections/7/notification-preference');
    assert.match(detail, /method: 'GET', path: collectionNotificationPreferencePath\(collectionId\)/);
    assert.match(detail, /method: 'PUT', path: collectionNotificationPreferencePath\(collectionId\), body: \{ newItemNotificationsEnabled: enabled \}/);
    const controller = readFileSync(new URL('../../../backend/src/Juple.Api/Controllers/CollectionNotificationPreferencesController.cs', import.meta.url), 'utf8');
    assert.ok(controller.includes('notification-preference'));
  });

  it('is offered only where mobile offers it (isCollaborative), and only once the server has answered', () => {
    assert.match(detail, /const offersNotifications = header\.kind === 'loaded' && isCollaborative\(header\.collection\)/);
    assert.match(detail, /newLinkNotifications === null\s*\? \[\]/);
  });

  it('the label and glyph follow the state: ON offers 알림 끄기 (bell-off), OFF offers 알림 켜기 (bell)', () => {
    assert.match(detail, /newLinkNotifications \? dictionary\.newLinkNotificationsTurnOff : dictionary\.newLinkNotificationsTurnOn/);
    assert.match(detail, /newLinkNotifications \? \('BellOff' as const\) : \('Bell' as const\)/);
    assert.ok(STATUS_ICON_MARKUP.BellOff && STATUS_ICON_MARKUP.Bell && STATUS_ICON_MARKUP.Moon && STATUS_ICON_MARKUP.Merge);
  });

  it('flips at once, rolls back to the previous state and says so on failure; only the latest change counts', () => {
    assert.ok(detail.includes("setNotificationState({ collectionId, enabled });"));
    assert.match(detail, /if \(requestId === notificationRequest\.current\) \{\s*setNotificationState\(previous\);\s*setNotificationError\(dictionary\.newLinkNotificationsError\);/);
    assert.match(detail, /role="alert">\{notificationError\}/);
  });

  it('the three strings exist in all 17 languages (mobile text, translated)', () => {
    const en = getAppDictionary('en');
    for (const language of APP_LANGUAGES) {
      const words = getAppDictionary(language);
      for (const key of ['newLinkNotificationsTurnOn', 'newLinkNotificationsTurnOff', 'newLinkNotificationsError'] as const) {
        assert.ok(words[key].trim().length > 0, `${language}.${key}`);
        if (language !== 'en') {
          assert.notEqual(words[key], en[key], `${language}.${key}`);
        }
      }
    }
  });
});

describe('merge menu item', () => {
  it('uses the merge glyph and the unchanged permission rule', () => {
    assert.match(detail, /key: 'merge', label: dictionary\.mergeWithOther, icon: 'Merge' as const/);
    assert.match(detail, /canMergeCollection\(collection,/);
  });
});

describe('one close X for every window', () => {
  const closeButton = source('app/(app)/ModalCloseButton.tsx');
  it('the shared button: a 22px X glyph, the localized 닫기 as its name, a 44px hit area with hover and keyboard focus', () => {
    assert.match(closeButton, /aria-label=\{label\}/);
    assert.match(closeButton, /<Glyph name="Close" size=\{22\} \/>/);
    assert.match(css, /\.modalCloseButton \{[^}]*width: 44px;[^}]*height: 44px;/);
    assert.match(css, /\.modalCloseButton:hover:not\(:disabled\)/);
    assert.match(css, /\.modalCloseButton:focus-visible \{[^}]*outline: 2px solid var\(--brand\)/);
  });

  it('the common Modal (Link share, participants, merge picker ...), the Friend picker, the link sheet and the reaction picker all use it - no text 닫기 button, no tiny ×', () => {
    assert.match(source('app/(app)/Modal.tsx'), /<ModalCloseButton label=\{closeLabel\} onClick=\{onClose\} \/>/);
    assert.doesNotMatch(source('app/(app)/Modal.tsx'), /\{closeLabel\}\s*<\/button>/);
    for (const file of ['app/(app)/collections/[collectionId]/FriendPicker.tsx', 'app/(app)/items/[itemId]/QuickDetailSheet.tsx', 'app/(app)/ItemCollaboration.tsx']) {
      assert.match(source(file), /<ModalCloseButton label=\{dictionary\.close\}/, file);
    }
    assert.doesNotMatch(source('app/(app)/collections/[collectionId]/FriendPicker.tsx'), /^\s*×\s*$/m);
  });
});

describe('Friend picker List | Grid', () => {
  const picker = source('app/(app)/collections/[collectionId]/FriendPicker.tsx');
  it('uses the shared toggle (List / Grid), in memory only', () => {
    assert.match(picker, /FRIEND_PICKER_VIEW_MODES = \['list', 'grid'\] as const/);
    assert.match(picker, /<ViewModeToggle[\s\S]*onChange=\{setLayout\}/);
    assert.doesNotMatch(picker, /localStorage|useStoredChoice/);
  });
  it('Grid tiles keep the pick state, the disabled rule and the avatar + name + id', () => {
    assert.match(picker, /aria-pressed=\{isPicked\}/);
    assert.match(picker, /disabled=\{blocked \|\| busy\}/);
    assert.match(picker, /styles\.friendPickTileSelected/);
    assert.match(css, /\.friendPickGrid \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(104px, 1fr\)\)/);
    // Rows keep their own height (a taller container must not stretch the tiles' rows apart).
    assert.match(css, /\.friendPickGrid \{[^}]*align-content: start;/);
    assert.match(css, /\.friendPickTileSelected \{[^}]*border: 2px solid var\(--brand\)/);
  });
});

describe('Share glyph means sharing; the external-link glyph means opening a URL', () => {
  it('the Collection header and the share dialog use the connected-dots Share glyph', () => {
    assert.match(detail, /<Glyph name="Share" size=\{16\} \/>\s*\{dictionary\.shareAction\}/);
    assert.doesNotMatch(source('app/(app)/collections/[collectionId]/CollectionDetailsView.tsx'), /name="ExternalLink"/);
    const sharing = source('app/(app)/collections/[collectionId]/CollectionSharing.tsx');
    assert.doesNotMatch(sharing, /name="ExternalLink"/);
  });
  it('opening a link still uses ExternalLink', () => {
    assert.match(source('app/(app)/items/[itemId]/ItemDetailContent.tsx'), /name="ExternalLink"/);
    assert.match(source('app/(app)/SavedLinkList.tsx'), /name="ExternalLink"/);
  });
});

describe('링크 복사 (the saved link\'s original URL)', () => {
  it('Item detail and a member\'s link both get the button; it copies item.url, never a share link', () => {
    for (const file of ['app/(app)/items/[itemId]/ItemDetailContent.tsx', 'app/(app)/collections/[collectionId]/items/[itemId]/SharedItemContent.tsx']) {
      assert.match(source(file), /<CopyLinkButton url=\{item\.url\} \/>/, file);
    }
    const button = source('app/(app)/CopyLinkButton.tsx');
    assert.match(button, /copyText\(url\)/);
    assert.match(button, /toast\.showNotice\(ok \? dictionary\.itemLinkCopied : dictionary\.itemLinkCopyFailed, ok \? 'info' : 'error'\)/);
    assert.match(button, /aria-label=\{dictionary\.itemCopyLink\}/);
  });

  it('copyText: async Clipboard API in a secure context, the copy-command fallback otherwise, a failure is reported', async () => {
    const { copyText } = await import('../lib/copyText.ts');
    const written: string[] = [];
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { navigator: g.navigator, window: g.window, document: g.document };
    try {
      Object.defineProperty(g, 'navigator', { value: { clipboard: { writeText: async (text: string) => void written.push(text) } }, configurable: true });
      g.window = { isSecureContext: true };
      assert.equal(await copyText('https://a.example/x?y=1'), true);
      assert.deepEqual(written, ['https://a.example/x?y=1']);

      // Not a secure context and no copy command available: reported as a failure.
      g.window = { isSecureContext: false };
      g.document = undefined;
      assert.equal(await copyText('z'), false);

      // Refused permission falls back to the copy command.
      Object.defineProperty(g, 'navigator', { value: { clipboard: { writeText: async () => Promise.reject(new Error('denied')) } }, configurable: true });
      g.window = { isSecureContext: true };
      let appended = 0;
      g.document = {
        createElement: () => ({ setAttribute: () => undefined, style: {}, select: () => undefined }),
        body: { appendChild: () => void (appended += 1), removeChild: () => undefined },
        execCommand: () => true,
      };
      assert.equal(await copyText('q'), true);
      assert.equal(appended, 1);
    } finally {
      Object.defineProperty(g, 'navigator', { value: saved.navigator, configurable: true });
      g.window = saved.window;
      g.document = saved.document;
    }
  });

  it('the three strings exist in all 17 languages', () => {
    const en = getAppDictionary('en');
    for (const language of APP_LANGUAGES) {
      const words = getAppDictionary(language);
      for (const key of ['itemCopyLink', 'itemLinkCopied', 'itemLinkCopyFailed'] as const) {
        assert.ok(words[key].trim().length > 0, `${language}.${key}`);
        if (language !== 'en') {
          assert.notEqual(words[key], en[key], `${language}.${key}`);
        }
      }
    }
  });
});
