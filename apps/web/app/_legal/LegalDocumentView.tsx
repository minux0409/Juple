import Link from 'next/link';
import { formatLegalDate, type LegalOperatorConfig } from '../../lib/legalConfig';
import { operatorFacts, type LegalDocument } from '../../lib/legalContent';

/** Splits "**bold**" markers into <strong> - the only inline markup the legal text uses. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split('**').map((part, index) => (index % 2 === 1 ? <strong key={index}>{part}</strong> : part))}
    </>
  );
}

export function LegalDocumentView({ doc, config }: { doc: LegalDocument; config: LegalOperatorConfig }) {
  const facts = operatorFacts(config);

  return (
    <main className="legalMain" lang="ko">
      <header className="legalHeader">
        <Link className="legalBrand" href="/">
          Juple
        </Link>
        <nav aria-label="법적 고지" className="legalNav">
          <Link href="/privacy">개인정보처리방침</Link>
          <Link href="/terms">이용약관</Link>
          <Link href="/account-deletion">계정 삭제 안내</Link>
        </nav>
      </header>

      <article>
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
