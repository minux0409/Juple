// Dev-specific parameter values for ./main.bicep (the API Container App is otherwise
// environment-neutral - see main.bicep's own param descriptions, especially entraInstance/
// entraTenantId/entraClientId and customDomainName/managedCertificateName, both of which used to
// default to Dev-only values baked into the template itself). Mirrors ../web/dev.bicepparam's own
// structure and reasoning exactly - see that file's header comment for the fuller explanation of
// why some parameters are literals here and others use readEnvironmentVariable().
//
// This file must assign every parameter main.bicep declares without a default - `az bicep
// build-params`/`az deployment group create` reject a .bicepparam file that leaves any of them
// unassigned (error BCP258), and Azure CLI additionally only accepts a single `--parameters`
// argument once a .bicepparam file is one of them - so, unlike ../README.md's older app/job/
// blob-cleanup-job examples (written before this file existed), a second `--parameters
// key=value` cannot be layered on top of this file to fill in the rest. That includes the three
// @secure() parameters below (sqlConnectionString, publicCollectionCursorEncryptionKey,
// collectionUnlockGrantEncryptionKey, collectionSharePasswordEncryptionKey) - there is
// no other slot left to supply them in once a .bicepparam file is used, so they use
// readEnvironmentVariable() exactly like every other live/per-deployment value here. This does not
// change how secret they are: the actual value still never appears in this committed file, only
// the name of an environment variable the deployer sets transiently in their own shell right
// before running the deployment - the same "never in a checked-in parameter file" rule
// main.bicep's own @secure() param descriptions already state, just routed through
// readEnvironmentVariable() instead of a now-impossible second `--parameters key=value`.
//
// Three different kinds of values below:
//   - A fixed fact about the Dev environment itself (containerAppsEnvironmentName, the Entra Dev
//     tenant's own public identifiers, PublicWeb's already-bound Dev domain) - a literal value,
//     safe to commit, confirmed against the actual live ca-juple-api-dev Container App
//     (`az containerapp show`) rather than assumed.
//   - Deliberately empty (customDomainName/managedCertificateName) - ca-juple-api-dev has no
//     custom domain bound yet (confirmed via `az containerapp hostname list` returning `[]`),
//     unlike ../web/dev.bicepparam's Web counterpart. Leave both empty together until one is
//     actually bound - see main.bicep's own hasCustomDomain.
//   - A live Azure-generated identifier or a genuinely per-deployment/secret value - never a
//     literal here (guessing one would be exactly the kind of fabricated value
//     ../../../CLAUDE.md prohibits) - via readEnvironmentVariable(), same as
//     ../web/dev.bicepparam's own acrLoginServer/containerAppsEnvironmentId/
//     managedIdentityResourceId/imageTag/apiBaseUrl:
//
//   $env:JUPLE_APP_ACR_LOGIN_SERVER = $foundation.acrLoginServer.value
//   $env:JUPLE_APP_CONTAINER_APPS_ENVIRONMENT_ID = $foundation.containerAppsEnvironmentId.value
//   $env:JUPLE_APP_MANAGED_IDENTITY_RESOURCE_ID = $foundation.managedIdentityResourceId.value
//   $env:JUPLE_APP_MANAGED_IDENTITY_CLIENT_ID = $foundation.managedIdentityClientId.value
//   $env:JUPLE_APP_STORAGE_BLOB_SERVICE_URI = $foundation.storageBlobServiceUri.value
//   $env:JUPLE_APP_IMAGE_TAG = '<already-pushed tag>'
//   $env:JUPLE_APP_SQL_CONNECTION_STRING = '<full ASP.NET Core SQL connection string>'
//   $env:JUPLE_APP_PUBLIC_COLLECTION_CURSOR_ENCRYPTION_KEY = '<existing Base64 32-byte key - the
//     SAME value already live, never a freshly generated one; see main.bicep's own param
//     description on why rotating it disrupts in-flight pagination cursors>'
//   $env:JUPLE_APP_COLLECTION_UNLOCK_GRANT_ENCRYPTION_KEY = '<the SAME Base64 32-byte key already
//     live on ca-juple-api-dev (secret collection-unlock-grant-key) - its own value, never the
//     cursor key; see main.bicep's own param description>'
//   $env:JUPLE_APP_COLLECTION_SHARE_PASSWORD_ENCRYPTION_KEY = '<the SAME Base64 32-byte key already
//     live on ca-juple-api-dev (secret collection-share-password-key) - NEVER a freshly generated
//     one: existing share passwords are sealed with it and a different key makes them unreadable to
//     their Owners (see main.bicep's own param description and ../README.md)>'
//   az deployment group create --resource-group <rg> --parameters infra/azure/app/dev.bicepparam
using 'main.bicep'

param environmentName = 'dev'

// Matches ../README.md's Naming table pattern `cae-juple-{environmentName}` - a deterministic
// name, not a generated identifier, so stating it here is not a guess.
param containerAppsEnvironmentName = 'cae-juple-dev'

// ca-juple-api-dev has no custom domain bound today - confirmed via
// `az containerapp hostname list --name ca-juple-api-dev` returning `[]`. Leave both empty
// together (see main.bicep's own hasCustomDomain) until api.juple.co.kr's Dev-equivalent, if one
// is ever bound here, is actually verified and live - never guess a name in advance.
param customDomainName = ''
param managedCertificateName = ''

