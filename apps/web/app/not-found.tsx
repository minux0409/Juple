import { headers } from 'next/headers';
import { getDictionary, resolveLocale } from '../lib/i18n';

export default async function NotFound() {
  const requestHeaders = await headers();
  const dict = getDictionary(resolveLocale(requestHeaders.get('accept-language')));

  return (
    <main>
      <p className="brand">Juple</p>
      <div className="notFound">
        <p className="notFoundTitle">{dict.notFoundTitle}</p>
        <p className="notFoundMessage">{dict.notFoundMessage}</p>
      </div>
    </main>
  );
}
