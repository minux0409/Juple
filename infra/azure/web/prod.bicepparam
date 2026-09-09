// Production parameter values for ./main.bicep - see ./dev.bicepparam's own header comment for the
// full explanation of why some parameters are literals and others use readEnvironmentVariable().
// Production Foundation/Web do not exist in Azure yet (see ../README.md) - this file exists so the
// eventual first Production deployment has a ready, environment-neutral parameter source to use,
// not because a deployment is imminent. No Azure mutation happens from this file merely existing.
//
// IMPORTANT: unlike dev.bicepparam, the live/per-deployment values below genuinely do not exist
// yet - no Production ACR/Container Apps Environment/Managed Identity has been created, and no
// image has been pushed anywhere for them. These use readEnvironmentVariable() the same as any
// other live/per-deployment value (see dev.bicepparam), which is exactly what makes this fail
// closed: deploying this file today fails immediately with a clear BCP427 "environment variable
// not set" error - it can never silently deploy with a blank or Dev-borrowed value.
using 'main.bicep'

param environmentName = 'prod'

// Matches ../README.md's Naming table pattern `cae-juple-{environmentName}` - a deterministic name
// derived from the naming convention itself, not a guess about a resource that does not exist yet.
param containerAppsEnvironmentName = 'cae-juple-prod'

// No Production custom domain is bound yet - both stay empty together (see main.bicep's own
// hasCustomDomain) until juple.co.kr (the documented canonical Production Web domain - see
// ../README.md) is actually verified and bound via `az containerapp hostname add`/`bind`, the same
// one-time CLI step this file's Dev counterpart documents for dev.juple.co.kr. Once that happens,
// replace these two lines with the real values - never guess a Managed Certificate name in advance.
param customDomainName = ''
param managedCertificateName = ''

// googlePlayUrl/appStoreUrl/appStoreAppId/iosAppId/androidAssetlinksSha256Fingerprints are all
// deliberately left unassigned - main.bicep's own "" defaults apply (storeConfig.ts/the two
// .well-known routes already treat "" identically to "unset"). None of these five have a real
// value yet (no Play/App Store listing, no Apple Developer Team ID, no Play App Signing
// certificate - see ../README.md and the root README.md's "Production release signing" section).
// Add each here individually, with its own real confirmed value, only once it actually exists -
// never a placeholder, and never dev.bicepparam's own Dev debug-keystore fingerprint (a
// completely different, Dev-only certificate - see that file's own remarks).

// Live Foundation/deploy-time values - none of these exist yet either (no Production Foundation
// has been deployed - see ../README.md). Set the matching environment variable in the deploying
// shell before running `az deployment group create` with this file; never hardcode a real value
// on these lines, and never reuse a Dev value here.
param acrLoginServer = readEnvironmentVariable('JUPLE_WEB_PROD_ACR_LOGIN_SERVER')
param containerAppsEnvironmentId = readEnvironmentVariable('JUPLE_WEB_PROD_CONTAINER_APPS_ENVIRONMENT_ID')
param managedIdentityResourceId = readEnvironmentVariable('JUPLE_WEB_PROD_MANAGED_IDENTITY_RESOURCE_ID')
param imageTag = readEnvironmentVariable('JUPLE_WEB_PROD_IMAGE_TAG')
// The Production API's own live origin (its containerAppFqdn before api.juple.co.kr is bound, or
// that custom domain afterward) - a genuinely per-deployment value, never a literal, same
// treatment as dev.bicepparam's own apiBaseUrl.
param apiBaseUrl = readEnvironmentVariable('JUPLE_WEB_PROD_API_BASE_URL')
