// Billing worker Container App - resource group scope. Deployed after Foundation (../foundation) AND ../foundation/billing.bicep
// (the Key Vault, the billing-events queue and the billing identity with its roles), and after the same Backend image the API runs has
// been pushed (one image, several entrypoints: the API, the Jobs, --run-notification-worker, and this app's --run-billing-worker).
// NOT deployed by R39-B1 - R39-B2 does that against DEV once Google Play is configured.
//
// What it does: consumes billing-events (one message = one stored Google Play notification id; never a purchase token), asks Google for
// the AUTHORITATIVE state of that purchase, ties it to the right account only by evidence, updates the purchase and acknowledges it if
// needed - see GoogleBillingProcessor. It is the fast path only: SQL (billing.StoreEvents) is the record and the reconcile Job
// (../billing-reconcile-job) sweeps whatever this app has not taken, so this app being scaled to zero, down or broken delays a
// subscription update but loses none.
//
// Secrets are Azure Key Vault references resolved through the billing identity - no secret value is ever a parameter here (the SQL
// connection string is the one value, supplied at deploy time exactly like every other app).
targetScope = 'resourceGroup'

@description('Short environment name - must match the Foundation/App deployment this is layered on top of.')
param environmentName string = 'dev'

param location string = 'koreacentral'

@description('ACR login server - Foundation output "acrLoginServer".')
param acrLoginServer string

@description('Repository name within the ACR - the same image as ../app/main.bicep.')
param imageRepository string = 'juple-api'

@description('Image tag to deploy. No default on purpose. Should match the API\'s tag, so both record and process events with the same code.')
param imageTag string

@description('Container Apps Environment resource ID - Foundation output "containerAppsEnvironmentId".')
param containerAppsEnvironmentId string

@description('The billing identity resource ID - ../foundation/billing.bicep output "billingIdentityResourceId" (never the API\'s). ACR pull, the billing-events Receiver role, Key Vault secret reads and the KEDA rule all use it.')
param billingIdentityResourceId string

@description('Its client ID - output "billingIdentityClientId". Not a secret; passed as AZURE_CLIENT_ID so DefaultAzureCredential picks this identity for Service Bus.')
param billingIdentityClientId string

@description('Service Bus namespace name (the KEDA rule takes the name, the app the FQDN).')
param serviceBusNamespaceName string

@description('Key Vault URI with trailing slash - ../foundation/billing.bicep output "keyVaultUri".')
param billingKeyVaultUri string

@description('Full ASP.NET Core SQL connection string, credentials included - same value/shape as ../app/main.bicep\'s. Never put a real value in a checked-in parameter file.')
@secure()
param sqlConnectionString string

@description('The allowlisted product / base plan (the same values as the API\'s).')
param googleProductId string
param googleBasePlanId string

@description('Pub/Sub push settings (validated at startup like the API\'s; the worker does not serve the webhook but shares the validated configuration).')
param googlePubSubAudience string
param googlePushServiceAccountEmail string

@description('Key Vault secret NAMES (never values).')
param googleServiceAccountSecretName string = 'google-play-service-account'
param googlePurchaseTokenKeySecretName string = 'google-purchase-token-key'
param googleAccountHashKeySecretName string = 'google-account-hash-key'
param trialIdentityHashKeySecretName string = 'trial-identity-hash-key'

@description('Replicas kept running while idle. 0 (dev default): scale to zero; a billing event then waits for KEDA to notice it plus a cold start, and the reconcile Job covers any gap. Production may prefer 1.')
@minValue(0)
param minReplicas int = 0

@minValue(1)
param maxReplicas int = 2

@description('KEDA target: messages waiting per replica before another replica is added.')
param messagesPerReplica int = 20

@description('How often KEDA checks the queue (seconds). Not 1s - every poll is a Service Bus management call.')
@minValue(5)
param pollingIntervalSeconds int = 15

@minValue(60)
param cooldownPeriodSeconds int = 300

param containerCpu string = '0.25'
param containerMemory string = '0.5Gi'

var containerAppName = 'ca-juple-billing-worker-${environmentName}'
var containerImage = '${acrLoginServer}/${imageRepository}:${imageTag}'
var serviceBusNamespaceFqdn = '${serviceBusNamespaceName}.servicebus.windows.net'
var billingEventsQueueName = 'billing-events'

resource billingWorker 'Microsoft.App/containerApps@2025-01-01' = {
  name: containerAppName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${billingIdentityResourceId}': {}
    }
  }
  properties: {
    environmentId: containerAppsEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      // No ingress: nothing calls the worker; it only pulls from Service Bus. /health is for the container's own probes.
      registries: [
        {
          server: acrLoginServer
          identity: billingIdentityResourceId
        }
      ]
      secrets: [
        {
          name: 'sql-connection-string'
          value: sqlConnectionString
        }
        {
          name: 'google-play-credential'
          keyVaultUrl: '${billingKeyVaultUri}secrets/${googleServiceAccountSecretName}'
          identity: billingIdentityResourceId
        }
        {
          name: 'google-purchase-token-key'
          keyVaultUrl: '${billingKeyVaultUri}secrets/${googlePurchaseTokenKeySecretName}'
          identity: billingIdentityResourceId
        }
        {
          name: 'google-account-hash-key'
          keyVaultUrl: '${billingKeyVaultUri}secrets/${googleAccountHashKeySecretName}'
          identity: billingIdentityResourceId
        }
        {
          // Read so the shared secret-distinctness validation sees the same three secrets the API does.
          name: 'trial-identity-hash-key'
          keyVaultUrl: '${billingKeyVaultUri}secrets/${trialIdentityHashKeySecretName}'
          identity: billingIdentityResourceId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'juple-billing-worker'
          image: containerImage
          // Dockerfile's ENTRYPOINT is kept; this switches Program.cs into the worker mode, which runs no controllers
          // and authenticates no request.
          args: [
            '--run-billing-worker'
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
              name: 'AZURE_CLIENT_ID'
              value: billingIdentityClientId
            }
            {
              name: 'Billing__Google__Enabled'
              value: 'true'
            }
            {
              name: 'Billing__Google__ProductId'
              value: googleProductId
            }
            {
              name: 'Billing__Google__BasePlanId'
              value: googleBasePlanId
            }
            {
              name: 'Billing__Google__ServiceAccountCredentialJson'
              secretRef: 'google-play-credential'
            }
            {
              name: 'Billing__Google__PurchaseTokenEncryptionKey'
              secretRef: 'google-purchase-token-key'
            }
            {
              name: 'Billing__Google__AccountHashKey'
              secretRef: 'google-account-hash-key'
            }
            {
              name: 'Billing__TrialIdentityHashKey'
              secretRef: 'trial-identity-hash-key'
            }
            {
              name: 'Billing__Google__PubSub__Audience'
              value: googlePubSubAudience
            }
            {
              name: 'Billing__Google__PubSub__PushServiceAccountEmail'
              value: googlePushServiceAccountEmail
            }
            {
              name: 'Billing__Events__ServiceBusNamespace'
              value: serviceBusNamespaceFqdn
            }
          ]
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
            name: 'billing-events'
            custom: {
              type: 'azure-servicebus'
              metadata: {
                namespace: serviceBusNamespaceName
                queueName: billingEventsQueueName
                messageCount: string(messagesPerReplica)
              }
              identity: billingIdentityResourceId
            }
          }
        ]
      }
    }
  }
}

output containerAppName string = billingWorker.name
