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

// Manual until the first observed run is signed off: nothing destructive starts on its own. Switching to 'Schedule'
// (the template default and the documented cadence) is a deliberate one-line change, not an accident of deployment.
param triggerType = 'Manual'

// SQL runtime connection string: Key Vault reference only (see ../job/prod.bicepparam).
param sqlConnectionStringFromKeyVault = true
param keyVaultUri = readEnvironmentVariable('JUPLE_APP_PROD_KEY_VAULT_URI')
