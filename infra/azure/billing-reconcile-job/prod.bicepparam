// Production parameters for ./main.bicep (the Google billing reconcile Job). Nothing is deployed by this file
// existing. JUPLE_APP_PROD_* only, no defaults: a missing value fails the build with BCP427.
using 'main.bicep'

param environmentName = 'prod'

param acrLoginServer = readEnvironmentVariable('JUPLE_APP_PROD_ACR_LOGIN_SERVER')
param containerAppsEnvironmentId = readEnvironmentVariable('JUPLE_APP_PROD_CONTAINER_APPS_ENVIRONMENT_ID')
param billingIdentityResourceId = readEnvironmentVariable('JUPLE_APP_PROD_BILLING_IDENTITY_RESOURCE_ID')
// Production pins the exact image the API runs (the same digest variable as ../app/prod.bicepparam), never a tag.
param imageDigest = readEnvironmentVariable('JUPLE_APP_PROD_IMAGE_DIGEST')

// Explicit, never silent (same switch as the API and the billing worker): 'true' or 'false' only.
param googleBillingEnabled = bool(readEnvironmentVariable('JUPLE_APP_PROD_GOOGLE_BILLING_ENABLED'))
param googleProductId = readEnvironmentVariable('JUPLE_APP_PROD_GOOGLE_PRODUCT_ID')
param googleBasePlanId = readEnvironmentVariable('JUPLE_APP_PROD_GOOGLE_BASE_PLAN_ID')
param googlePubSubAudience = readEnvironmentVariable('JUPLE_APP_PROD_GOOGLE_PUBSUB_AUDIENCE')
param googlePushServiceAccountEmail = readEnvironmentVariable('JUPLE_APP_PROD_GOOGLE_PUSH_SERVICE_ACCOUNT_EMAIL')

// The vault holds both the billing keys and the SQL runtime connection string (read through the billing identity).
param billingKeyVaultUri = readEnvironmentVariable('JUPLE_APP_PROD_BILLING_KEY_VAULT_URI')

// SQL runtime connection string: Key Vault reference only (see ../job/prod.bicepparam).
param sqlConnectionStringFromKeyVault = true
