// Dev-specific parameter values for ./main.bicep (the Web Container App is otherwise
// environment-neutral - see main.bicep's own param descriptions). This is the repo's first
// .bicepparam file - introduced here specifically to stop customDomainName/managedCertificateName
// from ever needing a per-environment default baked into main.bicep itself (see ../README.md's
// "Web custom domain" section for the incident that motivated this).
//
// This file must assign every parameter main.bicep declares without a default - `az bicep
// build-params`/`az deployment group create` reject a .bicepparam file that leaves any of them
// unassigned (error BCP258), and Azure CLI additionally only accepts a single `--parameters`
// argument once a .bicepparam file is one of them (confirmed via `az deployment group create
// --help`) - so, unlike ../README.md's existing app/job/blob-cleanup-job examples, a second
// `--parameters key=value` cannot be layered on top of this file to fill in the rest.
//
// That forces every required parameter to live here one way or another. Two different kinds:
//   - A fixed fact about the Dev environment itself (customDomainName, managedCertificateName,
//     containerAppsEnvironmentName) - a literal value below, safe to commit.
//   - A live Azure-generated identifier (ACR login server, Managed Identity/Environment resource
//     ID - each includes a subscription ID and/or a uniqueString() suffix this file cannot state
//     without querying Azure) or a genuinely per-deployment choice (imageTag, the API's live
//     containerAppFqdn as apiBaseUrl) - never a literal here (guessing one would be exactly the
//     kind of fabricated value ../../../CLAUDE.md prohibits). These instead use Bicep's
//     readEnvironmentVariable() so the file stays valid/complete while the actual value comes from
//     the deployer's own shell at deploy time, e.g. (PowerShell):
//
//   $env:JUPLE_WEB_ACR_LOGIN_SERVER = $foundation.acrLoginServer.value
//   $env:JUPLE_WEB_CONTAINER_APPS_ENVIRONMENT_ID = $foundation.containerAppsEnvironmentId.value
//   $env:JUPLE_WEB_MANAGED_IDENTITY_RESOURCE_ID = $foundation.managedIdentityResourceId.value
//   $env:JUPLE_WEB_IMAGE_TAG = '<already-pushed tag>'
//   $env:JUPLE_WEB_API_BASE_URL = 'https://<App(../app/main.bicep)의 containerAppFqdn>'
//   az deployment group create --resource-group <rg> --parameters infra/azure/web/dev.bicepparam
//
// None of these five are secrets (same as main.bicep's own param descriptions already say) -
// readEnvironmentVariable() is used here only to satisfy BCP258 without hardcoding a live/
// per-deploy value into a committed file, not because the value is sensitive.
using 'main.bicep'

param environmentName = 'dev'

// Matches ../README.md's Naming table pattern `cae-juple-{environmentName}` - a deterministic
// name, not a generated identifier, so stating it here is not a guess.
param containerAppsEnvironmentName = 'cae-juple-dev'

// The actual custom domain + Managed Certificate already bound to ca-juple-web-dev today (DNS/TLS
// verified, Android App Links Dev E2E PASS) - see ../README.md's "Web custom domain" section.
param customDomainName = 'dev.juple.co.kr'
param managedCertificateName = 'mc-cae-juple-dev-dev-juple-co-kr-6698'

// Dev scales to zero when idle (cost review 2026-10-14: an idle warm replica is ~₩8k/month, scale-to-zero ~₩1k). The price is the cold
// start measured on 2026-10-13: the first request after ~5 minutes idle took 25.5 s and 34.0 s (KEDA scale-from-zero detection + replica
// start + Next boot). Re-measured 2026-10-14 (v26 launch-candidate round): TTFB 26.8 s cold, 0.15 s warm - a browser that types the URL
// after idle sits on a blank loading tab. Held at 1 for the release-testing period (~₩8k/month); set back to 0 afterwards. Max stays 1
// (main.bicep default). Production keeps its own value in prod.bicepparam - this line is Dev only.
param minReplicas = 1

// Dev-only browser timing diagnostics (see main.bicep's param description); never set in prod.bicepparam. Off day to day; set true
// for a performance investigation (nothing is sent to a server either way).
param perfDiagnostics = false

