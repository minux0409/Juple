using 'main.bicep'

// Production: latency first - one replica always warm, so a Push starts within about a second; KEDA
// adds replicas for bursts and large fan-outs.
param environmentName = 'prod'
param minReplicas = 1
param maxReplicas = 10
// With a warm replica, polling only paces scale-out.
param pollingIntervalSeconds = 15
param cooldownPeriodSeconds = 300

// Every value below uses the JUPLE_APP_PROD_* namespace - never the Dev worker's JUPLE_APP_* names - so a
// shell that still holds Dev values can never feed Dev settings (including the Dev Firebase credential)
// into a Production deployment. None has a default: a missing one fails the build with BCP427.
param acrLoginServer = readEnvironmentVariable('JUPLE_APP_PROD_ACR_LOGIN_SERVER')
param containerAppsEnvironmentId = readEnvironmentVariable('JUPLE_APP_PROD_CONTAINER_APPS_ENVIRONMENT_ID')
param notificationWorkerIdentityResourceId = readEnvironmentVariable('JUPLE_APP_PROD_NOTIFICATION_WORKER_IDENTITY_RESOURCE_ID')
param notificationWorkerIdentityClientId = readEnvironmentVariable('JUPLE_APP_PROD_NOTIFICATION_WORKER_IDENTITY_CLIENT_ID')
param serviceBusNamespaceName = readEnvironmentVariable('JUPLE_APP_PROD_SERVICE_BUS_NAMESPACE_NAME')
// Production pins the exact image the API runs (the same digest variable as ../app/prod.bicepparam), never a tag.
param imageDigest = readEnvironmentVariable('JUPLE_APP_PROD_IMAGE_DIGEST')
// The SQL RUNTIME connection string is a Key Vault reference (secret sql-runtime-connection-string in the
// Production vault, built for the contained database user juple_runtime - never the administrator), resolved
// through this workload's managed identity. The deployer never reads or passes it: there is no environment
// variable for it, and a value supplied anyway is refused during validation
// (../app/sql-connection-source-guard.bicep). The administrator credential (jupleadmin, Key Vault secret
// sql-admin-password) is for migrations and operations only and has no path into a Production workload.
param sqlConnectionStringFromKeyVault = true
// The vault the runtime connection string is read from (billing.bicep output keyVaultUri, trailing slash).
param keyVaultUri = readEnvironmentVariable('JUPLE_APP_PROD_KEY_VAULT_URI')
// The FCM v1 service-account JSON of the PRODUCTION Firebase project (juple-production) is a Key Vault reference
// (secret firebase-service-account-key-json), resolved through this workload's own managed identity, which holds
// a reader role scoped to that one secret (../foundation/key-vault-secret-reader.bicep). The deployer never reads
// or passes it: there is no environment variable for it, and a value supplied anyway is refused during validation
// (../app/firebase-credential-source-guard.bicep).
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
