// Dev parameters for ./main.bicep (the Instagram metadata retry Job). Same readEnvironmentVariable() convention as
// ../app/dev.bicepparam: live identifiers and the SQL connection string come from the deployer's shell, never this file.
//
//   $env:JUPLE_APP_ACR_LOGIN_SERVER / JUPLE_APP_CONTAINER_APPS_ENVIRONMENT_ID / JUPLE_APP_MANAGED_IDENTITY_RESOURCE_ID
//   $env:JUPLE_APP_IMAGE_TAG = '<already-pushed juple-api tag>'
//   $env:JUPLE_APP_SQL_CONNECTION_STRING = '<the Dev connection string already live on the Job>'
//   az deployment group create --resource-group rg-juple-dev --parameters infra/azure/instagram-metadata-retry-job/dev.bicepparam
using 'main.bicep'

param environmentName = 'dev'

// Off day to day (cost review 2026-10-14: an every-minute execution was ~₩11k/month, the largest single Dev cost, and Production does not
// deploy this Job). The Job stays, as a Manual-trigger Job: set true here and redeploy - ideally with the API's current image tag - for
// Instagram metadata testing, or run one pass with `az containerapp job start`.
param scheduleEnabled = false

param acrLoginServer = readEnvironmentVariable('JUPLE_APP_ACR_LOGIN_SERVER')
param containerAppsEnvironmentId = readEnvironmentVariable('JUPLE_APP_CONTAINER_APPS_ENVIRONMENT_ID')
param managedIdentityResourceId = readEnvironmentVariable('JUPLE_APP_MANAGED_IDENTITY_RESOURCE_ID')
param imageTag = readEnvironmentVariable('JUPLE_APP_IMAGE_TAG')
param sqlConnectionString = readEnvironmentVariable('JUPLE_APP_SQL_CONNECTION_STRING')
