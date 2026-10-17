import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { LANGUAGE_COOKIE } from '../../lib/appI18n';
import { getDictionary, resolvePublicLocale } from '../../lib/i18n';
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
  const dict = getDictionary(resolvePublicLocale((await cookies()).get(LANGUAGE_COOKIE)?.value, (await headers()).get('accept-language')));
  return buildSiteMetadata(dict.landingDescription, '/');
}

export default async function WelcomePage() {
  const requestHeaders = await headers();
  const locale = resolvePublicLocale((await cookies()).get(LANGUAGE_COOKIE)?.value, requestHeaders.get('accept-language'));
  const store = planLandingStore({ platform: resolveClientPlatform(requestHeaders.get('user-agent')), googlePlayUrl: storeConfig.googlePlayUrl });
  return <JupleLanding locale={locale} store={store} />;
}
