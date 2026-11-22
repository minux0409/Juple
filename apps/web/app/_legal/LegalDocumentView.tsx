import Link from 'next/link';
import { formatLegalDate, type LegalOperatorConfig } from '../../lib/legalConfig';
import { documentOperatorFacts, type LegalDocument } from '../../lib/legalContent';
import { selectLegalDocument } from '../../lib/legalLocalization';
import { legalFallbackNotices, legalDocumentLink, legalAccountDeletionLabels } from '../../lib/legalDocumentPolicy.generated';
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

export function LegalDocumentView({ doc: original, config, requestedLanguage = 'ko' }: { doc: LegalDocument; config: LegalOperatorConfig; requestedLanguage?: string }) {
  const selected = selectLegalDocument(original, requestedLanguage);
  const { doc, language } = selected;
  const dictionary = getAppDictionary(selected.requestedLanguage);
  const link = (path: string) => legalDocumentLink(path, selected.requestedLanguage, path === '/terms' && original.slug === 'terms' ? original.updated : undefined)!;
  const facts = documentOperatorFacts(config);

  return (
    <main className="legalMain" lang={selected.requestedLanguage} dir={selected.requestedLanguage === 'ar' ? 'rtl' : 'ltr'}>
      <header className="legalHeader">
        <Link className="legalBrand" href="/">
          Juple
        </Link>
        <nav aria-label="법적 고지" className="legalNav">
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
          {config.effectiveDate ? `시행일 ${formatLegalDate(config.effectiveDate)} · ` : ''}최종 수정일 {formatLegalDate(doc.updated)}
        </p>
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
          <nav aria-label="목차" className="legalToc">
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
    </main>
  );
}
