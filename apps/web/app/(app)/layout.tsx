import { cookies, headers } from 'next/headers';
import { connection } from 'next/server';
import { getAppDictionary } from '../../lib/appDictionary';
import { LANGUAGE_COOKIE, parseLanguagePreference, resolveAppLanguage } from '../../lib/appI18n';
import { resolveClientPlatform } from '../../lib/platform';
import { planLandingStore } from '../../lib/publicLanding';
import { storeConfig } from '../../lib/storeConfig';
import { readWebAppConfig, WEB_APP_CONFIG_ENV } from '../../lib/webAppConfig';
import { JupleLanding } from '../_components/JupleLanding';
import { AppRoot } from './AppRoot';
import { SignInCta } from './SignInCta';

/**
 * The signed-in Juple Web app (/, /archive, /collections, /items, /me). Rendered per request so the sign-in configuration is read from
 * the RUNTIME environment (one image for every environment) - and only the public names in WEB_APP_CONFIG_ENV are read and passed
 * to the browser, never the environment itself. The language is the person's 언어 choice (a per-browser cookie; absent = the
 * browser's own languages), and only that language's strings are sent. The public viewer (/c/...), the legal pages and the
 * /auth/callback bridge live outside this group and never require sign-in.
 *
 * `modal` is the parallel slot of the Quick Detail sheet (@modal): a link opened by a click inside the app rises over the current page.
 */
export default async function SignedInAppLayout({ children, modal }: { children: React.ReactNode; modal: React.ReactNode }) {
  await connection();
  const env: Record<string, string | undefined> = {};
  for (const name of Object.values(WEB_APP_CONFIG_ENV)) {
    env[name] = process.env[name];
  }
  const result = readWebAppConfig(env);
  const preference = parseLanguagePreference((await cookies()).get(LANGUAGE_COOKIE)?.value);
  const requestHeaders = await headers();
  const language = resolveAppLanguage(preference, requestHeaders.get('accept-language'));
  const dictionary = getAppDictionary(language);
  // A signed-out visitor sees the Juple landing (the same one as the public-only site) with 웹에서 시작하기 as its main action.
  const signedOutLanding = (
    <JupleLanding
      locale={language === 'ko' ? 'ko' : 'en'}
      primaryAction={<SignInCta label={dictionary.startOnWeb} />}
      store={planLandingStore({ platform: resolveClientPlatform(requestHeaders.get('user-agent')), googlePlayUrl: storeConfig.googlePlayUrl })}
    />
  );

  return (
    <AppRoot
      config={result.ok ? result.config : null}
      dictionary={dictionary}
      language={language}
      languagePreference={preference}
      signedOutLanding={signedOutLanding}
    >
      {children}
      {modal}
    </AppRoot>
  );
}
