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
// key=value` cannot be layered on top of this file to fill in the rest. That includes the two
// @secure() parameters below (sqlConnectionString, publicCollectionCursorEncryptionKey) - there is
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
