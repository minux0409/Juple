// Account deletion Blob cleanup scheduled Job - resource group scope. Deployed after Foundation
// (../foundation) and after an image has been pushed to the ACR Foundation created, same as
// ../app/main.bicep and ../job/main.bicep - this file references Foundation/App resources purely
// through parameters, never re-declaring or re-discovering them.
//
// This is a SEPARATE resource from ../job/main.bicep (the Push dispatch Job) on purpose - the two
// Jobs have unrelated lifecycles and completely disjoint configuration (this one never touches
// Firebase; that one never touches Blob Storage). Bundling them into one all-or-nothing deployment
// would only couple two independent operational concerns together for no benefit. See
// IBlobCleanupService/AccountDeletionBlobCleanup's own remarks for why this Job exists at all: it
// is not a failure-only safety net - every account deletion (including the normal, fully successful
// path) leaves its Blob cleanup task pending until a LATER run confirms the Blob prefix is clean a
// second time, at or after a 10-minute grace period (see BlobCleanupService.GracePeriod). Until this
// Job is actually deployed and running on schedule, that confirming sweep never happens for anyone -
// see ../README.md's "Blob cleanup scheduled Job" section for why this makes the Job a hard release
// blocker for the account deletion feature, not an optional extra.
targetScope = 'resourceGroup'

@description('Short environment name - must match the Foundation/App deployment this is layered on top of.')
param environmentName string = 'dev'

param location string = 'koreacentral'

@description('ACR login server - Foundation output "acrLoginServer".')
param acrLoginServer string

@description('Repository name within the ACR - must match ../app/main.bicep\'s imageRepository (same image, reused as-is - no separate worker image, and the Dockerfile ENTRYPOINT is never overridden here, only its args).')
param imageRepository string = 'juple-api'

@description('Image tag to deploy. No default on purpose, same reasoning as ../app/main.bicep and ../job/main.bicep - the deployer picks an explicit, already-pushed tag every time. Should normally match whatever tag the Container App (../app/main.bicep) is running, so this Job cleans up Blobs against the same code that owns the AccountDeletionBlobCleanup table schema.')
param imageTag string

@description('Container Apps Environment resource ID - Foundation output "containerAppsEnvironmentId". Same Environment as the API Container App and the Push dispatch Job - this is a second scheduled Job, not a second Environment.')
param containerAppsEnvironmentId string

@description('User Assigned Managed Identity resource ID - Foundation output "managedIdentityResourceId". Reused as-is for both ACR pull (existing AcrPull role assignment in ../foundation/resources.bicep) and Blob Storage access (existing Storage Blob Data Contributor role assignment, same Managed Identity ../app/main.bicep already uses for the same purpose) - no new role assignment of any kind is created by this template.')
param managedIdentityResourceId string

@description('User Assigned Managed Identity client ID - Foundation output "managedIdentityClientId". Not a secret (an identifier, not a credential) - passed through as AZURE_CLIENT_ID so this container\'s DefaultAzureCredential() (see BlobServiceClientFactory.cs, unchanged from the API\'s own Blob access path) resolves this specific identity. Same value ../app/main.bicep passes for the same reason.')
param managedIdentityClientId string

@description('Full ASP.NET Core SQL connection string, credentials included - same value/shape as ../app/main.bicep and ../job/main.bicep\'s own sqlConnectionString parameter, supplied separately here because this Job has its own independent secret namespace (a Container Apps Job is a distinct resource, not a shared config scope). Never put a real value in a checked-in parameter file.')
@secure()
param sqlConnectionString string

@description('Blob service endpoint URI - Foundation output "storageBlobServiceUri". No Storage Account key or connection string is ever used; this Job authenticates the same way the API Container App does, via managedIdentityResourceId + DefaultAzureCredential.')
param storageBlobServiceUri string

@description('Must match the API Container App\'s own blobContainerName (../app/main.bicep) - the same container both write to/clean up.')
param blobContainerName string = 'item-images'

@description('UTC cron expression - Container Apps Job schedules are always UTC, never local/server time (same convention as ../job/main.bicep). Default: every 5 minutes. This is NOT a mathematical requirement of the 10-minute grace period in BlobCleanupService (a longer interval would still eventually run the confirming sweep) - 5 minutes is chosen to keep orphan-Blob and cleanup-task residency time low and to keep operational visibility (how long a stuck task can go unnoticed) tight.')
param cronExpression string = '*/5 * * * *'

