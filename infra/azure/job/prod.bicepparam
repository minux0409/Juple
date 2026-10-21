// Production parameters for ./main.bicep (the push-dispatch Job). Nothing is deployed by this file existing.
//
// Every value uses the JUPLE_APP_PROD_* namespace and has no default: a missing one fails the build with BCP427,
// and a shell that still holds Dev values can never feed them into a Production deployment.
using 'main.bicep'

param environmentName = 'prod'

// Production Container Registry / Container Apps environment / the API's managed identity (Foundation outputs).
param acrLoginServer = readEnvironmentVariable('JUPLE_APP_PROD_ACR_LOGIN_SERVER')
param containerAppsEnvironmentId = readEnvironmentVariable('JUPLE_APP_PROD_CONTAINER_APPS_ENVIRONMENT_ID')
param managedIdentityResourceId = readEnvironmentVariable('JUPLE_APP_PROD_MANAGED_IDENTITY_RESOURCE_ID')
// Production pins the exact image the API runs (the same digest variable as ../app/prod.bicepparam), never a tag.
param imageDigest = readEnvironmentVariable('JUPLE_APP_PROD_IMAGE_DIGEST')

// The SQL RUNTIME connection string is a Key Vault reference (secret sql-runtime-connection-string, the contained
// user juple_runtime - never the administrator), resolved through this Job's managed identity. The deployer never
// reads or passes it; a value supplied anyway is refused during validation
// (../app/sql-connection-source-guard.bicep). The administrator credential has no path into a Production workload.
param sqlConnectionStringFromKeyVault = true
param keyVaultUri = readEnvironmentVariable('JUPLE_APP_PROD_KEY_VAULT_URI')

// The FCM v1 service-account JSON of the PRODUCTION Firebase project (juple-production) - never Dev's - is a Key
// Vault reference (secret firebase-service-account-key-json), resolved through this Job's managed identity. The
// deployer never reads or passes it: there is no environment variable for it, and a value supplied anyway is
// refused during validation (../app/firebase-credential-source-guard.bicep).
param firebaseCredentialFromKeyVault = true

// APNs (iOS Push, docs/ios-apns-push.md): one .p8 token key serves the sandbox AND production gateways (each device row
// carries its own apnsEnvironment). Key ID and Team ID are not secrets; the key itself is only a Key Vault reference
// (secret apns-private-key-pem in the Production vault) - there is no parameter or environment variable for it. All three
// or none (../app/apns-config-guard.bicep). Before deploying with these values: the secret must exist and this workload's
// identity must be able to read it (the worker: ../foundation/key-vault-secret-reader.bicep scoped to that secret), and the
// image must contain the APNs backend AND its migration AddApnsDeviceSupport must already be applied.
param apnsKeyId = 'FJKA3F5KV3'
param apnsTeamId = '3N2K257SW3'
param apnsPrivateKeySecretName = 'apns-private-key-pem'
