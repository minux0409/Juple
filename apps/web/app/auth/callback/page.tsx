import type { Metadata } from 'next';
import { RedirectBridge } from './RedirectBridge';

export const metadata: Metadata = { title: 'Juple' };

/**
 * The ONLY redirect URI registered for the Web app: MSAL's dedicated redirect bridge. It hands the Entra response back to the page
 * that started sign-in (redirect sign-in) or to the opener / parent frame (silent renewal) and never calls the Juple API or renders
 * the signed-in app itself.
 */
export default function AuthCallbackPage() {
  return <RedirectBridge />;
}
