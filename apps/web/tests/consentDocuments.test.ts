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
    assert.equal(termsDocument(readLegalOperatorConfig({})).updated, '2026-11-27');
    assert.equal(publishedTermsForVersion('2099-01-01'), null);
    assert.deepEqual(legacy.consentLanguages, ['ko']);
  });
  it('binds every supported locale to the exact existing public document without approving translated drafts', () => {
    assert.deepEqual(published.supportedLanguages, [...APP_LANGUAGES]);
    const doc = termsDocument(readLegalOperatorConfig({}));
    assert.deepEqual(doc, published.document);
    const text = [doc.title, doc.intro, ...doc.sections.flatMap(section => [section.title, ...section.blocks.flatMap(block => block.kind === 'p' ? [block.text] : block.items)])].join('\n');
    assert.equal(createHash('sha256').update(text).digest('hex'), published.contentHash);
    assert.equal(published.contentHash, '2ee08527d387f8b88b32fdf34493b12aa91453d96a628ad5c8dfe3a10381d4d9', 'the published version must not silently change its body');
    assert.equal(doc.updated, '2026-11-27');
    // The terms it replaced stay readable, unchanged, as an archived version.
    const oct25 = publishedTermsForVersion('2026-10-25');
    assert.equal(oct25?.contentHash, '91017e970bc9e0922161d6bed0b29261c92858a4c01582b46af714d871f3b72b');
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

describe('earlier terms stay readable when a new version takes effect', () => {
  it('lists the historical consent original (and any archived version) as earlier terms, newest first, never the version in force', async () => {
    const { currentTermsVersion, previousTermsVersions } = await import('../lib/legalContent.ts');
    const archived = (await import('../lib/archivedPublishedTerms.generated.json', { with: { type: 'json' } })).default as readonly { version: string }[];
    assert.equal(currentTermsVersion, published.version);
    const previous = previousTermsVersions();
    assert.ok(previous.includes('2026-10-14'));
    assert.ok(!previous.includes(currentTermsVersion));
    assert.deepEqual([...previous], [...previous].sort().reverse());
    for (const item of archived) {
      assert.ok(previous.includes(item.version));
      assert.notEqual(publishedTermsForVersion(item.version), null);
    }
  });

  it('the Terms page passes every readable version, the one in force first, and a superseded version says so', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync(new URL('../app/terms/page.tsx', import.meta.url), 'utf8');
    assert.match(page, /termsVersions=\{\[currentTermsVersion, \.\.\.previousTermsVersions\(\)\]\}/);
    const view = readFileSync(new URL('../app/_legal/LegalDocumentView.tsx', import.meta.url), 'utf8');
    assert.match(view, /data-terms-superseded/);
    assert.match(view, /data-terms-versions/);
    assert.match(view, /original\.updated !== inForce/);
  });
});
