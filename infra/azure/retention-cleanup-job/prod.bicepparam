// Production parameters for ./main.bicep (the daily data-retention cleanup Job). Nothing is deployed by this
// file existing. JUPLE_APP_PROD_* only, no defaults: a missing value fails the build with BCP427.
//
// Deploy this Job before the subscription program starts (docs/data-retention.md) so ledger and purchase
// retention is enforced.
using 'main.bicep'

param environmentName = 'prod'

param acrLoginServer = readEnvironmentVariable('JUPLE_APP_PROD_ACR_LOGIN_SERVER')
param containerAppsEnvironmentId = readEnvironmentVariable('JUPLE_APP_PROD_CONTAINER_APPS_ENVIRONMENT_ID')
param managedIdentityResourceId = readEnvironmentVariable('JUPLE_APP_PROD_MANAGED_IDENTITY_RESOURCE_ID')
param managedIdentityClientId = readEnvironmentVariable('JUPLE_APP_PROD_MANAGED_IDENTITY_CLIENT_ID')
param storageBlobServiceUri = readEnvironmentVariable('JUPLE_APP_PROD_STORAGE_BLOB_SERVICE_URI')
param imageTag = readEnvironmentVariable('JUPLE_APP_PROD_IMAGE_TAG')

// SQL runtime connection string: Key Vault reference only (see ../job/prod.bicepparam).
param sqlConnectionStringFromKeyVault = true
param keyVaultUri = readEnvironmentVariable('JUPLE_APP_PROD_KEY_VAULT_URI')
