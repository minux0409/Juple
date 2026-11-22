import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import published from '../lib/publishedTerms.generated.json' with { type: 'json' };
import { parsePublishedTerms } from '../lib/termsDocument.generated.ts';
import legacy from '../lib/legacyPublishedTerms.generated.json' with { type: 'json' };
import { APP_LANGUAGES } from '../lib/appI18n.ts';
import { publishedTermsForVersion, termsDocument } from '../lib/legalContent.ts';
import { readLegalOperatorConfig } from '../lib/legalConfig.ts';

// Full-repository source/parser parity: npm run check:consent-documents.
// These tests use the same generated inputs as the standalone Web Docker build.
describe('published terms contract shared with native consent', () => {
  it('keeps the recovered historical source separate from the default public document', () => {
    assert.equal(legacy.version, '2026-10-14');
    assert.equal(legacy.provenance.sourceCommit, 'e3445efb891551e7afbc8a6804520f7487546e15');
    assert.equal(legacy.provenance.contentBlob, 'ee72f5da57a16002297ef6b6fe55c75131e46c8b');
    assert.equal(legacy.provenance.configBlob, '6eaad649f703622a1253fdf4e248fa4e46fde85a');
    const doc = termsDocument(readLegalOperatorConfig({}), legacy.version);
    const text = [doc.title, doc.intro, ...doc.sections.flatMap(section => [section.title, ...section.blocks.flatMap(block => block.kind === 'p' ? [block.text] : block.items)])].join('\n');
    assert.equal(createHash('sha256').update(text).digest('hex'), legacy.contentHash);
    assert.equal(legacy.contentHash, '4559616eb6d94d7b9158e1e74f96cb33793394cc3d8b5889468a53c468b824c2');
    assert.equal(doc.updated, '2026-10-14');
    assert.equal(termsDocument(readLegalOperatorConfig({})).updated, '2026-10-25');
    assert.equal(publishedTermsForVersion('2099-01-01'), null);
    assert.deepEqual(legacy.consentLanguages, ['ko']);
  });
  it('binds every supported locale to the exact existing public document without approving translated drafts', () => {
    assert.deepEqual(published.supportedLanguages, [...APP_LANGUAGES]);
    const doc = termsDocument(readLegalOperatorConfig({}));
    assert.deepEqual(doc, published.document);
    const text = [doc.title, doc.intro, ...doc.sections.flatMap(section => [section.title, ...section.blocks.flatMap(block => block.kind === 'p' ? [block.text] : block.items)])].join('\n');
    assert.equal(createHash('sha256').update(text).digest('hex'), published.contentHash);
    assert.equal(published.contentHash, '91017e970bc9e0922161d6bed0b29261c92858a4c01582b46af714d871f3b72b', 'the existing published version must not silently change its body');
    assert.equal(doc.updated, '2026-10-25');
    for (const language of APP_LANGUAGES) {
      const payload = { ...published, requestedLanguage: language, canAccept: published.consentLanguages.includes(language) };
      const parsed = parsePublishedTerms(payload, published.version);
      assert.equal(parsed?.requestedLanguage, language);
      assert.equal(parsed?.language, 'ko'); // Existing public language, not a claim that a draft translation passed review.
      assert.equal(parsed?.canAccept, language === 'ko');
      assert.equal(parsed?.contentHash, published.contentHash);
    }
  });
  it('never substitutes the current body for an unknown, future or malformed document', () => {
    const valid = { ...published, requestedLanguage: 'en', canAccept: false };
    assert.equal(parsePublishedTerms(valid, '2099-01-01'), null);
    assert.equal(parsePublishedTerms({ ...valid, version: '2099-01-01' }, '2099-01-01'), null, 'changing only the envelope version must not accept the old document');
    assert.equal(parsePublishedTerms({ ...valid, contentHash: 'wrong' }, published.version), null);
    assert.equal(parsePublishedTerms({ ...valid, document: { title: 'x', intro: '', sections: [{ id: 'x', title: 'x', blocks: [{ kind: 'html', items: [] }] }] } }, published.version), null);
  });
});
