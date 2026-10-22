import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { membershipDiff } from '../lib/itemEdit.ts';
import { saveInboxEntryBody } from '../lib/newLink.ts';
import { createPickerUnlockSession, unlockTokensFor } from '../lib/pickerUnlockSession.ts';
import type { CollectionSummary } from '../lib/collectionsView.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const later = () => new Date(Date.now() + 10 * 60_000).toISOString();

// Choosing a password-locked Collection in 새 링크 검토 / 링크 수정: the password panel is a <form> inside the link's <form>, and a
// React submit bubbles through the component tree - 잠금 해제 used to run the link's 저장 too (old selection, then the page left).
describe('choosing a locked Collection in the link form', () => {
  it('the password dialog stops its submit before it reaches the link form', () => {
    const dialog = source('app/(app)/PasswordDialog.tsx');
    assert.match(dialog, /className=\{styles\.dialogBody\} onSubmit=\{event => event\.stopPropagation\(\)\}>\s*\{open \? children : null\}/);
  });

  it('the dialog is portalled out of the link form: a <form> inside a <form> never reached its React handler in Chrome', () => {
    const dialog = source('app/(app)/PasswordDialog.tsx');
    assert.match(dialog, /createPortal\(dialog, host\)/);
    assert.match(dialog, /anchor\.closest\('main'\) \?\? document\.body/);
    // The real-browser test (tests/browser/lockedCollection.browser.mjs, `npm run test:browser`) proves it in Chrome.
  });

  it('both screens use the one picker inside the link form, so the one guard covers both', () => {
    for (const screen of ['app/(app)/items/new/NewLinkReviewView.tsx', 'app/(app)/items/[itemId]/edit/ItemEditView.tsx']) {
      const view = source(screen);
      assert.match(view, /<ItemFormLayout onSubmit=\{\(\) => void save\(\)\}>[\s\S]*<ItemCollectionsSection[\s\S]*<\/ItemFormLayout>/, screen);
    }
    assert.match(source('app/(app)/ItemForm.tsx'), /<form[\s\S]*onSubmit=[\s\S]*<CollectionPicker \{\.\.\.props\} \/>/);
    const picker = source('app/(app)/CollectionPicker.tsx');
    assert.match(picker, /<PasswordDialog cancelLabel=\{dictionary\.cancel\} onCancel=\{closePrompt\} open=\{pending !== null\}>\s*\{pending \? \(\s*<UnlockPanel/);
  });

  it('a successful unlock chooses the tapped Collection; cancel or a refused password leaves the choice as it was', () => {
    const picker = source('app/(app)/CollectionPicker.tsx');
    // The tapped Collection is kept in a ref while the prompt is open - not looked up again from a list that may have been re-read.
    assert.match(picker, /pendingToggle\.current = \{ collection: current, settle \};\s*setPending\(\{ collection: current, gate \}\);/);
    assert.match(picker, /onUnlocked=\{finishPrompt\}/);
    assert.match(picker, /const finishPrompt = \(\) => \{[\s\S]*if \(waiting\) \{\s*commit\(waiting\.collection\);\s*waiting\.settle\(true\);/);
    // 취소 / Escape: nothing is chosen.
    assert.match(picker, /const closePrompt = \(\) => \{[\s\S]*setPending\(null\);\s*waiting\?\.settle\(false\);\s*\};/);
    // A wrong password or an API error keeps the panel open (it shows the error) and never calls onUnlocked.
    const panel = source('app/(app)/collections/[collectionId]/UnlockPanel.tsx');
    assert.match(panel, /caught => \{\s*setBusy\(false\);[\s\S]*setError\(unlockErrorMessage\(caught, kind, dictionary\)\);/);
    assert.doesNotMatch(panel.slice(panel.indexOf('caught => {')), /onUnlocked\(\)/);
    // The screens add the Collection with a functional update: the answer comes after the prompt, from an older render.
    assert.match(source('app/(app)/items/new/NewLinkReviewView.tsx'), /const toggle = \(collection: CollectionSummary\) => \{\s*setSelected\(previous => \{/);
    assert.match(source('app/(app)/items/[itemId]/edit/ItemEditView.tsx'), /const toggleCollection = \(collection: CollectionSummary\) => \{\s*setStaged\(previous => \{/);
  });

  it('the save sends the unlocked Collection with its grant (new link) and adds it with its grant (edit)', () => {
    const session = createPickerUnlockSession();
    session.remember(42, { unlockToken: 'grant-42', expiresAtUtc: later() });
    // 새 링크 검토: the chosen ids and only their grants.
    const body = saveInboxEntryBody('https://example.com/a', 'request-1', [7, 42], unlockTokensFor(session, [7, 42]));
    assert.deepEqual(body.collectionIds, [7, 42]);
    assert.deepEqual(body.unlockTokens, { 42: 'grant-42' });
    // 링크 수정: the link was in 7; choosing locked 42 adds exactly 42, and its grant is what the add uses.
    const collection = (id: number) => ({ id, name: `C${id}` }) as CollectionSummary;
    const diff = membershipDiff(new Set([7]), [collection(7), collection(42)]);
    assert.deepEqual(diff.toAdd.map(entry => entry.id), [42]);
    assert.deepEqual(diff.toRemoveIds, []);
    assert.equal(session.tokenFor(42), 'grant-42');
    assert.match(source('app/(app)/items/[itemId]/edit/ItemEditView.tsx'), /applyItemMembershipChanges\(api, itemId, toAdd, toRemoveIds, collectionId => pickerSession\.tokenFor\(collectionId\), dictionary\)/);
  });
});
