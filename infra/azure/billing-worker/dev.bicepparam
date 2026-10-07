using 'main.bicep'

// Dev: cost first - scale to zero while idle; the reconcile Job (../billing-reconcile-job) covers any gap.
param environmentName = 'dev'
param minReplicas = 0
param maxReplicas = 2
param pollingIntervalSeconds = 10
param cooldownPeriodSeconds = 300

param acrLoginServer = readEnvironmentVariable('JUPLE_APP_ACR_LOGIN_SERVER')
param containerAppsEnvironmentId = readEnvironmentVariable('JUPLE_APP_CONTAINER_APPS_ENVIRONMENT_ID')
param billingIdentityResourceId = readEnvironmentVariable('JUPLE_APP_BILLING_IDENTITY_RESOURCE_ID')
param billingIdentityClientId = readEnvironmentVariable('JUPLE_APP_BILLING_IDENTITY_CLIENT_ID')
param serviceBusNamespaceName = readEnvironmentVariable('JUPLE_APP_SERVICE_BUS_NAMESPACE_NAME')
param billingKeyVaultUri = readEnvironmentVariable('JUPLE_APP_BILLING_KEY_VAULT_URI')
param imageTag = readEnvironmentVariable('JUPLE_APP_IMAGE_TAG')
param sqlConnectionString = readEnvironmentVariable('JUPLE_APP_SQL_CONNECTION_STRING')
// Not secrets - but never guessed either: they exist only once the Play Console product / Pub/Sub push subscription do (R39-B2).
param googleProductId = readEnvironmentVariable('JUPLE_APP_GOOGLE_PRODUCT_ID')
param googleBasePlanId = readEnvironmentVariable('JUPLE_APP_GOOGLE_BASE_PLAN_ID')
param googlePubSubAudience = readEnvironmentVariable('JUPLE_APP_GOOGLE_PUBSUB_AUDIENCE')
param googlePushServiceAccountEmail = readEnvironmentVariable('JUPLE_APP_GOOGLE_PUSH_SERVICE_ACCOUNT_EMAIL')
