import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { LegalDocumentView } from '../_legal/LegalDocumentView';
import { readLegalOperatorConfig } from '../../lib/legalConfig';
import { termsDocument } from '../../lib/legalContent';
import { buildLegalMetadata } from '../../lib/legalMetadata';
import { normalizeHost } from '../../lib/shareLinks';
import { notFound } from 'next/navigation';
import publishedTerms from '../../lib/publishedTerms.generated.json';

// Public, no sign-in. Rendered per request because the operator details and the canonical host are read at runtime.
export const dynamic = 'force-dynamic';

async function requestHost(): Promise<string | null> {
  const requestHeaders = await headers();
  return normalizeHost(requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'));
}

export async function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata(termsDocument(readLegalOperatorConfig()), await requestHost());
}

export default async function Page({ searchParams }: { searchParams: Promise<{ version?: string; language?: string }> }) {
  const query = await searchParams;
  if ((query.version && query.version !== publishedTerms.version)
      || (query.language && !publishedTerms.supportedLanguages.includes(query.language))) notFound();
  const config = readLegalOperatorConfig();
  return <LegalDocumentView doc={termsDocument(config)} config={config} />;
}
