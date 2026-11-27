import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { LegalDocumentView } from '../_legal/LegalDocumentView';
import { readLegalOperatorConfig } from '../../lib/legalConfig';
import { accountDeletionDocument } from '../../lib/legalContent';
import { buildLegalMetadata } from '../../lib/legalMetadata';
import { normalizeHost } from '../../lib/shareLinks';
import { requestLegalLanguage } from '../_legal/requestLegalLanguage';
import { selectLegalPage } from '../../lib/legalReferenceTranslations';

// Public, no sign-in. Rendered per request because the operator details and the canonical host are read at runtime.
export const dynamic = 'force-dynamic';

async function requestHost(): Promise<string | null> {
  const requestHeaders = await headers();
  return normalizeHost(requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'));
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ language?: string }> }): Promise<Metadata> {
  // Title and description in the language the page is shown in (approved or reference translation, else the Korean original).
  const doc = selectLegalPage(accountDeletionDocument(readLegalOperatorConfig()), await requestLegalLanguage((await searchParams).language)).doc;
  return buildLegalMetadata(doc, await requestHost());
}

export default async function Page({ searchParams }: { searchParams: Promise<{ language?: string }> }) {
  const config = readLegalOperatorConfig();
  return <LegalDocumentView doc={accountDeletionDocument(config)} config={config} requestedLanguage={await requestLegalLanguage((await searchParams).language)} />;
}