@description('Wall-clock ceiling for one Job execution. Kept comfortably under the 5-minute schedule interval so a slow execution cannot still be running when the next one is due - BlobCleanupService/AccountDeletionBlobCleanupStore already treat a re-run over the same pending tasks as safe (DeleteBlobsByPrefixAsync is idempotent via DeleteIfExistsAsync, and every store mutation no-ops on an already-gone row - see those types\' own remarks), so an occasional overlap would not corrupt anything, but there is no reason to invite it routinely.')
param replicaTimeoutSeconds int = 240

@description('Kept at 0, unlike ../job/main.bicep\'s Push dispatch Job (which uses 1): the next scheduled execution, five minutes away at most, already serves as the retry for a whole-container failure here, and BlobCleanupService\'s own per-task failure handling (RecordFailedAttemptAsync, leaving the task pending) already covers a single cleanup task failing without blocking the rest of that same run. An immediate whole-Job retry on top of that would mostly just risk overlapping the next scheduled run for no correctness benefit.')
param replicaRetryLimit int = 0

@description('Smallest Consumption-plan cpu/memory pairing, same as ../app/main.bicep and ../job/main.bicep - listing/deleting a Dev-scale number of Blobs under a handful of pending prefixes needs nothing larger.')
param containerCpu string = '0.25'
param containerMemory string = '0.5Gi'

var jobName = 'caj-juple-blob-cleanup-${environmentName}'
var containerImage = '${acrLoginServer}/${imageRepository}:${imageTag}'

resource blobCleanupJob 'Microsoft.App/jobs@2024-03-01' = {
  name: jobName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentityResourceId}': {}
    }
  }
  properties: {
    environmentId: containerAppsEnvironmentId
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: replicaTimeoutSeconds
      replicaRetryLimit: replicaRetryLimit
      scheduleTriggerConfig: {
        // One replica per execution, and exactly one completion required - a cleanup pass is a
        // single sequential loop over pending tasks (see BlobCleanupService.RunPendingCleanupsAsync),
        // not a fan-out workload. Correctness against two executions overlapping in time does not
        // depend on this setting either way - see replicaTimeoutSeconds's own remarks.
        cronExpression: cronExpression
        parallelism: 1
        replicaCompletionCount: 1
      }
      // ACR pull via the Managed Identity's AcrPull role (granted in ../foundation/resources.bicep,
      // shared with the API Container App and the Push dispatch Job) - no username/password secret.
      registries: [
        {
          server: acrLoginServer
          identity: managedIdentityResourceId
        }
      ]
      secrets: [
        {
          name: 'sql-connection-string'
          value: sqlConnectionString
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'juple-blob-cleanup'
          image: containerImage
          // Dockerfile's ENTRYPOINT ["dotnet", "Juple.Api.dll"] is left untouched (no `command`
          // override) - this only appends the one argument that switches Program.cs into its
          // one-shot Blob cleanup retry branch, which returns before UseAuthentication/
          // MapControllers/app.Run() ever execute, so this Job never opens an HTTP port or runs as
          // a server.
          args: [
            '--run-blob-cleanup-retry'
          ]
          resources: {
            cpu: json(containerCpu)
            memory: containerMemory
          }
          env: [
            {
              name: 'ConnectionStrings__JupleDatabase'
              secretRef: 'sql-connection-string'
            }
            {
              // Deliberately no ConnectionStrings__BlobStorage - its absence is what makes
              // BlobServiceClientFactory.cs fall through to the ServiceUri + DefaultAzureCredential
              // (Managed Identity) path instead of a Shared Key connection string. No Storage
              // Account key or SAS write credential is ever configured for this Job.
              name: 'BlobStorage__ServiceUri'
              value: storageBlobServiceUri
            }
            {
              name: 'BlobStorage__ContainerName'
              value: blobContainerName
            }
            {
              // Not a secret - a public identifier, same as ../app/main.bicep's own use of it.
              name: 'AZURE_CLIENT_ID'
              value: managedIdentityClientId
            }
          ]
        }
      ]
    }
  }
}

output jobName string = blobCleanupJob.name