// Two fingerprints, comma-separated (route.ts's GET() splits on "," - the spec itself allows a
// list, e.g. during a signing cert rotation):
//   1. The fingerprint originally live on ca-juple-web-dev's ANDROID_ASSETLINKS_SHA256_FINGERPRINTS
//      env var (confirmed via `az containerapp show` on 2026-09-08) - the already-PASSed Android
//      App Links Dev E2E run was verified against this one. Now also confirmed (via `adb shell
//      dumpsys package` against the phone's existing install) to be this machine's own
//      apps/mobile/android/app/debug.keystore fingerprint, i.e. a plain `npm run android`/
//      `react-native run-android` Debug build.
//   2. The home-PC Dogfood keystore's fingerprint (see ../../../README.md's "Dogfood signing"
//      section) - a separate, dedicated signing identity for standalone `assembleDogfood` builds,
//      added here so a Dogfood-signed install verifies dev.juple.co.kr App Links too, without
//      disturbing fingerprint 1 above (Debug App Links must keep working unchanged).
//
//   3. The Google Play App Signing certificate (R40-D) - what a Play-installed build (Internal testing included) is actually signed
//      with. NOT the upload key: App Links verify against the certificate of the installed APK. The same value is what a Production
//      parameter file must carry (plus any dogfood value that environment still needs).
//
// Not sourced from this template/main.bicep's default (which is "" - see ../README.md). Without
// this line, a plain `web/main.bicep` + `dev.bicepparam` redeploy would silently reset it to "",
// breaking Dev App Links verification for both fingerprints exactly like the customDomains issue
// above. If either value ever needs to change, update it here to match a newly verified live
// value, not the other way around - never guess or regenerate one from an unrelated keystore.
param androidAssetlinksSha256Fingerprints = '2C:5D:24:99:C2:D5:F6:5C:31:C4:73:20:C4:57:C7:DC:77:C4:A8:CB:B4:46:D0:84:77:E4:12:A4:82:92:A9:29,D8:10:EE:BB:B3:C6:90:3E:61:8F:77:5C:AB:37:14:90:C9:77:2F:72:82:C6:04:D0:F2:F8:0F:62:3C:FA:F1:2E,D5:2E:DD:99:E9:EC:7B:7F:38:12:9C:A9:1A:0F:12:9D:FE:CA:A0:6E:65:AF:F1:1B:D0:74:0B:4E:3C:F9:AB:D6'

// The signed-in Juple Web app (apps/web/app/(app)) on Dev: the Dev External ID tenant and its "Juple Web (DEV)" SPA app registration
// (whose SPA redirect URIs include https://dev.juple.co.kr/auth/callback), the Dev API scope, this site's own origin and the host of
// Dev's Collection share links. Public identifiers of the Dev environment - the same values ../app/dev.bicepparam already states for the
// API and apps/web/.env.local uses locally - never secrets (a browser app has no client secret).
param signedInWebEntraAuthority = 'https://jupledev.ciamlogin.com'
param signedInWebEntraTenantId = 'd2e79a05-cf5f-43ab-86d2-717e025a74b1'
param signedInWebEntraClientId = 'd70ac03c-811e-4535-868e-9cb94d66db64'
param signedInWebEntraApiScope = 'api://14bcc3b7-7b37-4051-9e40-63cc2a5ffc8b/access_as_user'
param signedInWebBaseUrl = 'https://dev.juple.co.kr'
param signedInWebPublicHost = 'dev.juple.co.kr'

// Live Foundation/deploy-time values - see the file header comment above. Set the matching
// environment variable in the deploying shell before running `az deployment group create` with
// this file; never hardcode a real value on these lines.
param acrLoginServer = readEnvironmentVariable('JUPLE_WEB_ACR_LOGIN_SERVER')
param containerAppsEnvironmentId = readEnvironmentVariable('JUPLE_WEB_CONTAINER_APPS_ENVIRONMENT_ID')
param managedIdentityResourceId = readEnvironmentVariable('JUPLE_WEB_MANAGED_IDENTITY_RESOURCE_ID')
param imageTag = readEnvironmentVariable('JUPLE_WEB_IMAGE_TAG')
param apiBaseUrl = readEnvironmentVariable('JUPLE_WEB_API_BASE_URL')
