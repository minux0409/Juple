import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { APP_LANGUAGES, formatMessage } from '../lib/appI18n.ts';
import { getAppDictionary } from '../lib/appDictionary.ts';

describe('membership policy parity and unapproved legal drafts', () => {
  for (const language of APP_LANGUAGES) {
    it(`${language}: Web uses the localized cohort-aware trial copy`, () => {
      const dictionary = getAppDictionary(language);
      assert.ok(dictionary.membershipFreeNotice.includes('720'));
      assert.ok(dictionary.trialWelcomeBody.includes('720'));
      const rendered = formatMessage(dictionary.trialWelcomeBody, { date: 'SERVER_DATE' });
      assert.ok(rendered.includes('SERVER_DATE'));
      assert.doesNotMatch(rendered, /\{\{?date\}?\}/);
    });
  }
  it('all 15 amendments remain pending, without an effective date or consent revision', () => {
    const path = fileURLToPath(new URL('../../../docs/legal/membership-drafts/review-status.json', import.meta.url));
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(manifest.effectiveDate, null);
    assert.equal(manifest.consentVersionChange, null);
    assert.equal(manifest.languages.length, 15);
    assert.ok(manifest.languages.every((entry: { languageApproved: boolean; legalApproved: boolean }) => !entry.languageApproved && !entry.legalApproved));
    for (const source of ['lib/legalContent.ts', 'app/(app)/AppRoot.tsx']) {
      assert.doesNotMatch(readFileSync(new URL(`../${source}`, import.meta.url), 'utf8'), /membership-drafts/);
    }
  });
});
