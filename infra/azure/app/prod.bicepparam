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

// (superseded - see the explicit publicWebBaseUrl at the end of this file.) publicWebBaseUrl was
// deliberately left unassigned - main.bicep's own "" default applies (a safe
// no-op: CORS allows no origins, share URLs compose against an empty origin). juple.co.kr (the
// documented canonical Production Web domain - see ../README.md) is not bound to
// ca-juple-web-prod yet. Add `param publicWebBaseUrl = 'https://juple.co.kr'` here only once that
// binding is actually verified and live - the same order Dev itself followed (bind Web's domain
// first, update the API's publicWebBaseUrl only after - see ../README.md's "Web custom domain"
// deployment order), never set in advance of the real binding.

// Confirmed initial Production scale/sizing decision (see ../README.md's "Production SKU/scale"
// section for the full reasoning) - a fixed fact about how Production is meant to run, not a
// live-generated or per-deployment value, so a literal here is safe to commit (same category as
// containerAppsEnvironmentName above). Unlike Dev's scale-to-zero posture (main.bicep's own
// defaults: minReplicas=0, maxReplicas=1, 0.25 vCPU/0.5Gi), Production keeps one instance always
// warm (no cold start on a real user's first request) with burst headroom, and doubles per-replica
// sizing since minReplicas=1 means this allocation is now a genuine 24/7 commitment, not a
// scale-to-zero convenience.
param minReplicas = 1
param maxReplicas = 3
param containerCpu = '0.5'
param containerMemory = '1Gi'

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
param collectionUnlockGrantEncryptionKey = readEnvironmentVariable('JUPLE_APP_PROD_COLLECTION_UNLOCK_GRANT_ENCRYPTION_KEY')
// Production's own share-password key - generated once for Production, never Dev's (see ../README.md
// "Collection share password key"), and then passed unchanged on every later deployment.
param collectionSharePasswordEncryptionKey = readEnvironmentVariable('JUPLE_APP_PROD_COLLECTION_SHARE_PASSWORD_ENCRYPTION_KEY')

// -----------------------------------------------------------------------------------------------
// Google Play billing (R39-B) - explicit, never silently off. main.bicep's own default is false (it is
// shared with environments that do not run billing), so Production states it here and has NO default:
// JUPLE_APP_PROD_GOOGLE_BILLING_ENABLED must be 'true' or 'false' ('false' is a conscious "API without
// billing", e.g. the first deployment before Play Console/Key Vault are ready). With 'true', an empty
// product / plan / audience / push service account / Key Vault URI / Service Bus value stops the
// deployment during validation (billing-settings-guard.bicep), and the API itself refuses to start on
// an incomplete billing configuration. None of these values is a secret; the secret VALUES are Key
// Vault secrets referenced by name through the API's managed identity (see main.bicep) - this file
// never carries one.
// -----------------------------------------------------------------------------------------------
param googleBillingEnabled = bool(readEnvironmentVariable('JUPLE_APP_PROD_GOOGLE_BILLING_ENABLED'))
param googleProductId = readEnvironmentVariable('JUPLE_APP_PROD_GOOGLE_PRODUCT_ID')
param googleBasePlanId = readEnvironmentVariable('JUPLE_APP_PROD_GOOGLE_BASE_PLAN_ID')
// The exact RTDN webhook URL the Production Pub/Sub push subscription is configured with
// (https://api.juple.co.kr/api/v1/billing/google/rtdn once that domain is bound) and the push
// subscription's service account e-mail.
param googlePubSubAudience = readEnvironmentVariable('JUPLE_APP_PROD_GOOGLE_PUBSUB_AUDIENCE')
param googlePushServiceAccountEmail = readEnvironmentVariable('JUPLE_APP_PROD_GOOGLE_PUSH_SERVICE_ACCOUNT_EMAIL')
// Foundation's billing.bicep output "keyVaultUri" (trailing slash).
param billingKeyVaultUri = readEnvironmentVariable('JUPLE_APP_PROD_BILLING_KEY_VAULT_URI')
// Foundation output "serviceBusNamespaceFqdn": the notification fast path (NotificationPipeline__ServiceBusNamespace)
// and the billing-events wake-up (Billing__Events__ServiceBusNamespace) use the same namespace.
param serviceBusNamespaceFqdn = readEnvironmentVariable('JUPLE_APP_PROD_SERVICE_BUS_NAMESPACE_FQDN')
param billingEventsServiceBusNamespace = readEnvironmentVariable('JUPLE_APP_PROD_SERVICE_BUS_NAMESPACE_FQDN')

// The subscription program (trial + enforcement) stays OFF: turning it on is a separate, approved
// launch step (docs/subscription-launch-policy.md) that also needs billingProgramStartAtUtc and the
// trial-identity-hash-key secret. Stated explicitly so it can never be enabled by omission or by a
// stray environment variable.
param billingProgramEnabled = false

// -----------------------------------------------------------------------------------------------
// Mobile update policy (MobileVersionPolicy) - Android builds are versionCode numbers.
// 0 / 0 = no policy: nobody is prompted and nobody is blocked. Production has no store build yet.
// When the first Production build is DOWNLOADABLE from Google Play, set mobileAndroidLatestBuild to
// its versionCode (optional update prompt for older builds). Raise mobileAndroidMinimumSupportedBuild
// only when older builds are unsafe/incompatible, and only after the new build is confirmed
// downloadable (docs/architecture.md "App update policy" / "Release compatibility rule"). The values
// are literals on purpose: a build number is a reviewed release decision, not a per-deploy secret.
// -----------------------------------------------------------------------------------------------
param mobileAndroidLatestBuild = 0
param mobileAndroidMinimumSupportedBuild = 0
// mobileAndroidStoreUrl is left unassigned (empty): the app falls back to its own Play listing.
// iOS is not released: mobileIos* stay at main.bicep's own defaults (0 / 0 / empty).

// Application Insights connection string (../monitoring/main.bicep). Optional and currently inert -
// the backend has no telemetry SDK yet (see docs/production-bring-up.md).
param applicationInsightsConnectionString = readEnvironmentVariable('JUPLE_APP_PROD_APPLICATIONINSIGHTS_CONNECTION_STRING', '')

// The Public Web Viewer origin the API composes every share URL against and scopes api/v1/public/* CORS
// to. Required, no default: an empty value silently means "no CORS origin, share URLs without an origin",
// which is not a launchable state. Set it to the real origin - https://juple.co.kr once that domain is
// bound to ca-juple-web-prod, or until then the Web Container App's own https://<fqdn>. Only an https URL
// without a trailing path belongs here.
param publicWebBaseUrl = readEnvironmentVariable('JUPLE_APP_PROD_PUBLIC_WEB_BASE_URL')
