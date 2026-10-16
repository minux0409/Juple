import Link from 'next/link';
import type { Locale } from '../../lib/i18n';
import { getDictionary } from '../../lib/i18n';
import { readLegalOperatorConfig } from '../../lib/legalConfig';
import { operatorFacts } from '../../lib/legalContent';
import type { LandingStorePlan } from '../../lib/publicLanding';
import { BrandIcon } from '../(app)/BrandIcon';
import appStyles from '../(app)/app.module.css';
import landing from './landing.module.css';

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

/**
 * The Juple landing (server-rendered): the lockup, the product line, the three things the app really does (save links, organize them
 * into collections, share and collect together), the actions, the legal pages and the operator's details.
 *
 * The public /welcome page. The Google Play button appears only once a public listing URL is configured -
 * never a placeholder, never an invitation-only test track link.
 */
export function JupleLanding({ locale, store }: { locale: Locale; store: LandingStorePlan }) {
  const dict = getDictionary(locale);
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
    <main className={appStyles.centered} lang={locale}>
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
