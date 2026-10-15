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

// Entra sign-in account deletion (docs/account-deletion-entra.md) - ON since the Production activation round (2026-10-15):
// app registration "Juple Account Deletion" in the Production External ID tenant (Graph application permission User.ReadWrite.All,
// admin-consented), its 180-day client secret (keyId 38f037fc-..., ends 2027-04-13T05:16:49Z - rotate before, see the runbook) stored ONLY
// in Key Vault as entra-account-deletion-client-secret (vault exp set to the same instant) and read through the Managed Identity.
// This Job and the API are enabled together (the Job first). The secret value never goes through a parameter.
param entraAccountDeletionEnabled = true
param entraAccountDeletionTenantId = '30b18993-9ccd-42f3-90bd-f2ff819c0f10'
param entraAccountDeletionClientId = 'a3890a59-3e27-4fb1-8935-e659e396459b'
param entraAccountDeletionClientSecretName = 'entra-account-deletion-client-secret'
param entraAccountDeletionClientSecretFromKeyVault = true
