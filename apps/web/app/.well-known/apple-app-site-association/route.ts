import { NextResponse } from 'next/server';

/**
 * iOS Universal Links verification file - https://<domain>/.well-known/apple-app-site-association
 * (no file extension; must be served with Content-Type: application/json and no redirect - see
 * apps/mobile/ios/JupleMobile/JupleMobile.entitlements). Statically-shaped route folder matching
 * the exact fixed path Apple's spec requires.
 *
 * appIDs entries are "<TeamID>.<BundleID>" - neither is fabricated here. The Apple Developer Team
 * ID does not exist in this environment (no Apple Developer account has been confirmed), so rather
 * than guess one, this whole file is config-driven off IOS_APP_ID (the already-combined
 * "TEAMID.com.juple.app" string) and returns 404 when unset - a missing AASA is a safe no-op
 * (Universal Links simply do not activate, standard http(s) links keep working), whereas serving
 * one with a wrong/placeholder Team ID would actively misconfigure the association once a real
 * Team ID is issued and never gets corrected here.
 */
export function GET() {
  const appId = process.env.IOS_APP_ID;

  if (!appId) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.json(
    {
      applinks: {
        details: [
          {
            appIDs: [appId],
            components: [{ '/': '/c/*' }],
          },
        ],
      },
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
}
