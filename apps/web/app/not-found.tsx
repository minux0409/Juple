import { cookies, headers } from 'next/headers';
import { LANGUAGE_COOKIE } from '../lib/appI18n';
import { getDictionary, resolvePublicLocale } from '../lib/i18n';
import { PublicStatePage } from './_components/PublicStatePage';

export default async function NotFound() {
  const requestHeaders = await headers();
  const locale = resolvePublicLocale((await cookies()).get(LANGUAGE_COOKIE)?.value, requestHeaders.get('accept-language'));
  const dict = getDictionary(locale);

  return <PublicStatePage homeLabel={dict.notFoundHome} lang={locale} message={dict.notFoundMessage} title={dict.notFoundTitle} />;
}
