import { headers } from 'next/headers';
import { getDictionary, resolveLocale } from '../lib/i18n';
import { PublicStatePage } from './_components/PublicStatePage';

export default async function NotFound() {
  const requestHeaders = await headers();
  const locale = resolveLocale(requestHeaders.get('accept-language'));
  const dict = getDictionary(locale);

  return <PublicStatePage homeLabel={dict.notFoundHome} lang={locale} message={dict.notFoundMessage} title={dict.notFoundTitle} />;
}
