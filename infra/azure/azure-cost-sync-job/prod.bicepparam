// Reviewed non-secret PROD identifiers and immutable image. No local environment/Secret values required to compile.
using 'main.bicep'

param environmentName = 'prod'
param location = 'koreacentral'
param acrLoginServer = 'acrjupleprody5v2isrk3zbwu.azurecr.io'
param containerAppsEnvironmentId = '/subscriptions/37402353-9fc3-4fd7-bc9a-d5d2197b6b6b/resourceGroups/rg-juple-prod/providers/Microsoft.App/managedEnvironments/cae-juple-prod'
param managedIdentityResourceId = '/subscriptions/37402353-9fc3-4fd7-bc9a-d5d2197b6b6b/resourcegroups/rg-juple-prod/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-juple-prod'
param managedIdentityClientId = 'aa1e7146-09da-4055-b890-3e85e9a5f914'
param keyVaultUri = 'https://kv-juple-prod-y5v2isrk3z.vault.azure.net/'
param sqlConnectionStringSecretName = 'sql-runtime-connection-string'
param costScope = '/subscriptions/37402353-9fc3-4fd7-bc9a-d5d2197b6b6b/resourceGroups/rg-juple-prod'
param imageDigest = 'sha256:0f42c0d3fe353a9ad73f0522ee7e491e74b1327057ffb0e4bd48b3f2d596897c'
param sourceArchiveSha256 = 'd3ddb947a8e53dc635d9a9dbb1cb674415027d15812f4eb8d4853498de605c34'
param expensesEnabled = true
param azureSyncEnabled = true
param triggerType = 'Schedule'
param cronExpression = '10 2 * * *' // UTC 02:10 = Asia/Seoul 11:10, daily.
param replicaTimeoutSeconds = 1200
param replicaRetryLimit = 0
