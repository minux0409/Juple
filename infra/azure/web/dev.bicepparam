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

// The fingerprint currently live on ca-juple-web-dev's ANDROID_ASSETLINKS_SHA256_FINGERPRINTS env
// var (confirmed via `az containerapp show` on 2026-09-08) - it is what apps/web's
// .well-known/assetlinks.json route is serving today, and what the already-PASSed Android App
// Links Dev E2E run was verified against. Not sourced from this template/main.bicep's default
// (which is "" - see ../README.md, written before this env var was set out-of-band via the CLI,
// not through this Bicep template). Without this line, a plain `web/main.bicep` +
// `dev.bicepparam` redeploy would silently reset it to "", breaking the Dev App Links verification
// exactly like the customDomains issue above.
//
// This is NOT the home-PC Dogfood keystore's fingerprint (that one signs assembleDogfood builds
// for cross-PC update compatibility - see ../../../README.md's "Dogfood signing" section - a
// different SHA256, unrelated to what is bound here). Do not replace this value with the Dogfood
// keystore's fingerprint or regenerate it from any local keystore - it must stay whatever
// ca-juple-web-dev is actually live-verified against; if that ever needs to change, update it here
// to match a newly verified live value, not the other way around.
param androidAssetlinksSha256Fingerprints = '2C:5D:24:99:C2:D5:F6:5C:31:C4:73:20:C4:57:C7:DC:77:C4:A8:CB:B4:46:D0:84:77:E4:12:A4:82:92:A9:29'

// Live Foundation/deploy-time values - see the file header comment above. Set the matching
// environment variable in the deploying shell before running `az deployment group create` with
// this file; never hardcode a real value on these lines.
param acrLoginServer = readEnvironmentVariable('JUPLE_WEB_ACR_LOGIN_SERVER')
param containerAppsEnvironmentId = readEnvironmentVariable('JUPLE_WEB_CONTAINER_APPS_ENVIRONMENT_ID')
param managedIdentityResourceId = readEnvironmentVariable('JUPLE_WEB_MANAGED_IDENTITY_RESOURCE_ID')
param imageTag = readEnvironmentVariable('JUPLE_WEB_IMAGE_TAG')
param apiBaseUrl = readEnvironmentVariable('JUPLE_WEB_API_BASE_URL')
