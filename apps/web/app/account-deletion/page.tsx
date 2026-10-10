import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { LegalDocumentView } from '../_legal/LegalDocumentView';
import { readLegalOperatorConfig } from '../../lib/legalConfig';
import { accountDeletionDocument } from '../../lib/legalContent';
import { buildLegalMetadata } from '../../lib/legalMetadata';
import { normalizeHost } from '../../lib/shareLinks';

// Public, no sign-in. Rendered per request because the operator details and the canonical host are read at runtime.
export const dynamic = 'force-dynamic';

async function requestHost(): Promise<string | null> {
  const requestHeaders = await headers();
  return normalizeHost(requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'));
}

export async function generateMetadata(): Promise<Metadata> {
  return buildLegalMetadata(accountDeletionDocument(readLegalOperatorConfig()), await requestHost());
}

export default function Page() {
  const config = readLegalOperatorConfig();
  return <LegalDocumentView doc={accountDeletionDocument(config)} config={config} />;
}
