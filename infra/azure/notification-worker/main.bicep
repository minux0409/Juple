// Notification worker Container App - resource group scope. Deployed after Foundation (../foundation,
// which creates the Service Bus namespace, its two queues and the identity's queue roles) and after
// the same Backend image the API runs has been pushed (one image, three entrypoints: the API, the
// push-dispatch Job's --run-push-dispatch, and this app's --run-notification-worker).
//
// What it does: consumes notification-events (materializes each outbox event's recipients, page by
// page) and push-deliveries (sends Push in bounded batches) - see NotificationEventProcessor and
// PushDeliveryProcessor. It is the fast path only: the push-dispatch Job (../job) stays the recovery
// sweep, so this app being scaled to zero, down or broken delays Push but loses none.
//
// Scaling: KEDA's azure-servicebus rule on each queue's message count, authenticated with the
// worker's own Managed Identity (no connection string). minReplicas is THE latency/cost dial:
//   0 - nothing runs while idle (cheapest); the first message after idle waits for KEDA to notice it
//       (up to pollingIntervalSeconds) plus a cold start (container pull/start, typically tens of
//       seconds) - still no one-minute schedule wait.
//   1 - one replica always warm (an always-on cost); a Push starts within about a second.
// Event-driven is not instantaneous: from zero, KEDA only polls the queues every pollingIntervalSeconds.
targetScope = 'resourceGroup'

@description('Short environment name - must match the Foundation/App deployment this is layered on top of.')
param environmentName string = 'dev'

param location string = 'koreacentral'

@description('ACR login server - Foundation output "acrLoginServer".')
param acrLoginServer string

@description('Repository name within the ACR - the same image as ../app/main.bicep.')
param imageRepository string = 'juple-api'

@description('Image tag to deploy. No default on purpose (same as ../app/main.bicep). Should match the API\'s tag, so both record and process events with the same code.')
param imageTag string

@description('Container Apps Environment resource ID - Foundation output "containerAppsEnvironmentId".')
param containerAppsEnvironmentId string

@description('The worker\'s own User Assigned Managed Identity resource ID - Foundation output "notificationWorkerIdentityResourceId" (never the API\'s). ACR pull, Service Bus (Receiver on notification-events, Sender + Receiver on push-deliveries) and the KEDA scale rules all use it.')
param notificationWorkerIdentityResourceId string

@description('Its client ID - Foundation output "notificationWorkerIdentityClientId". Not a secret; passed as AZURE_CLIENT_ID so DefaultAzureCredential picks this identity for Service Bus.')
param notificationWorkerIdentityClientId string

@description('Service Bus namespace name - Foundation output "serviceBusNamespaceName" (the KEDA rules take the name, the app the FQDN).')
param serviceBusNamespaceName string

@description('Full ASP.NET Core SQL connection string, credentials included - same value/shape as ../app/main.bicep\'s. Never put a real value in a checked-in parameter file.')
@secure()
param sqlConnectionString string

@description('Firebase service-account credential JSON (FCM v1) - the same secret the push-dispatch Job holds; the API never has it. Never put a real value in a checked-in parameter file.')
@secure()
param firebaseServiceAccountKeyJson string

@description('Replicas kept running while idle - the latency/cost dial (see the header). Dev defaults to 0 (cost); Production should normally run 1.')
@minValue(0)
param minReplicas int = 0

@description('Upper bound on replicas under a burst (each replica processes EventsMaxConcurrentCalls + DeliveriesMaxConcurrentCalls messages at once).')
@minValue(1)
param maxReplicas int = 3

@description('KEDA target: messages waiting per replica before another replica is added.')
param messagesPerReplica int = 50

@description('How often KEDA checks the queues (seconds). Matters most at minReplicas 0, where it bounds how long a first message waits before a replica starts; with a warm replica it only paces scale-out. Not 1s - every poll is a Service Bus management call.')
@minValue(5)
param pollingIntervalSeconds int = 15

