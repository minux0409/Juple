import Link from 'next/link';
import { BrandIcon } from '../(app)/BrandIcon';

/**
 * A public page that has nothing to show - an unknown address, an unknown or revoked share, a backend that could not answer: the Juple
 * lockup, one short explanation and the way back to the Juple home page. Deliberately no app install or open link.
 */
export function PublicStatePage({ lang, title, message, homeLabel }: { lang: string; title: string; message: string; homeLabel: string }) {
  return (
    <main className="statePage" lang={lang}>
      <Link aria-label="Juple" className="stateLockup" href="/">
        <BrandIcon size={48} />
        <span className="stateWordmark">Juple</span>
      </Link>
      <div className="notFound">
        <h1 className="notFoundTitle">{title}</h1>
        <p className="notFoundMessage">{message}</p>
        <Link className="stateHomeLink" href="/">
          {homeLabel}
        </Link>
      </div>
    </main>
  );
}
