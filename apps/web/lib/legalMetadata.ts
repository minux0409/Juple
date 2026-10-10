import type { Metadata } from 'next';
import type { LegalDocument } from './legalContent.ts';

/**
 * Metadata for a public legal page. Unlike the share viewer these pages are meant to be found: indexable, with a canonical URL on
 * the host the visitor actually used (null when the Host header is unusable - the canonical link is then simply omitted).
 */
export function buildLegalMetadata(doc: LegalDocument, host: string | null): Metadata {
  return {
    title: `${doc.title} | Juple`,
    description: doc.description,
    robots: { index: true, follow: true },
    ...(host ? { alternates: { canonical: `https://${host}/${doc.slug}` } } : {}),
  };
}
