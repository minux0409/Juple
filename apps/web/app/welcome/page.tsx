import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getDictionary, resolveLocale } from '../../lib/i18n';
import { resolveClientPlatform } from '../../lib/platform';
import { planLandingStore } from '../../lib/publicLanding';
import { buildSiteMetadata } from '../../lib/siteMetadata';
import { storeConfig } from '../../lib/storeConfig';
import { JupleLanding } from '../_components/JupleLanding';

/**
 * The public landing page in public-only launch mode (lib/publicOnly.ts rewrites "/" here): the shared Juple landing without any
 * sign-in. Rendered per request: the store link, the operator details and the language are read at runtime.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(resolveLocale((await headers()).get('accept-language')));
  return buildSiteMetadata(dict.landingDescription, '/');
}

export default async function WelcomePage() {
  const requestHeaders = await headers();
  const locale = resolveLocale(requestHeaders.get('accept-language'));
  const store = planLandingStore({ platform: resolveClientPlatform(requestHeaders.get('user-agent')), googlePlayUrl: storeConfig.googlePlayUrl });
  return <JupleLanding locale={locale} store={store} />;
}
