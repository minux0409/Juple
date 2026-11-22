import { cookies, headers } from 'next/headers';
import { isAppLanguage, LANGUAGE_COOKIE, parseLanguagePreference, resolveAppLanguage } from '../../lib/appI18n';

export async function requestLegalLanguage(explicit?: string) {
  if (isAppLanguage(explicit)) return explicit;
  const preference = parseLanguagePreference((await cookies()).get(LANGUAGE_COOKIE)?.value);
  return resolveAppLanguage(preference, (await headers()).get('accept-language'));
}
