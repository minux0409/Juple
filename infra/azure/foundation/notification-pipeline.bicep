// The notification pipeline's Azure resources - a module of ../foundation/resources.bicep, and also
// deployable on its own into an existing Foundation Resource Group (so adding the pipeline to an
// environment never has to redeploy - and re-supply the secrets of - the rest of Foundation).
//
// Service Bus is only the fast path's wake-up transport: Azure SQL's outbox
// (notifications.NotificationEvents) is the record, so a lost, expired or dead-lettered message loses
// nothing (the push-dispatch Job recovers it). Entra ID only: disableLocalAuth removes every SAS
// key/connection string - Managed Identities are the only way in.
//
// Least privilege, per queue, never namespace-wide, never Data Owner:
//   API identity (existing, shared with the Jobs/Web): Data Sender on notification-events only (the
//     post-commit wake-up signal). It can never receive or manage either queue.
//   Worker identity (created here, its own): Data Receiver on notification-events; Data Sender + Data
//     Receiver on push-deliveries; AcrPull. Its KEDA scale rules use the same identity and its
//     Receiver roles to read queue depth (verified at the first DEV deployment - see ../README.md).
//   The push-dispatch recovery Job uses no Service Bus at all (SQL only), so it needs no role.
targetScope = 'resourceGroup'

param environmentName string
param location string = resourceGroup().location

@description('Service Bus tier. Basic is enough: two queues, dead-lettering and max-delivery-count are all Basic features; duplicate detection, topics and sessions (Standard) are not used - processing is idempotent in SQL instead. Upgrading is an operational scaling decision (observed backlog/throttling/latency), not a code change.')
@allowed([
  'Basic'
  'Standard'
])
param serviceBusSku string = 'Basic'

@description('Name of the existing API Managed Identity (Foundation\'s id-juple-{env}).')
param apiIdentityName string

@description('Name of the existing ACR the worker pulls the Backend image from.')
param acrName string

// Same deterministic suffix rule as resources.bicep (this Resource Group's own id).
var uniqueSuffix = uniqueString(resourceGroup().id)
// Service Bus namespace names are globally unique (6-50 chars, letters/digits/hyphens).
var serviceBusNamespaceName = 'sb-juple-${environmentName}-${uniqueSuffix}'
var notificationEventsQueueName = 'notification-events'
var pushDeliveriesQueueName = 'push-deliveries'
var notificationWorkerIdentityName = 'id-juple-notify-worker-${environmentName}'

// Azure built-in role definition GUIDs - identical in every tenant.
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d' // AcrPull
var serviceBusDataSenderRoleId = '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39' // Azure Service Bus Data Sender
var serviceBusDataReceiverRoleId = '4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0' // Azure Service Bus Data Receiver

resource apiIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: apiIdentityName
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
}

// The notification worker's own identity: a compromise of the API's identity must not be able to
// receive (read or drain) the queues, and the worker needs neither Blob nor the API's other grants.
resource notificationWorkerIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: notificationWorkerIdentityName
  location: location
}

resource serviceBusNamespace 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' = {
  name: serviceBusNamespaceName
  location: location
  sku: {
    name: serviceBusSku
    tier: serviceBusSku
  }
  properties: {
    disableLocalAuth: true
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

// Messages are tiny (ids only) and short-lived by design: an hour is far beyond any normal wait, and
// whatever expires is dead-lettered for inspection while SQL still drives its recovery. After 10
// failed deliveries a message is dead-lettered too (the handler leaves a failed message unsettled,
// so each retry waits one lock duration - a natural back-off).
var notificationQueueProperties = {
  lockDuration: 'PT1M'
  maxDeliveryCount: 10
  defaultMessageTimeToLive: 'PT1H'
  deadLetteringOnMessageExpiration: true
  maxSizeInMegabytes: 1024
}

resource notificationEventsQueue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: serviceBusNamespace
  name: notificationEventsQueueName
  properties: notificationQueueProperties
}

resource pushDeliveriesQueue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: serviceBusNamespace
  name: pushDeliveriesQueueName
  properties: notificationQueueProperties
}

// API: send wake-up signals to notification-events - nothing else.
resource apiSignalSenderRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(notificationEventsQueue.id, apiIdentity.id, serviceBusDataSenderRoleId)
  scope: notificationEventsQueue
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', serviceBusDataSenderRoleId)
    principalId: apiIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// Worker: receive notification-events.
resource workerEventsReceiverRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(notificationEventsQueue.id, notificationWorkerIdentity.id, serviceBusDataReceiverRoleId)
  scope: notificationEventsQueue
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', serviceBusDataReceiverRoleId)
    principalId: notificationWorkerIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// Worker: hand delivery batches to push-deliveries...
resource workerDeliveriesSenderRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(pushDeliveriesQueue.id, notificationWorkerIdentity.id, serviceBusDataSenderRoleId)
  scope: pushDeliveriesQueue
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', serviceBusDataSenderRoleId)
    principalId: notificationWorkerIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ...and receive them.
resource workerDeliveriesReceiverRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(pushDeliveriesQueue.id, notificationWorkerIdentity.id, serviceBusDataReceiverRoleId)
  scope: pushDeliveriesQueue
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', serviceBusDataReceiverRoleId)
    principalId: notificationWorkerIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// The worker pulls the same image as the API.
resource workerAcrPullRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, notificationWorkerIdentity.id, acrPullRoleId)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: notificationWorkerIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

output notificationWorkerIdentityName string = notificationWorkerIdentity.name
output notificationWorkerIdentityResourceId string = notificationWorkerIdentity.id
output notificationWorkerIdentityClientId string = notificationWorkerIdentity.properties.clientId

output serviceBusNamespaceName string = serviceBusNamespace.name
// The address the API/worker connect to (NotificationPipeline__ServiceBusNamespace) - not a secret.
output serviceBusNamespaceFqdn string = '${serviceBusNamespace.name}.servicebus.windows.net'
output notificationEventsQueueName string = notificationEventsQueue.name
output pushDeliveriesQueueName string = pushDeliveriesQueue.name
