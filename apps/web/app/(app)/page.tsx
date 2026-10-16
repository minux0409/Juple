import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getDictionary, resolveLocale } from '../../lib/i18n';
import { buildSiteMetadata } from '../../lib/siteMetadata';
import { HomeView } from './HomeView';

/** The site's own link preview for "/" (the landing a signed-out visitor sees): canonical juple.co.kr, the Juple icon. */
export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(resolveLocale((await headers()).get('accept-language')));
  return buildSiteMetadata(dict.landingDescription, '/');
}

/** "/": Home (오늘 저장한 링크) once signed in; AppRoot shows the Juple landing (웹에서 시작하기) instead while signed out. */
export default function HomePage() {
  return <HomeView />;
}
