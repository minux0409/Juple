using 'main.bicep'

// Production: latency first - one replica always warm, so a Push starts within about a second; KEDA
// adds replicas for bursts and large fan-outs.
param environmentName = 'prod'
param minReplicas = 1
param maxReplicas = 10
// With a warm replica, polling only paces scale-out.
param pollingIntervalSeconds = 15
param cooldownPeriodSeconds = 300

param acrLoginServer = readEnvironmentVariable('JUPLE_APP_ACR_LOGIN_SERVER')
param containerAppsEnvironmentId = readEnvironmentVariable('JUPLE_APP_CONTAINER_APPS_ENVIRONMENT_ID')
param notificationWorkerIdentityResourceId = readEnvironmentVariable('JUPLE_APP_NOTIFICATION_WORKER_IDENTITY_RESOURCE_ID')
param notificationWorkerIdentityClientId = readEnvironmentVariable('JUPLE_APP_NOTIFICATION_WORKER_IDENTITY_CLIENT_ID')
param serviceBusNamespaceName = readEnvironmentVariable('JUPLE_APP_SERVICE_BUS_NAMESPACE_NAME')
param imageTag = readEnvironmentVariable('JUPLE_APP_IMAGE_TAG')
param sqlConnectionString = readEnvironmentVariable('JUPLE_APP_SQL_CONNECTION_STRING')
param firebaseServiceAccountKeyJson = readEnvironmentVariable('JUPLE_APP_FIREBASE_SERVICE_ACCOUNT_KEY_JSON')
