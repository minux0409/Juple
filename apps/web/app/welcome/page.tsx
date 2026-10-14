import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { getDictionary, resolveLocale } from '../../lib/i18n';
import { readLegalOperatorConfig } from '../../lib/legalConfig';
import { operatorFacts } from '../../lib/legalContent';
import { resolveClientPlatform } from '../../lib/platform';
import { planLandingStore } from '../../lib/publicLanding';
import { storeConfig } from '../../lib/storeConfig';
import { BrandIcon } from '../(app)/BrandIcon';
import styles from '../(app)/app.module.css';

/**
 * The public landing page - what "/" shows in public-only launch mode (lib/publicOnly.ts): the Juple icon and name, one line about
 * Juple, the Google Play link (lib/publicLanding.ts - never an App Store button), the legal pages and the operator's details. No sign-in
 * of any kind. Rendered per request: the store link, the operator details and the language are read at runtime.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(resolveLocale((await headers()).get('accept-language')));
  return { title: 'Juple', description: dict.landingTagline };
}

export default async function WelcomePage() {
  const requestHeaders = await headers();
  const locale = resolveLocale(requestHeaders.get('accept-language'));
  const dict = getDictionary(locale);
  const store = planLandingStore({ platform: resolveClientPlatform(requestHeaders.get('user-agent')), googlePlayUrl: storeConfig.googlePlayUrl });
  const legal = readLegalOperatorConfig();
  const facts = operatorFacts(legal).filter(fact => fact.label !== '서비스');
  if (facts.length > 0 && legal.supportEmail) {
    facts.push({ label: '이메일', value: legal.supportEmail });
  }

  return (
    <main className={styles.centered} lang={locale}>
      <div className={styles.landingCard}>
        <BrandIcon size={72} />
        <h1 className={styles.brandName}>Juple</h1>
        <p className={styles.tagline}>{dict.landingTagline}</p>
        {store.googlePlayUrl ? (
          <a className={styles.primaryButton} href={store.googlePlayUrl} rel="noopener noreferrer">
            {dict.googlePlay}
          </a>
        ) : null}
        {store.androidOnlyNote ? <p className={styles.tagline}>{dict.landingAndroidOnly}</p> : null}
        {store.comingSoon ? <p className={styles.tagline}>{dict.installComingSoon}</p> : null}
        <nav aria-label={dict.landingPrivacy} className="legalNav">
          <Link href="/privacy">{dict.landingPrivacy}</Link>
          <Link href="/terms">{dict.landingTerms}</Link>
          <Link href="/account-deletion">{dict.landingAccountDeletion}</Link>
        </nav>
        {facts.length > 0 ? (
          <p className="footerNote" lang="ko">
            {facts.map(fact => `${fact.label} ${fact.value}`).join(' · ')}
          </p>
        ) : null}
      </div>
    </main>
  );
}
