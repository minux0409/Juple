// Production parameters for ./main.bicep (the account-deletion Blob cleanup Job). Nothing is deployed by this
// file existing. JUPLE_APP_PROD_* only, no defaults: a missing value fails the build with BCP427.
using 'main.bicep'

param environmentName = 'prod'

param acrLoginServer = readEnvironmentVariable('JUPLE_APP_PROD_ACR_LOGIN_SERVER')
param containerAppsEnvironmentId = readEnvironmentVariable('JUPLE_APP_PROD_CONTAINER_APPS_ENVIRONMENT_ID')
param managedIdentityResourceId = readEnvironmentVariable('JUPLE_APP_PROD_MANAGED_IDENTITY_RESOURCE_ID')
param managedIdentityClientId = readEnvironmentVariable('JUPLE_APP_PROD_MANAGED_IDENTITY_CLIENT_ID')
param storageBlobServiceUri = readEnvironmentVariable('JUPLE_APP_PROD_STORAGE_BLOB_SERVICE_URI')
// Production pins the exact image the API runs (the same digest variable as ../app/prod.bicepparam), never a tag.
param imageDigest = readEnvironmentVariable('JUPLE_APP_PROD_IMAGE_DIGEST')

// Scheduled at the documented cadence (docs/data-retention.md) after the backend suite passed on SDK 10.0.302 and one
// observed manual run purged nothing and failed nothing. 'Manual' remains available for any one-off operator run.
param triggerType = 'Schedule'
param cronExpression = '*/5 * * * *'

// SQL runtime connection string: Key Vault reference only (see ../job/prod.bicepparam).
param sqlConnectionStringFromKeyVault = true
param keyVaultUri = readEnvironmentVariable('JUPLE_APP_PROD_KEY_VAULT_URI')

// Entra sign-in account deletion (docs/account-deletion-entra.md): OFF until the Production activation round. That round creates the
// deletion app registration in the Production External ID tenant (Graph User.ReadWrite.All + admin consent), stores its client secret
// (180-day expiry) ONLY in Key Vault as entra-account-deletion-client-secret, applies the AddPendingEntraIdentityDeletions migration, and then
// sets Enabled = true with the client id here (the API and this Job together). The secret value never goes through a parameter.
param entraAccountDeletionEnabled = false
param entraAccountDeletionClientSecretFromKeyVault = true
