import { NextResponse } from 'next/server';

/**
 * Android App Links verification file - https://<domain>/.well-known/assetlinks.json (see
 * android/app/build.gradle's `appLinksHost` and AndroidManifest.xml's App Links intent-filter in
 * apps/mobile). Statically-shaped route folder (a real "assetlinks.json" segment, not a dynamic
 * one) since this exact path is fixed by the Android spec - Next.js serves it with
 * `Content-Type: application/json` automatically via NextResponse.json.
 *
 * package_name is the real, already-established Android applicationId (see
 * apps/mobile/android/app/build.gradle) - safe to hardcode, unlike the signing certificate
 * fingerprint below. sha256_cert_fingerprints must be the SHA-256 fingerprint of the certificate
 * that actually signs the released APK/AAB (the Google Play App Signing cert once Play App
 * Signing is enabled - never the debug.keystore fingerprint, which would let a debug build spoof
 * this domain's identity to itself and nobody else). That certificate does not exist yet, so this
 * reads it from configuration rather than fabricating a value: ANDROID_ASSETLINKS_SHA256_FINGERPRINTS
 * as a comma-separated list (the spec itself allows multiple fingerprints, e.g. during a signing
 * cert rotation). Unconfigured -> 404 rather than serving an incomplete/invalid statement - a
 * missing file is a safe no-op (autoVerify just never succeeds), an invalid one is not.
 */
export function GET() {
  const rawFingerprints = process.env.ANDROID_ASSETLINKS_SHA256_FINGERPRINTS;
  const fingerprints = rawFingerprints
    ?.split(',')
    .map(fingerprint => fingerprint.trim())
    .filter(Boolean);

  if (!fingerprints || fingerprints.length === 0) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.json(
    [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.juple.app',
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ],
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
}
