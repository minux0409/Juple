// Push dispatch scheduled Job - resource group scope. Deployed after Foundation (../foundation)
// and after an image has been pushed to the ACR Foundation created, same as ../app/main.bicep -
// this file references Foundation/App resources purely through parameters, never re-declaring or
// re-discovering them.
//
// This Job reuses the exact same Backend image as ../app/main.bicep's Container App (one image,
// two very different entrypoints via `args`) - see docs/architecture.md's "Push 알림 전송" section
// on why a scheduled Job rather than an in-API BackgroundService: the API Container App scales to
// zero, so nothing would ever be running to host a background timer.
targetScope = 'resourceGroup'

@description('Short environment name - must match the Foundation/App deployment this is layered on top of.')
param environmentName string = 'dev'

param location string = 'koreacentral'

@description('ACR login server - Foundation output "acrLoginServer".')
param acrLoginServer string

@description('Repository name within the ACR - must match ../app/main.bicep\'s imageRepository (same image, reused as-is).')
param imageRepository string = 'juple-api'

@description('Image tag to deploy. No default on purpose, same reasoning as ../app/main.bicep - the deployer picks an explicit, already-pushed tag every time. Should normally match whatever tag the Container App (../app/main.bicep) is running, so the Job dispatches against the same code the API validates Notifications/RepeatPurchases with.')
param imageTag string

@description('Container Apps Environment resource ID - Foundation output "containerAppsEnvironmentId". Same Environment as the API Container App - this is a scheduled Job, not a second always-on app, so it does not need its own Environment.')
param containerAppsEnvironmentId string

@description('User Assigned Managed Identity resource ID - Foundation output "managedIdentityResourceId". Used only for ACR pull here - unlike ../app/main.bicep\'s Container App, this Job never talks to Blob Storage (Push dispatch never touches Item images), so it does not need AZURE_CLIENT_ID/DefaultAzureCredential at all.')
param managedIdentityResourceId string

@description('Full ASP.NET Core SQL connection string, credentials included - same value/shape as ../app/main.bicep\'s sqlConnectionString parameter, supplied separately here because this Job has its own independent secret namespace (a Container Apps Job is a distinct resource from the Container App, not a shared config scope). Never put a real value in a checked-in parameter file.')
@secure()
param sqlConnectionString string

@description('Firebase service-account credential JSON (FCM v1 - see FirebaseCloudMessagingSender) for this Job\'s IPushSender. Deliberately never supplied to the API Container App (../app/main.bicep has no equivalent parameter) - the API never sends Push itself, only this Job does, so only this Job needs it. Never put a real value in a checked-in parameter file.')
@secure()
param firebaseServiceAccountKeyJson string

@description('UTC cron expression - Container Apps Job schedules are always UTC, never local/server time (matches this project\'s own DateTimeOffset/UTC-storage convention). Default: top of every hour.')
param cronExpression string = '0 * * * *'

@description('Wall-clock ceiling for one Job execution. Chosen well under NotificationDeliveryStore\'s 15-minute stale-lease timeout (900s) and comfortably above FirebaseCloudMessagingSender\'s single-send 20s timeout - even a run that hits this ceiling mid-send leaves that one delivery reclaimable by the next hourly execution long before the next-but-one run, never stuck.')
param replicaTimeoutSeconds int = 600

@description('Azure retries the whole execution this many additional times on outright container failure (crash, failed to start) - not a per-delivery retry (that is NotificationDeliveryStore\'s own claim/lease mechanism, wholly separate and already exercised by the hourly schedule itself). Kept at 1 since the hourly cadence already provides a natural retry cadence for anything transient.')
param replicaRetryLimit int = 1

@description('Smallest Consumption-plan cpu/memory pairing, same as ../app/main.bicep - a one-shot dispatch pass over a Dev-scale RepeatPurchase table needs nothing larger.')
param containerCpu string = '0.25'
param containerMemory string = '0.5Gi'

var jobName = 'caj-juple-push-dispatch-${environmentName}'
var containerImage = '${acrLoginServer}/${imageRepository}:${imageTag}'

resource pushDispatchJob 'Microsoft.App/jobs@2024-03-01' = {
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
        cronExpression: cronExpression
        // One replica per execution, and exactly one completion required - a dispatch pass is a
        // single sequential loop over candidate users (see DispatchDuePushNotificationsService),
        // not a fan-out workload. This bounds waste within one execution; correctness against two
        // executions overlapping in time is NotificationDeliveryStore.TryClaimAsync's job, not
        // this setting's (see that store's own remarks on why GetPendingAsync is a candidate list,
        // not a claim).
        parallelism: 1
        replicaCompletionCount: 1
      }
      // ACR pull via the Managed Identity's AcrPull role (granted in ../foundation/resources.bicep,
      // shared with the API Container App) - no username/password secret of any kind.
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
        {
          name: 'firebase-credential'
          value: firebaseServiceAccountKeyJson
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'juple-push-dispatch'
          image: containerImage
          // Dockerfile's ENTRYPOINT ["dotnet", "Juple.Api.dll"] is left untouched (no `command`
          // override) - this only appends the one argument that switches Program.cs into its
          // one-shot dispatch branch, which returns before UseAuthentication/MapControllers/
          // app.Run() ever execute, so this Job never opens an HTTP port or runs as a server.
          args: [
            '--run-push-dispatch'
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
              name: 'Firebase__ServiceAccountKeyJson'
              secretRef: 'firebase-credential'
            }
          ]
        }
      ]
    }
  }
}

output jobName string = pushDispatchJob.name
