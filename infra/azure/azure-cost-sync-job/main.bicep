// Dedicated cost collection only. No role assignments, secrets, SQL schema or other Jobs are created here.
targetScope = 'resourceGroup'

@allowed(['prod'])
param environmentName string = 'prod'
param location string = 'koreacentral'
param acrLoginServer string
param containerAppsEnvironmentId string
param managedIdentityResourceId string
param managedIdentityClientId string

@description('Dedicated verified cost Job digest; never reuse the API deployment digest variable or a floating tag.')
@minLength(71)
@maxLength(71)
param imageDigest string

@description('Existing Key Vault URI, not a credential. No plaintext connection string parameter is accepted.')
param keyVaultUri string
param sqlConnectionStringSecretName string = 'sql-runtime-connection-string'

@description('Must match the deployed Program.cs allowlist. Subscription-wide collection is never enabled.')
@allowed(['/subscriptions/37402353-9fc3-4fd7-bc9a-d5d2197b6b6b/resourceGroups/rg-juple-prod'])
param costScope string

param expensesEnabled bool = true
param azureSyncEnabled bool = true
@allowed(['Schedule', 'Manual'])
param triggerType string = 'Schedule'
param cronExpression string = '10 2 * * *'
@minValue(1)
@maxValue(1200)
param replicaTimeoutSeconds int = 1200
@allowed([0])
param replicaRetryLimit int = 0

@description('Provenance of the source archive used for the pinned operating image, not a master source hash.')
param sourceArchiveSha256 string

resource costSyncJob 'Microsoft.App/jobs@2024-03-01' = {
  name: 'caj-juple-azure-cost-sync-${environmentName}'
  location: location
  tags: {
    environment: environmentName
    project: 'juple'
    purpose: 'daily-azure-cost-sync'
    sourceArchiveSha256: sourceArchiveSha256
  }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentityResourceId}': {}
    }
  }
  properties: {
    environmentId: containerAppsEnvironmentId
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: triggerType
      replicaTimeout: replicaTimeoutSeconds
      replicaRetryLimit: replicaRetryLimit
      scheduleTriggerConfig: triggerType == 'Schedule' ? {
        cronExpression: cronExpression
        parallelism: 1
        replicaCompletionCount: 1
      } : null
      manualTriggerConfig: triggerType == 'Manual' ? {
        parallelism: 1
        replicaCompletionCount: 1
      } : null
      registries: [{ server: acrLoginServer, identity: managedIdentityResourceId }]
      secrets: [{
        name: 'sql-connection-string'
        keyVaultUrl: '${keyVaultUri}secrets/${sqlConnectionStringSecretName}'
        identity: managedIdentityResourceId
      }]
    }
    template: {
      containers: [{
        name: 'azure-cost-sync'
        image: '${acrLoginServer}/juple-api@${imageDigest}'
        // Inherits the image's ENTRYPOINT ["dotnet", "Juple.Api.dll"]. No command override.
        args: ['--run-azure-cost-sync']
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        env: [
          { name: 'ASPNETCORE_ENVIRONMENT', value: 'Production' }
          { name: 'AZURE_CLIENT_ID', value: managedIdentityClientId }
          { name: 'ConnectionStrings__JupleDatabase', secretRef: 'sql-connection-string' }
          { name: 'Expenses__Enabled', value: string(expensesEnabled) }
          { name: 'Expenses__AzureSyncEnabled', value: string(azureSyncEnabled) }
          { name: 'Expenses__AzureScopes__0__Scope', value: costScope }
          { name: 'Expenses__AzureScopes__0__Environment', value: 'PROD' }
          { name: 'Expenses__AzureScopes__0__AllowWholeSubscription', value: 'false' }
          { name: 'Logging__LogLevel__Default', value: 'Warning' }
          { name: 'Logging__LogLevel__Microsoft', value: 'Warning' }
        ]
      }]
    }
  }
}

output jobResourceId string = costSyncJob.id
