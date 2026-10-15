// Dev parameters for ./main.bicep (caj-juple-blob-cleanup-dev). Mirrors the live Dev Job (checked 2026-10-15) except that the Entra
// account-deletion client secret is now a Key Vault reference - the same structure Production uses (prod.bicepparam), so the vault
// mode is exercised on Dev first. Live/per-deployment values come from the deploying shell (readEnvironmentVariable), like
// ../app/dev.bicepparam; nothing secret is written here.
//
//   $env:JUPLE_APP_ACR_LOGIN_SERVER / JUPLE_APP_CONTAINER_APPS_ENVIRONMENT_ID / JUPLE_APP_MANAGED_IDENTITY_RESOURCE_ID /
//   JUPLE_APP_MANAGED_IDENTITY_CLIENT_ID / JUPLE_APP_STORAGE_BLOB_SERVICE_URI / JUPLE_APP_SQL_CONNECTION_STRING (Dev keeps the runtime
//   connection string as a parameter value) / JUPLE_JOB_IMAGE_TAG
//   az deployment group create --resource-group rg-juple-dev --parameters infra/azure/blob-cleanup-job/dev.bicepparam
using 'main.bicep'

param environmentName = 'dev'
param acrLoginServer = readEnvironmentVariable('JUPLE_APP_ACR_LOGIN_SERVER')
param containerAppsEnvironmentId = readEnvironmentVariable('JUPLE_APP_CONTAINER_APPS_ENVIRONMENT_ID')
param managedIdentityResourceId = readEnvironmentVariable('JUPLE_APP_MANAGED_IDENTITY_RESOURCE_ID')
param managedIdentityClientId = readEnvironmentVariable('JUPLE_APP_MANAGED_IDENTITY_CLIENT_ID')
param storageBlobServiceUri = readEnvironmentVariable('JUPLE_APP_STORAGE_BLOB_SERVICE_URI')
param imageTag = readEnvironmentVariable('JUPLE_JOB_IMAGE_TAG')

param triggerType = 'Schedule'
param cronExpression = '*/5 * * * *'

param sqlConnectionString = readEnvironmentVariable('JUPLE_APP_SQL_CONNECTION_STRING')

// The Dev vault (also billingKeyVaultUri in ../app/dev.bicepparam). id-juple-dev holds Key Vault Secrets User on it.
param keyVaultUri = 'https://kv-juple-dev-lg4zigc62h2.vault.azure.net/'

// The Dev deletion app registration (docs/account-deletion-entra.md). Its secret is read from the vault secret
// entra-account-deletion-client-secret through the Managed Identity - never passed as a value.
param entraAccountDeletionEnabled = true
param entraAccountDeletionTenantId = 'd2e79a05-cf5f-43ab-86d2-717e025a74b1'
param entraAccountDeletionClientId = '0006055e-a22e-43da-b6c4-28995e2ae5f5'
param entraAccountDeletionClientSecretFromKeyVault = true