// The Dev Entra External ID tenant's own public OAuth identifiers - confirmed live on
// ca-juple-api-dev via `az containerapp show` (Authentication__EntraExternalId__* env vars), not
// assumed. Not secrets (already committed as such in
// backend/src/Juple.Api/appsettings.Development.json).
param entraInstance = 'https://jupledev.ciamlogin.com/'
param entraTenantId = 'd2e79a05-cf5f-43ab-86d2-717e025a74b1'
param entraClientId = '14bcc3b7-7b37-4051-9e40-63cc2a5ffc8b'
// entraRequiredScope is left unassigned here - main.bicep's own default ('access_as_user') already
// matches Dev's live value (confirmed via the same `az containerapp show`), and that parameter
// keeps a default in main.bicep itself since it is not tenant-specific (see its own description).

// Overrides main.bicep's own scale-to-zero default (minReplicas=0) - confirmed empirically that a
// cold start from zero replicas takes over 30s (a direct `Invoke-WebRequest` to /health measured
// ~31s), well past Mobile's single-attempt 15s request timeout (see
// apps/mobile/src/api/apiClient.ts's DEFAULT_API_TIMEOUT_MS) - this was the actual root cause of a
// reproducible "backendUnavailable" error on the very first app launch after the Dev API had been
// idle long enough to scale to zero, with an immediate second launch (hitting the now-warm
// container) always succeeding. Dogfood specifically needs the Dev API to behave reliably for
// real, unattended usage on a phone with no PC/Metro to work around this - so, unlike a pure
// cost-minimized Dev posture, this trades the scale-to-zero savings for that reliability. maxReplicas/
// containerCpu/containerMemory are left at main.bicep's own Dev defaults - only the cold-start
// behavior itself was the problem, not throughput or per-replica sizing.
param minReplicas = 1

// The Public Web Viewer origin CollectionsController composes every share URL against - confirmed
// live via `az containerapp show` (PublicWeb__BaseUrl). A fixed fact about Dev today (the same
// already-bound, already-verified domain literal ../web/dev.bicepparam's own customDomainName
// commits), not a value that changes on an ordinary redeploy the way imageTag does.
param publicWebBaseUrl = 'https://dev.juple.co.kr'

// Live Foundation/deploy-time values and secrets - see the file header comment above. Set the
// matching environment variable in the deploying shell before running `az deployment group
// create` with this file; never hardcode a real value on these lines.
param acrLoginServer = readEnvironmentVariable('JUPLE_APP_ACR_LOGIN_SERVER')
param containerAppsEnvironmentId = readEnvironmentVariable('JUPLE_APP_CONTAINER_APPS_ENVIRONMENT_ID')
param managedIdentityResourceId = readEnvironmentVariable('JUPLE_APP_MANAGED_IDENTITY_RESOURCE_ID')
param managedIdentityClientId = readEnvironmentVariable('JUPLE_APP_MANAGED_IDENTITY_CLIENT_ID')
param storageBlobServiceUri = readEnvironmentVariable('JUPLE_APP_STORAGE_BLOB_SERVICE_URI')
param imageTag = readEnvironmentVariable('JUPLE_APP_IMAGE_TAG')
param sqlConnectionString = readEnvironmentVariable('JUPLE_APP_SQL_CONNECTION_STRING')
param publicCollectionCursorEncryptionKey = readEnvironmentVariable('JUPLE_APP_PUBLIC_COLLECTION_CURSOR_ENCRYPTION_KEY')
param collectionUnlockGrantEncryptionKey = readEnvironmentVariable('JUPLE_APP_COLLECTION_UNLOCK_GRANT_ENCRYPTION_KEY')
param collectionSharePasswordEncryptionKey = readEnvironmentVariable('JUPLE_APP_COLLECTION_SHARE_PASSWORD_ENCRYPTION_KEY')

// -----------------------------------------------------------------------------------------------
// Settings that were live on ca-juple-api-dev (confirmed read-only with `az containerapp show`, env
// var names and non-secret values only) but missing from this file and main.bicep - which meant the
// next Bicep redeploy of the Dev API would have silently dropped them. They are literals for the same
// reason as the Entra values above: fixed, non-secret facts about Dev, and no new environment
// variable is required, so the existing Dev deploy workflow is unchanged.
// -----------------------------------------------------------------------------------------------

// Mobile update policy: Android LatestBuild is 17 live; no MinimumSupportedBuild and no StoreUrl were
// set (0 / empty = nothing forced). NOTE: apps/mobile's current versionCode is 21, so Dev's "latest"
// is behind the code - left as it is live; changing it is a release decision, not an IaC fix.
param mobileAndroidLatestBuild = 17
param mobileAndroidMinimumSupportedBuild = 0

// Google Play billing, as live on Dev (the secret values are Key Vault references through id-juple-dev;
// only the Key Vault URI and secret NAMES - main.bicep's defaults - are here).
param googleBillingEnabled = true
param googleProductId = 'juple_monthly'
param googleBasePlanId = 'monthly'
param googlePubSubAudience = 'https://ca-juple-api-dev.proudfield-673db2f2.koreacentral.azurecontainerapps.io/api/v1/billing/google/rtdn'
param googlePushServiceAccountEmail = 'juple-rtdn-push-dev@juple-9fa62.iam.gserviceaccount.com'
param billingKeyVaultUri = 'https://kv-juple-dev-lg4zigc62h2.vault.azure.net/'
param serviceBusNamespaceFqdn = 'sb-juple-dev-lg4zigc62h2qg.servicebus.windows.net'
param billingEventsServiceBusNamespace = 'sb-juple-dev-lg4zigc62h2qg.servicebus.windows.net'
// billingProgramEnabled stays at main.bicep's default (false) - live Dev has no Billing__ProgramEnabled.
