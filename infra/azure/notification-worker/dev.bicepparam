using 'main.bicep'

// Dev: cost first - scale to zero while idle. The first Push after idle waits for a cold start
// (tens of seconds); every later one in the same burst is near-immediate. Raise minReplicas to 1 to
// measure warm latency.
param environmentName = 'dev'
param minReplicas = 0
param maxReplicas = 2
// Scaled to zero, the first message waits up to this for KEDA to notice it (then a cold start).
param pollingIntervalSeconds = 10
param cooldownPeriodSeconds = 300

param acrLoginServer = readEnvironmentVariable('JUPLE_APP_ACR_LOGIN_SERVER')
param containerAppsEnvironmentId = readEnvironmentVariable('JUPLE_APP_CONTAINER_APPS_ENVIRONMENT_ID')
param notificationWorkerIdentityResourceId = readEnvironmentVariable('JUPLE_APP_NOTIFICATION_WORKER_IDENTITY_RESOURCE_ID')
param notificationWorkerIdentityClientId = readEnvironmentVariable('JUPLE_APP_NOTIFICATION_WORKER_IDENTITY_CLIENT_ID')
param serviceBusNamespaceName = readEnvironmentVariable('JUPLE_APP_SERVICE_BUS_NAMESPACE_NAME')
param imageTag = readEnvironmentVariable('JUPLE_APP_IMAGE_TAG')
param sqlConnectionString = readEnvironmentVariable('JUPLE_APP_SQL_CONNECTION_STRING')
param firebaseServiceAccountKeyJson = readEnvironmentVariable('JUPLE_APP_FIREBASE_SERVICE_ACCOUNT_KEY_JSON')
