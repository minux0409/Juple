import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { APP_LANGUAGES } from '../lib/appI18n.ts';
import { legalLanguage, legalDocumentLink, legalFallbackNotices } from '../lib/legalDocumentPolicy.generated.ts';
import { legalContentHash, selectLegalDocument, type LegalTranslation } from '../lib/legalLocalization.ts';
import { accountDeletionDocument, privacyDocument, termsDocument } from '../lib/legalContent.ts';
import { readLegalOperatorConfig } from '../lib/legalConfig.ts';
import { parsePublishedTerms } from '../lib/termsDocument.generated.ts';
import published from '../lib/publishedTerms.generated.json' with { type: 'json' };

describe('reviewed legal document language selection', () => {
  const config = readLegalOperatorConfig({});
  const documents = [termsDocument(config), termsDocument(config, '2026-10-14'), privacyDocument(config), accountDeletionDocument(config)];
  for (const language of APP_LANGUAGES) {
    it(`${language}: no unapproved body or false translation consent`, () => {
      assert.ok(legalFallbackNotices[language]);
      for (const doc of documents) {
        const selected = selectLegalDocument(doc, language);
        assert.equal(selected.language, 'ko');
        assert.equal(selected.fallback, language !== 'ko');
        assert.deepEqual(selected.doc, doc);
        assert.equal(selected.contentHash, legalContentHash(doc));
      }
    });
  }
  it('publishes only the independently reviewed version/language/body with matching source hash', () => {
    const original = documents[2];
    // Synthetic translation, injected into the selector only; never registered as public text.
    const document = { ...original, title: 'Synthetic reviewed privacy fixture' };
    const approved: LegalTranslation = { language: 'en', version: original.updated, sourceContentHash: legalContentHash(original), contentHash: legalContentHash(document), document,
      approval: { status: 'approved', legalReview: 'test-only-legal-review', languageReview: 'test-only-language-review' } };
    assert.equal(selectLegalDocument(original, 'en', [approved]).language, 'en');
    assert.equal(selectLegalDocument(original, 'ar', [approved]).language, 'ko');
    for (const change of [{ approval: { ...approved.approval, status: 'draft' } }, { approval: { ...approved.approval, languageReview: '' } }, { contentHash: 'bad' }, { sourceContentHash: 'bad' }, { version: '2099-01-01' }]) {
      assert.equal(selectLegalDocument(original, 'en', [{ ...approved, ...change }]).language, 'ko');
    }
    assert.equal(selectLegalDocument(original, 'en', [approved, approved]).language, 'ko');
  });
  it('keeps the selected locale/version in links without treating fallback as that locale', () => {
    assert.equal(legalDocumentLink('/terms', 'ar', '2026-10-14'), '/terms?language=ar&version=2026-10-14');
    assert.equal(legalDocumentLink(null, 'en'), null);
    assert.equal(legalLanguage('__proto__'), 'en');
    assert.equal(parsePublishedTerms({ ...published, requestedLanguage: 'en', canAccept: true }, published.version), null);
  });
});
