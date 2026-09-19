// Instagram metadata retry scheduled Job - resource group scope. Deployed after Foundation
// (../foundation) and after an image has been pushed to the ACR Foundation created, same as
// ../app/main.bicep, ../job/main.bicep, and ../blob-cleanup-job/main.bicep - this file references
// Foundation/App resources purely through parameters, never re-declaring or re-discovering them.
//
// See InstagramMetadataRetryService/InstagramMetadataRetryTask's own remarks for why this Job
// exists: the Mobile app's own synchronous best-effort metadata resolution (right after an Item is
// saved) is allowed to come back empty for a public Instagram URL - confirmed across several
// rounds of real-device investigation to be genuinely transient, Instagram-side behavior (the exact
// same URL fails at one moment and returns full metadata minutes later), not a defect in this
// codebase's own request construction. This Job is what gives an affected Item up to two more
// backend-side tries on a schedule, without ever blocking or retrying the original save itself.
// This is a SEPARATE resource from ../job/main.bicep and ../blob-cleanup-job/main.bicep on purpose -
// three Jobs with unrelated lifecycles and disjoint configuration (this one never touches Blob
// Storage or Firebase).
targetScope = 'resourceGroup'

@description('Short environment name - must match the Foundation/App deployment this is layered on top of.')
param environmentName string = 'dev'

param location string = 'koreacentral'

@description('ACR login server - Foundation output "acrLoginServer".')
param acrLoginServer string

@description('Repository name within the ACR - must match ../app/main.bicep\'s imageRepository (same image, reused as-is - no separate worker image, and the Dockerfile ENTRYPOINT is never overridden here, only its args).')
param imageRepository string = 'juple-api'

@description('Image tag to deploy. No default on purpose, same reasoning as the other Job templates - the deployer picks an explicit, already-pushed tag every time. Should normally match whatever tag the Container App (../app/main.bicep) is running, so this Job retries metadata against the same code that owns the InstagramMetadataRetryTask table schema.')
param imageTag string

@description('Container Apps Environment resource ID - Foundation output "containerAppsEnvironmentId". Same Environment as the API Container App and the other scheduled Jobs.')
param containerAppsEnvironmentId string

@description('User Assigned Managed Identity resource ID - Foundation output "managedIdentityResourceId". Used only for ACR pull here - this Job never talks to Blob Storage or Firebase, only outbound HTTPS (SQL + the same Instagram metadata fetch the API Container App already performs), so it needs no AZURE_CLIENT_ID/DefaultAzureCredential.')
param managedIdentityResourceId string

@description('Full ASP.NET Core SQL connection string, credentials included - same value/shape as the other Job templates\' own sqlConnectionString parameter, supplied separately here because this Job has its own independent secret namespace. Never put a real value in a checked-in parameter file.')
@secure()
param sqlConnectionString string

@description('UTC cron expression - Container Apps Job schedules are always UTC, never local/server time (same convention as the other Job templates). Default: every minute - InstagramMetadataRetryService schedules its first and second backend attempts roughly 1 and 5 minutes after an Item is saved (see FirstAttemptDelay/SecondAttemptDelay), so this needs finer granularity than the 5-minute Blob cleanup Job to actually land attempts close to when they become due.')
param cronExpression string = '* * * * *'

@description('Wall-clock ceiling for one Job execution. Kept well under the 1-minute schedule interval so a slow execution cannot still be running when the next one is due - correctness against overlap does not depend on this either way (InstagramMetadataRetryStore.TryClaimAsync already makes double-processing the same task impossible), but there is no reason to invite it routinely.')
param replicaTimeoutSeconds int = 45

@description('Kept at 0, same reasoning as ../blob-cleanup-job/main.bicep: the next scheduled execution, one minute away at most, already serves as the retry for a whole-container failure, and the per-task failure handling inside InstagramMetadataRetryService (RecordFailedAttemptAsync/MarkExhaustedAsync) already covers a single task failing without blocking the rest of that same run.')
param replicaRetryLimit int = 0

@description('Smallest Consumption-plan cpu/memory pairing, same as the other Job templates - a Dev-scale number of due retry tasks per minute needs nothing larger.')
param containerCpu string = '0.25'
param containerMemory string = '0.5Gi'

// Shortened from the natural "caj-juple-instagram-metadata-retry-{env}" (39 chars for "dev") -
// Container Apps Job names are capped at 32 characters.
var jobName = 'caj-juple-ig-metadata-retry-${environmentName}'
var containerImage = '${acrLoginServer}/${imageRepository}:${imageTag}'

resource instagramMetadataRetryJob 'Microsoft.App/jobs@2024-03-01' = {
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
        // One replica per execution, and exactly one completion required - a retry pass is a
        // single sequential loop over due tasks (see InstagramMetadataRetryService.RunOnceAsync),
        // not a fan-out workload.
        cronExpression: cronExpression
        parallelism: 1
        replicaCompletionCount: 1
      }
      // ACR pull via the Managed Identity's AcrPull role (granted in ../foundation/resources.bicep,
      // shared with the API Container App and the other Jobs) - no username/password secret.
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
          name: 'juple-instagram-metadata-retry'
          image: containerImage
          // Dockerfile's ENTRYPOINT ["dotnet", "Juple.Api.dll"] is left untouched (no `command`
          // override) - this only appends the one argument that switches Program.cs into its
          // one-shot Instagram metadata retry branch, which returns before UseAuthentication/
          // MapControllers/app.Run() ever execute, so this Job never opens an HTTP port or runs as
          // a server.
          args: [
            '--run-instagram-metadata-retry'
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
          ]
        }
      ]
    }
  }
}

output jobName string = instagramMetadataRetryJob.name
