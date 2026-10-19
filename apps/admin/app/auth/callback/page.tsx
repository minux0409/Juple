import { RedirectBridge } from './RedirectBridge';

/**
 * The ONLY redirect URI registered for the Admin app: MSAL's redirect bridge. It hands the Entra response back to the page that
 * started sign-in (or to the parent frame for silent renewal) and never calls the API or renders admin content.
 */
export default function AuthCallbackPage() {
  return <RedirectBridge />;
}
