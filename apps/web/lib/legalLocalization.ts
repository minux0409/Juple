import { createHash } from 'node:crypto';
import { legalLanguage, type LegalLanguage } from './legalDocumentPolicy.generated.ts';
import { type LegalDocument, publishedTermsForVersion } from './legalContent.ts';
import registry from './legalTranslations.json' with { type: 'json' };

/** No drafts are imported. Approval references must be actual review records, never inferred from file presence. */
export interface LegalTranslation {
  readonly language: LegalLanguage;
  readonly version: string;
  readonly sourceContentHash: string;
  readonly contentHash: string;
  readonly approval: { readonly status: string; readonly legalReview: string; readonly languageReview: string };
  readonly document: LegalDocument;
}
export function legalContentHash(doc: Pick<LegalDocument, 'title' | 'intro' | 'sections'>): string {
  return createHash('sha256').update([doc.title, doc.intro, ...doc.sections.flatMap(s => [s.title, ...s.blocks.flatMap(b => b.kind === 'p' ? [b.text] : [...b.items])])].join('\n')).digest('hex');
}
export function selectLegalDocument(original: LegalDocument, requested: string, translations?: readonly LegalTranslation[]) {
  const requestedLanguage = legalLanguage(requested);
  const terms = original.slug === 'terms' ? publishedTermsForVersion(original.updated) : null;
  // Terms variants live only alongside the authoritative Backend terms source, then are generated for Web.
  const candidates = translations ?? (terms
    ? ((terms as unknown as { approvedTranslations?: LegalTranslation[] }).approvedTranslations ?? [])
    : registry.translations as LegalTranslation[]);
  const matches = candidates.filter(t => t.language === requestedLanguage && t.document.slug === original.slug && t.version === original.updated);
  const approved = matches.length === 1 ? matches[0] : null;
  if (requestedLanguage !== 'ko' && approved && approved.approval?.status === 'approved' && approved.approval.legalReview?.trim() && approved.approval.languageReview?.trim()
      && approved.document.updated === original.updated && approved.sourceContentHash === legalContentHash(original)
      && approved.contentHash === legalContentHash(approved.document)) {
    return { doc: approved.document, language: requestedLanguage, requestedLanguage, fallback: false, contentHash: approved.contentHash };
  }
  return { doc: original, language: 'ko' as const, requestedLanguage, fallback: requestedLanguage !== 'ko', contentHash: legalContentHash(original) };
}
