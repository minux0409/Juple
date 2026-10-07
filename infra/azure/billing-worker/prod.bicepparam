using 'main.bicep'

// Production: one replica always warm so a subscription change is applied within about a second; KEDA adds replicas for bursts.
param environmentName = 'prod'
param minReplicas = 1
param maxReplicas = 4
param pollingIntervalSeconds = 15
param cooldownPeriodSeconds = 300

param acrLoginServer = readEnvironmentVariable('JUPLE_APP_ACR_LOGIN_SERVER')
param containerAppsEnvironmentId = readEnvironmentVariable('JUPLE_APP_CONTAINER_APPS_ENVIRONMENT_ID')
param billingIdentityResourceId = readEnvironmentVariable('JUPLE_APP_BILLING_IDENTITY_RESOURCE_ID')
param billingIdentityClientId = readEnvironmentVariable('JUPLE_APP_BILLING_IDENTITY_CLIENT_ID')
param serviceBusNamespaceName = readEnvironmentVariable('JUPLE_APP_SERVICE_BUS_NAMESPACE_NAME')
param billingKeyVaultUri = readEnvironmentVariable('JUPLE_APP_BILLING_KEY_VAULT_URI')
param imageTag = readEnvironmentVariable('JUPLE_APP_IMAGE_TAG')
param sqlConnectionString = readEnvironmentVariable('JUPLE_APP_SQL_CONNECTION_STRING')
param googleProductId = readEnvironmentVariable('JUPLE_APP_GOOGLE_PRODUCT_ID')
param googleBasePlanId = readEnvironmentVariable('JUPLE_APP_GOOGLE_BASE_PLAN_ID')
param googlePubSubAudience = readEnvironmentVariable('JUPLE_APP_GOOGLE_PUBSUB_AUDIENCE')
param googlePushServiceAccountEmail = readEnvironmentVariable('JUPLE_APP_GOOGLE_PUSH_SERVICE_ACCOUNT_EMAIL')
