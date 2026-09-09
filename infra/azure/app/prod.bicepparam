// Production parameter values for ./main.bicep - see ./dev.bicepparam's own header comment for the
// full explanation of why some parameters are literals and others use readEnvironmentVariable().
// Production Foundation/App do not exist in Azure yet (see ../README.md) - this file exists so the
// eventual first Production deployment has a ready, environment-neutral parameter source to use,
// not because a deployment is imminent. No Azure mutation happens from this file merely existing.
//
// IMPORTANT: unlike dev.bicepparam, several values below genuinely do not exist yet - the
// Production Entra External ID tenant/App Registration has not been created, and no image has
// been pushed to a Production ACR because no Production ACR exists. These use
// readEnvironmentVariable() the same as any other live/per-deployment value (see dev.bicepparam),
// which is exactly what makes this fail closed: deploying this file today, before those things
// exist, fails immediately with a clear BCP427 "environment variable not set" error - it can never
// silently deploy with a blank, guessed, or Dev-borrowed value. Nothing here is a placeholder or a
// fabricated value (see ../../../CLAUDE.md's own rule against guessing product/config facts).
using 'main.bicep'

param environmentName = 'prod'

// Matches ../README.md's Naming table pattern `cae-juple-{environmentName}` - a deterministic name
// derived from the naming convention itself, not a guess about a resource that does not exist yet.
param containerAppsEnvironmentName = 'cae-juple-prod'

// No Production custom domain is bound yet - both stay empty together (see main.bicep's own
// hasCustomDomain) until api.juple.co.kr (the documented canonical Production API domain - see
// ../README.md) is actually verified and bound via `az containerapp hostname add`/`bind`, exactly
// the same one-time CLI step ../web/dev.bicepparam's own customDomainName documents for Dev. Once
// that happens, replace these two lines with the real values - never guess a Managed Certificate
// name in advance.
param customDomainName = ''
param managedCertificateName = ''

// The Production Entra External ID tenant does not exist yet - no literal to commit, unlike
// dev.bicepparam's own (already-live) Dev tenant values. readEnvironmentVariable() makes a
// deployment attempt before this tenant/App Registration exists fail closed with a clear error
// rather than silently falling back to Dev's tenant (see main.bicep's own entraInstance
// description for the incident class this whole file exists to prevent) or deploying with an
// empty/wrong value.
param entraInstance = readEnvironmentVariable('JUPLE_APP_PROD_ENTRA_INSTANCE')
param entraTenantId = readEnvironmentVariable('JUPLE_APP_PROD_ENTRA_TENANT_ID')
param entraClientId = readEnvironmentVariable('JUPLE_APP_PROD_ENTRA_CLIENT_ID')
// entraRequiredScope is left unassigned here too - main.bicep's own default ('access_as_user')
// applies unless Production's actual App Registration exposes a differently-named scope, in which
// case add an explicit override here once that is known (see main.bicep's own description).

// publicWebBaseUrl is deliberately left unassigned - main.bicep's own "" default applies (a safe
// no-op: CORS allows no origins, share URLs compose against an empty origin). juple.co.kr (the
// documented canonical Production Web domain - see ../README.md) is not bound to
// ca-juple-web-prod yet. Add `param publicWebBaseUrl = 'https://juple.co.kr'` here only once that
// binding is actually verified and live - the same order Dev itself followed (bind Web's domain
// first, update the API's publicWebBaseUrl only after - see ../README.md's "Web custom domain"
// deployment order), never set in advance of the real binding.

// Live Foundation/deploy-time values and secrets - none of these exist yet either (no Production
// Foundation has been deployed - see ../README.md). Set the matching environment variable in the
// deploying shell before running `az deployment group create` with this file; never hardcode a
// real value on these lines, and never reuse a Dev value here.
param acrLoginServer = readEnvironmentVariable('JUPLE_APP_PROD_ACR_LOGIN_SERVER')
param containerAppsEnvironmentId = readEnvironmentVariable('JUPLE_APP_PROD_CONTAINER_APPS_ENVIRONMENT_ID')
param managedIdentityResourceId = readEnvironmentVariable('JUPLE_APP_PROD_MANAGED_IDENTITY_RESOURCE_ID')
param managedIdentityClientId = readEnvironmentVariable('JUPLE_APP_PROD_MANAGED_IDENTITY_CLIENT_ID')
param storageBlobServiceUri = readEnvironmentVariable('JUPLE_APP_PROD_STORAGE_BLOB_SERVICE_URI')
param imageTag = readEnvironmentVariable('JUPLE_APP_PROD_IMAGE_TAG')
param sqlConnectionString = readEnvironmentVariable('JUPLE_APP_PROD_SQL_CONNECTION_STRING')
param publicCollectionCursorEncryptionKey = readEnvironmentVariable('JUPLE_APP_PROD_PUBLIC_COLLECTION_CURSOR_ENCRYPTION_KEY')
