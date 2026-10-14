// Dev parameters for ./main.bicep (the push-dispatch Job). Same readEnvironmentVariable() convention as ../app/dev.bicepparam: live
// identifiers and the SQL connection string come from the deployer's shell, never this file.
//
// The Firebase service-account JSON is deliberately NOT here (not even as an environment variable): it stays a file outside the repo and
// is layered on as the one inline override, so its content never passes through a shell variable or the screen:
//
//   $env:JUPLE_APP_ACR_LOGIN_SERVER / JUPLE_APP_CONTAINER_APPS_ENVIRONMENT_ID / JUPLE_APP_MANAGED_IDENTITY_RESOURCE_ID
//   $env:JUPLE_APP_IMAGE_TAG = '<already-pushed juple-api tag>'   (or JUPLE_APP_IMAGE_DIGEST)
//   $env:JUPLE_APP_SQL_CONNECTION_STRING = '<the Dev connection string already live on the Job>'
//   az deployment group create --resource-group rg-juple-dev `
//     --parameters infra/azure/job/dev.bicepparam `
//     --parameters firebaseServiceAccountKeyJson=@<Firebase service-account JSON file outside the repo>
//
// Forgetting the override fails the deployment (../app/firebase-credential-source-guard.bicep) instead of deploying an empty credential.
using 'main.bicep'

param environmentName = 'dev'

// Every 5 minutes on Dev (cost review 2026-10-14: every-minute executions were a large share of Dev cost). Push is normally sent by the
// notification worker (Service Bus); this Job is the recovery path, so up to 5 minutes of recovery delay is accepted on Dev. Production
// does not set cronExpression in prod.bicepparam and keeps the template default (every minute).
param cronExpression = '*/5 * * * *'

param acrLoginServer = readEnvironmentVariable('JUPLE_APP_ACR_LOGIN_SERVER')
param containerAppsEnvironmentId = readEnvironmentVariable('JUPLE_APP_CONTAINER_APPS_ENVIRONMENT_ID')
param managedIdentityResourceId = readEnvironmentVariable('JUPLE_APP_MANAGED_IDENTITY_RESOURCE_ID')
// Exactly one of the two (main.bicep's image-reference guard); leave the other variable unset.
param imageTag = readEnvironmentVariable('JUPLE_APP_IMAGE_TAG', '')
param imageDigest = readEnvironmentVariable('JUPLE_APP_IMAGE_DIGEST', '')
param sqlConnectionString = readEnvironmentVariable('JUPLE_APP_SQL_CONNECTION_STRING')
