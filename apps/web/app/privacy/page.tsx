import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { LegalDocumentView } from '../_legal/LegalDocumentView';
import { readLegalOperatorConfig } from '../../lib/legalConfig';
import { privacyDocument } from '../../lib/legalContent';
import { buildLegalMetadata } from '../../lib/legalMetadata';
import { normalizeHost } from '../../lib/shareLinks';
import { requestLegalLanguage } from '../_legal/requestLegalLanguage';

// Public, no sign-in. Rendered per request because the operator details and the canonical host are read at runtime.
export const dynamic = 'force-dynamic';

async function requestHost(): Promise<string | null> {
  const requestHeaders = await headers();
  return normalizeHost(requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'));
}

export async function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata(privacyDocument(readLegalOperatorConfig()), await requestHost());
}

export default async function Page({ searchParams }: { searchParams: Promise<{ language?: string }> }) {
  const config = readLegalOperatorConfig();
  return <LegalDocumentView doc={privacyDocument(config)} config={config} requestedLanguage={await requestLegalLanguage((await searchParams).language)} />;
}
