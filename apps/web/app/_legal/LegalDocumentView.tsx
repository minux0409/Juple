import Link from 'next/link';
import { type LegalOperatorConfig } from '../../lib/legalConfig';
import { documentOperatorFacts, type LegalDocument } from '../../lib/legalContent';
import { selectLegalDocument } from '../../lib/legalLocalization';
import { formatLegalPageDate, legalChromeLabels, legalFallbackNotices, legalDocumentLink, legalAccountDeletionLabels, legalLanguage } from '../../lib/legalDocumentPolicy.generated';
import { APP_LANGUAGES } from '../../lib/appI18n';
import { getAppDictionary } from '../../lib/appDictionary';

/** Splits "**bold**" markers into <strong> - the only inline markup the legal text uses. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split('**').map((part, index) => (index % 2 === 1 ? <strong key={index}>{part}</strong> : part))}
    </>
  );
}

/**
 * `termsVersions` (the Terms page only): every readable version, the one in force first. A superseded version says so and links to the
 * one in force; every page lists the other versions, so no published text becomes unreachable when a new version takes effect.
 */
export function LegalDocumentView({ doc: original, config, requestedLanguage = 'ko', termsVersions }: { doc: LegalDocument; config: LegalOperatorConfig; requestedLanguage?: string; termsVersions?: readonly string[] }) {
  const selected = selectLegalDocument(original, requestedLanguage);
  const { doc, language } = selected;
  const dictionary = getAppDictionary(selected.requestedLanguage);
  const link = (path: string) => legalDocumentLink(path, selected.requestedLanguage, path === '/terms' && original.slug === 'terms' ? original.updated : undefined)!;
  const facts = documentOperatorFacts(config);
  // The page's own words follow the reader's language; the legal text itself is the approved document (Korean original when no approved
  // translation exists - said by the fallback notice above it).
  const chrome = legalChromeLabels[legalLanguage(selected.requestedLanguage)];
  const date = (isoDate: string) => formatLegalPageDate(isoDate, selected.requestedLanguage);
  const versionLink = (version: string) => legalDocumentLink('/terms', selected.requestedLanguage, version)!;
  const inForce = termsVersions?.[0];
  const otherVersions = termsVersions?.filter(version => version !== original.updated) ?? [];

  return (
    <main className="legalMain" lang={selected.requestedLanguage} dir={selected.requestedLanguage === 'ar' ? 'rtl' : 'ltr'}>
      <header className="legalHeader">
        <Link className="legalBrand" href="/">
          Juple
        </Link>
        <nav aria-label={chrome.legalNav} className="legalNav">
          <Link href={link('/privacy')}>{dictionary.customerCenterPrivacy}</Link>
          <Link href={link('/terms')}>{dictionary.customerCenterTerms}</Link>
          <Link href={link('/account-deletion')}>{legalAccountDeletionLabels[selected.requestedLanguage]}</Link>
        </nav>
      </header>

      <form action={`/${doc.slug}`} method="get" className="legalLanguageForm">
        {doc.slug === 'terms' ? <input type="hidden" name="version" value={doc.updated} /> : null}
        <label>{dictionary.languageTitle}
          <select name="language" defaultValue={selected.requestedLanguage}>
            {APP_LANGUAGES.map(locale => <option key={locale} value={locale}>{locale}</option>)}
          </select>
        </label>
        <button type="submit">{dictionary.save}</button>
      </form>
      {selected.fallback ? <p role="status" data-legal-fallback>{legalFallbackNotices[selected.requestedLanguage]}</p> : null}
      <article lang={language} dir={language === 'ar' ? 'rtl' : 'ltr'} data-legal-language={language}>
        <h1 className="legalTitle">{doc.title}</h1>
        <p className="legalDates">
          {config.effectiveDate ? `${chrome.effective} ${date(config.effectiveDate)} · ` : ''}{chrome.updated} {date(doc.updated)}
        </p>
        {inForce && original.updated !== inForce ? (
          <p className="legalSuperseded" role="note" data-terms-superseded>
            {chrome.superseded.replace('{date}', date(inForce))} <Link href={versionLink(inForce)}>{chrome.viewCurrent}</Link>
          </p>
        ) : null}
        <p className="legalIntro">{doc.intro}</p>

        {facts.length > 1 ? (
          <dl className="legalFacts">
            {facts.map(fact => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {doc.sections.length > 4 ? (
          <nav aria-label={chrome.contents} className="legalToc">
            <ol>
              {doc.sections.map(section => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>{section.title}</a>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}

        {doc.sections.map(section => (
          <section key={section.id} id={section.id} className="legalSection">
            <h2>{section.title}</h2>
            {section.blocks.map((block, index) => {
              if (block.kind === 'p') {
                return (
                  <p key={index}>
                    <Inline text={block.text} />
                  </p>
                );
              }
              const Tag = block.kind === 'ol' ? 'ol' : 'ul';
              return (
                <Tag key={index}>
                  {block.items.map(item => (
                    <li key={item}>
                      <Inline text={item} />
                    </li>
                  ))}
                </Tag>
              );
            })}
          </section>
        ))}
      </article>
      {otherVersions.length > 0 ? (
        <nav aria-label={chrome.otherVersions} className="legalVersions" data-terms-versions>
          <h2>{inForce && original.updated !== inForce ? chrome.otherVersions : chrome.previousVersions}</h2>
          <ul>
            {otherVersions.map(version => (
              <li key={version}>
                <Link href={versionLink(version)}>
                  {chrome.revisedOn.replace('{date}', date(version))}{version === inForce ? ` (${chrome.current})` : ''}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </main>
  );
}
