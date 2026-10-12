import { headers } from 'next/headers';
import { connection } from 'next/server';
import { getAppDictionary } from '../../lib/appI18n';
import { resolveLocale } from '../../lib/i18n';
import { readWebAppConfig, WEB_APP_CONFIG_ENV } from '../../lib/webAppConfig';
import { AppRoot } from './AppRoot';

/**
 * The signed-in Juple Web app (/, /archive, /collections, /me). Rendered per request so the sign-in configuration is read from the
 * RUNTIME environment (one image for every environment) - and only the public names in WEB_APP_CONFIG_ENV are read and passed
 * to the browser, never the environment itself. The public viewer (/c/...), the legal pages and the /auth/callback bridge live
 * outside this group and never require sign-in.
 */
export default async function SignedInAppLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const env: Record<string, string | undefined> = {};
  for (const name of Object.values(WEB_APP_CONFIG_ENV)) {
    env[name] = process.env[name];
  }
  const result = readWebAppConfig(env);
  const locale = resolveLocale((await headers()).get('accept-language'));

  return (
    <AppRoot config={result.ok ? result.config : null} dictionary={getAppDictionary(locale)} locale={locale}>
      {children}
    </AppRoot>
  );
}
