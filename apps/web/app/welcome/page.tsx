import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { getDictionary, resolveLocale } from '../../lib/i18n';
import { readLegalOperatorConfig } from '../../lib/legalConfig';
import { operatorFacts } from '../../lib/legalContent';
import { resolveClientPlatform } from '../../lib/platform';
import { planLandingStore } from '../../lib/publicLanding';
import { buildSiteMetadata } from '../../lib/siteMetadata';
import { storeConfig } from '../../lib/storeConfig';
import { BrandIcon } from '../(app)/BrandIcon';
import styles from '../(app)/app.module.css';
import landing from './welcome.module.css';

/**
 * The public landing page - what "/" shows in public-only launch mode (lib/publicOnly.ts): the Juple lockup, the product line, the three
 * things the app really does (save links, organize them into collections, share and collect together), the Google Play link once a
 * public listing exists (lib/publicLanding.ts - never an App Store button, never a placeholder), the legal pages and the operator's
 * details. No sign-in of any kind. Rendered per request: the store link, the operator details and the language are read at runtime.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(resolveLocale((await headers()).get('accept-language')));
  return buildSiteMetadata(dict.landingDescription, '/');
}

const iconProps = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

function LinkGlyph() {
  return (
    <svg {...iconProps}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function FolderGlyph() {
  return (
    <svg {...iconProps}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function PeopleGlyph() {
  return (
    <svg {...iconProps}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
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
  const features = [
    { key: 'save', Glyph: LinkGlyph, title: dict.featureSaveTitle, text: dict.featureSaveText },
    { key: 'organize', Glyph: FolderGlyph, title: dict.featureOrganizeTitle, text: dict.featureOrganizeText },
    { key: 'share', Glyph: PeopleGlyph, title: dict.featureShareTitle, text: dict.featureShareText },
  ];

  return (
    <main className={styles.centered} lang={locale}>
      <div className={landing.landing}>
        <div className={landing.lockup}>
          <BrandIcon size={56} />
          <h1 className={landing.wordmark}>Juple</h1>
        </div>
        <p className={landing.headline}>
          {dict.landingHeadlineLine1}
          <br />
          {dict.landingHeadlineLine2}
        </p>
        <h2 className={landing.visuallyHidden}>{dict.landingFeaturesHeading}</h2>
        <ul className={landing.features}>
          {features.map(({ key, Glyph, title, text }) => (
            <li className={landing.feature} key={key}>
              <span className={landing.featureIcon}>
                <Glyph />
              </span>
              <div className={landing.featureBody}>
                <h3 className={landing.featureTitle}>{title}</h3>
                <p className={landing.featureText}>{text}</p>
              </div>
            </li>
          ))}
        </ul>
        {store.googlePlayUrl ? (
          <a className={landing.storeButton} href={store.googlePlayUrl} rel="noopener noreferrer">
            {dict.googlePlay}
          </a>
        ) : null}
        {store.androidOnlyNote ? <p className={landing.note}>{dict.landingAndroidOnly}</p> : null}
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