@description('How long the queues must stay empty before scaling back down to minReplicas (seconds) - avoids scaling to zero between the messages of one burst.')
@minValue(60)
param cooldownPeriodSeconds int = 300

@description('Per-replica concurrency (see NotificationPipelineOptions).')
param eventsMaxConcurrentCalls int = 4
param deliveriesMaxConcurrentCalls int = 4
param maxConcurrentSends int = 8

param containerCpu string = '0.25'
param containerMemory string = '0.5Gi'

@description('Application Insights connection string (../monitoring/main.bicep output "applicationInsightsConnectionString"). Empty (default) = not wired. The backend has no Application Insights / OpenTelemetry SDK yet, so this only sets APPLICATIONINSIGHTS_CONNECTION_STRING and is inert until instrumentation is added.')
param applicationInsightsConnectionString string = ''

var observabilityEnv = empty(applicationInsightsConnectionString)
  ? []
  : [
      {
        name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
        value: applicationInsightsConnectionString
      }
    ]

var containerAppName = 'ca-juple-notify-worker-${environmentName}'
var containerImage = '${acrLoginServer}/${imageRepository}:${imageTag}'
var serviceBusNamespaceFqdn = '${serviceBusNamespaceName}.servicebus.windows.net'
var notificationEventsQueueName = 'notification-events'
var pushDeliveriesQueueName = 'push-deliveries'

resource notificationWorker 'Microsoft.App/containerApps@2025-01-01' = {
  name: containerAppName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${notificationWorkerIdentityResourceId}': {}
    }
  }
  properties: {
    environmentId: containerAppsEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      // No ingress: nothing calls the worker; it only pulls from Service Bus. /health is for the
      // container's own probes.
      registries: [
        {
          server: acrLoginServer
          identity: notificationWorkerIdentityResourceId
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
          name: 'juple-notification-worker'
          image: containerImage
          // Dockerfile's ENTRYPOINT is kept; this switches Program.cs into the worker mode, which
          // runs no controllers and authenticates no request.
          args: [
            '--run-notification-worker'
          ]
          resources: {
            cpu: json(containerCpu)
            memory: containerMemory
          }
          env: concat([
            {
              name: 'ConnectionStrings__JupleDatabase'
              secretRef: 'sql-connection-string'
            }
            {
              name: 'Firebase__ServiceAccountKeyJson'
              secretRef: 'firebase-credential'
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: notificationWorkerIdentityClientId
            }
            {
              name: 'NotificationPipeline__ServiceBusNamespace'
              value: serviceBusNamespaceFqdn
            }
            {
              name: 'NotificationPipeline__EventsMaxConcurrentCalls'
              value: string(eventsMaxConcurrentCalls)
            }
            {
              name: 'NotificationPipeline__DeliveriesMaxConcurrentCalls'
              value: string(deliveriesMaxConcurrentCalls)
            }
            {
              name: 'NotificationPipeline__MaxConcurrentSends'
              value: string(maxConcurrentSends)
            }
          ], observabilityEnv)
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 8080
              }
              initialDelaySeconds: 10
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        pollingInterval: pollingIntervalSeconds
        cooldownPeriod: cooldownPeriodSeconds
        rules: [
          {
            name: 'notification-events'
            custom: {
              type: 'azure-servicebus'
              metadata: {
                namespace: serviceBusNamespaceName
                queueName: notificationEventsQueueName
                messageCount: string(messagesPerReplica)
              }
              identity: notificationWorkerIdentityResourceId
            }
          }
          {
            name: 'push-deliveries'
            custom: {
              type: 'azure-servicebus'
              metadata: {
                namespace: serviceBusNamespaceName
                queueName: pushDeliveriesQueueName
                messageCount: string(messagesPerReplica)
              }
              identity: notificationWorkerIdentityResourceId
            }
          }
        ]
      }
    }
  }
}

output containerAppName string = notificationWorker.name
