import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { APP_LANGUAGES } from '../lib/appI18n.ts';
import { readLegalOperatorConfig } from '../lib/legalConfig.ts';
import { accountDeletionDocument, privacyDocument, termsDocument } from '../lib/legalContent.ts';
import { legalContentHash, selectLegalDocument } from '../lib/legalLocalization.ts';
import { legalDocumentStrings, legalReferenceNotices, referenceFactLabel, referenceTranslation, selectLegalPage } from '../lib/legalReferenceTranslations.ts';

const numbers = (text: string): string[] => [...(text.match(/\d+/g) ?? [])].sort();

describe('reference translations of the legal pages', () => {
  // The Terms come from the published consent contract and the account-deletion guide only uses the confirmed support mailbox, so the
  // default configuration renders exactly the production text; the privacy policy also prints the configured privacy officer.
  const config = readLegalOperatorConfig({});
  const terms = termsDocument(config);
  const deletion = accountDeletionDocument(config);
  const others = APP_LANGUAGES.filter(language => language !== 'ko');

  for (const language of others) {
    it(`${language}: the whole Terms and account-deletion text is shown in ${language}, as a reference under the Korean-original notice`, () => {
      for (const original of [terms, deletion]) {
        const page = selectLegalPage(original, language);
        assert.equal(page.reference, true);
        assert.equal(page.fallback, false);
        assert.equal(page.language, language);
        assert.equal(page.doc.slug, original.slug);
        assert.equal(page.doc.updated, original.updated);
        assert.deepEqual(page.doc.sections.map(section => section.id), original.sections.map(section => section.id));
        const source = legalDocumentStrings(original);
        const shown = legalDocumentStrings(page.doc);
        assert.equal(shown.length, source.length);
        assert.notDeepEqual(shown, source);
        // Never Korean body text (a few Korean proper names - the operator's own name - may remain as registered).
        assert.ok(!/[가-힣]{4,}/.test(shown.join('\n').replace(/손민욱|주플/g, '')), `${language} ${original.slug} still has Korean text`);
        shown.forEach((text, index) => {
          assert.equal(text.split('**').length, source[index].split('**').length, `${language} ${original.slug}[${index}] bold markers`);
          for (const email of source[index].match(/[\w.]+@[\w.]+/g) ?? []) assert.ok(text.includes(email), `${language} ${original.slug}[${index}] lost ${email}`);
        });
        // Every number that carries meaning (hours, days, months of retention, ages, years) survives the translation.
        for (const value of ['720', '30', '24', '14', '180', '90', '100', '5', '2026', '27']) {
          if (source.some(text => numbers(text).includes(value))) assert.ok(shown.some(text => numbers(text).includes(value)), `${language} ${original.slug} lost ${value}`);
        }
      }
      assert.ok(legalReferenceNotices[language].notice.length > 20);
      assert.notEqual(referenceFactLabel('서비스', language), '서비스');
    });
  }

  it('the privacy policy entries have exactly the structure of the production policy (operator details configured)', () => {
    const privacy = privacyDocument(readLegalOperatorConfig({ LEGAL_PRIVACY_OFFICER_NAME: 'X', LEGAL_PRIVACY_OFFICER_TITLE: 'Y' }));
    // The fixture's officer differs from production, so the hash binding refuses it (Korean original) - never a mismatched translation.
    for (const language of others) {
      assert.equal(referenceTranslation(privacy, language), null);
      assert.equal(selectLegalPage(privacy, language).fallback, true);
    }
  });

  it('Korean is the original; a changed original or an older version is never paired with a stale translation', () => {
    assert.deepEqual(selectLegalPage(terms, 'ko'), { doc: terms, language: 'ko', requestedLanguage: 'ko', fallback: false, reference: false });
    const edited = { ...deletion, intro: `${deletion.intro} ` };
    assert.notEqual(legalContentHash(edited), legalContentHash(deletion));
    assert.equal(referenceTranslation(edited, 'en'), null);
    assert.equal(selectLegalPage(edited, 'en').fallback, true);
    const older = termsDocument(config, '2026-10-14');
    assert.equal(selectLegalPage(older, 'ja').reference, false);
    assert.equal(selectLegalPage(older, 'ja').language, 'ko');
  });

  it('a reference translation is never an approved (consent) text', () => {
    for (const language of others) {
      const approved = selectLegalDocument(terms, language);
      assert.equal(approved.language, 'ko');
      assert.equal(approved.fallback, true);
    }
  });
});
