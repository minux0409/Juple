using 'main.bicep'

// Production: one replica always warm so a subscription change is applied within about a second; KEDA adds replicas for bursts.
param environmentName = 'prod'
param minReplicas = 1
param maxReplicas = 4
param pollingIntervalSeconds = 15
param cooldownPeriodSeconds = 300

// Every value below uses the JUPLE_APP_PROD_* namespace - never the Dev worker's JUPLE_APP_* names - so a
// shell that still holds Dev values can never feed Dev settings into a Production deployment. None has
// a default: a missing one fails the build with BCP427.
//
// Explicit, never silent: Production billing is neither on nor off by omission. Set
// JUPLE_APP_PROD_GOOGLE_BILLING_ENABLED to 'true' or 'false' (any other value fails). When false the
// runtime is deployed inert (see main.bicep); the API must be given the same value.
param googleBillingEnabled = bool(readEnvironmentVariable('JUPLE_APP_PROD_GOOGLE_BILLING_ENABLED'))

param acrLoginServer = readEnvironmentVariable('JUPLE_APP_PROD_ACR_LOGIN_SERVER')
param containerAppsEnvironmentId = readEnvironmentVariable('JUPLE_APP_PROD_CONTAINER_APPS_ENVIRONMENT_ID')
param billingIdentityResourceId = readEnvironmentVariable('JUPLE_APP_PROD_BILLING_IDENTITY_RESOURCE_ID')
param billingIdentityClientId = readEnvironmentVariable('JUPLE_APP_PROD_BILLING_IDENTITY_CLIENT_ID')
param serviceBusNamespaceName = readEnvironmentVariable('JUPLE_APP_PROD_SERVICE_BUS_NAMESPACE_NAME')
param billingKeyVaultUri = readEnvironmentVariable('JUPLE_APP_PROD_BILLING_KEY_VAULT_URI')
param imageTag = readEnvironmentVariable('JUPLE_APP_PROD_IMAGE_TAG')
param sqlConnectionString = readEnvironmentVariable('JUPLE_APP_PROD_SQL_CONNECTION_STRING')
param googleProductId = readEnvironmentVariable('JUPLE_APP_PROD_GOOGLE_PRODUCT_ID')
param googleBasePlanId = readEnvironmentVariable('JUPLE_APP_PROD_GOOGLE_BASE_PLAN_ID')
param googlePubSubAudience = readEnvironmentVariable('JUPLE_APP_PROD_GOOGLE_PUBSUB_AUDIENCE')
param googlePushServiceAccountEmail = readEnvironmentVariable('JUPLE_APP_PROD_GOOGLE_PUSH_SERVICE_ACCOUNT_EMAIL')
