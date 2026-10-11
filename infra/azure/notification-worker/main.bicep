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

@description('Image tag to deploy. Empty only when imageDigest is used - the template never picks an image on its own (same as ../app/main.bicep). Should match the API\'s tag, so both record and process events with the same code.')
param imageTag string = ''

@description('Immutable image digest ("sha256:" + 64 hex characters) to deploy instead of a tag - Production pins the exact image the API runs, so a re-pushed tag can never change what runs. When set it wins over imageTag and the reference becomes {acrLoginServer}/{imageRepository}@{imageDigest}. Empty = use imageTag (Dev).')
param imageDigest string = ''

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
param sqlConnectionString string = ''

@description('Where the SQL runtime connection string comes from. false (default - Dev): the @secure() sqlConnectionString parameter carries the VALUE into a Container Apps secret. true (Production): a Key Vault reference to the secret named by sqlConnectionStringSecretName, resolved at runtime through this workload\'s own managed identity - the deployer never reads or passes a connection string, and a supplied one is refused by ../app/sql-connection-source-guard.bicep rather than silently ignored. Requires the Key Vault URI. The vault secret holds the RUNTIME principal\'s connection string, never the administrator\'s.')
param sqlConnectionStringFromKeyVault bool = false

@description('Key Vault secret NAME (never a value) of the runtime connection string - used only when sqlConnectionStringFromKeyVault. The Container Apps secret keeps its own name, sql-connection-string, so the env secretRef is unchanged.')
param sqlConnectionStringSecretName string = 'sql-runtime-connection-string'

@description('Key Vault URI with trailing slash - the Production vault\'s "keyVaultUri" (../foundation/billing.bicep output). Needed only when sqlConnectionStringFromKeyVault.')
param keyVaultUri string = ''

@description('Firebase service-account credential JSON (FCM v1) - the same secret the push-dispatch Job holds; the API never has it. Never put a real value in a checked-in parameter file.')
@secure()
param firebaseServiceAccountKeyJson string = ''

@description('Where the Firebase credential comes from. false (default - Dev): the @secure() firebaseServiceAccountKeyJson parameter carries the VALUE into a Container Apps secret. true (Production): a Key Vault reference to the secret named by firebaseCredentialSecretName, resolved at runtime through this worker\'s own managed identity - the deployer never reads or passes the credential, and a supplied one is refused by ../app/firebase-credential-source-guard.bicep. Requires the Key Vault URI and a secret-scoped reader role for the worker identity (../foundation/key-vault-secret-reader.bicep).')
param firebaseCredentialFromKeyVault bool = false

@description('Key Vault secret NAME (never a value) of the Firebase service-account JSON - used only when firebaseCredentialFromKeyVault. The Container Apps secret keeps its own name, firebase-credential, so the env secretRef is unchanged.')
param firebaseCredentialSecretName string = 'firebase-service-account-key-json'

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
var containerImage = empty(imageDigest)
  ? '${acrLoginServer}/${imageRepository}:${imageTag}'
  : '${acrLoginServer}/${imageRepository}@${imageDigest}'

// Fail-closed image reference, shared with the API template (see ../app/image-reference-guard.bicep): an image must
// be named (no floating-tag fallback) and a digest must have the exact length of a sha256 reference.
module imageReferenceGuard '../app/image-reference-guard.bicep' = {
  name: 'juple-${environmentName}-notification-worker-image-reference-guard'
  params: {
    #disable-next-line BCP329
    imageReferenceSupplied: (empty(imageTag) ? 0 : 1) + (empty(imageDigest) ? 0 : 1)
    imageDigestLength: length(imageDigest)
  }
}

var serviceBusNamespaceFqdn = '${serviceBusNamespaceName}.servicebus.windows.net'
var notificationEventsQueueName = 'notification-events'
var pushDeliveriesQueueName = 'push-deliveries'

// The SQL connection string secret: a Key Vault reference (vault mode) or the supplied value (parameter mode).
// Same secret name in both modes, so the env secretRef below never changes.
var sqlConnectionStringSecret = sqlConnectionStringFromKeyVault
  ? {
      name: 'sql-connection-string'
      keyVaultUrl: '${keyVaultUri}secrets/${sqlConnectionStringSecretName}'
      identity: notificationWorkerIdentityResourceId
    }
  : {
      name: 'sql-connection-string'
      value: sqlConnectionString
    }

// Fail-closed connection string source (see ../app/sql-connection-source-guard.bicep): vault mode needs the vault
// URI and must not also receive a value; parameter mode needs the value. Only 0/1 flags reach the guard.
module sqlConnectionSourceVaultGuard '../app/sql-connection-source-guard.bicep' = if (sqlConnectionStringFromKeyVault) {
  name: 'juple-${environmentName}-notification-worker-sql-source-vault-guard'
  params: {
    #disable-next-line BCP329
    keyVaultUriProvided: empty(keyVaultUri) ? 0 : 1
    #disable-next-line BCP330
    plaintextConnectionStringSupplied: empty(sqlConnectionString) ? 0 : 1
  }
}

module sqlConnectionSourceParameterGuard '../app/sql-connection-source-guard.bicep' = if (!sqlConnectionStringFromKeyVault) {
  name: 'juple-${environmentName}-notification-worker-sql-source-parameter-guard'
  params: {
    #disable-next-line BCP329
    connectionStringSupplied: empty(sqlConnectionString) ? 0 : 1
  }
}

// The Firebase credential secret: a Key Vault reference (vault mode) or the supplied value (parameter mode).
// Same secret name in both modes, so the env secretRef below never changes.
var firebaseCredentialSecret = firebaseCredentialFromKeyVault
  ? {
      name: 'firebase-credential'
      keyVaultUrl: '${keyVaultUri}secrets/${firebaseCredentialSecretName}'
      identity: notificationWorkerIdentityResourceId
    }
  : {
      name: 'firebase-credential'
      value: firebaseServiceAccountKeyJson
    }

// Fail-closed credential source (see ../app/firebase-credential-source-guard.bicep). Only 0/1 flags reach it.
module firebaseCredentialSourceVaultGuard '../app/firebase-credential-source-guard.bicep' = if (firebaseCredentialFromKeyVault) {
  name: 'juple-${environmentName}-notification-worker-firebase-source-vault-guard'
  params: {
    #disable-next-line BCP329
    keyVaultUriProvided: empty(keyVaultUri) ? 0 : 1
    #disable-next-line BCP330
    plaintextCredentialSupplied: empty(firebaseServiceAccountKeyJson) ? 0 : 1
  }
}

module firebaseCredentialSourceParameterGuard '../app/firebase-credential-source-guard.bicep' = if (!firebaseCredentialFromKeyVault) {
  name: 'juple-${environmentName}-notification-worker-firebase-source-parameter-guard'
  params: {
    #disable-next-line BCP329
    credentialSupplied: empty(firebaseServiceAccountKeyJson) ? 0 : 1
  }
}

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
        sqlConnectionStringSecret
        firebaseCredentialSecret
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
