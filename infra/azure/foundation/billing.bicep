// Billing foundation (R39-B1) - resource group scope, deployable on its own into an existing Foundation
// Resource Group (like ./notification-pipeline.bicep), so adding billing to an environment never has to
// redeploy - or re-supply the secrets of - the rest of Foundation. NOT deployed by R39-B1: this round only
// defines it; R39-B2 deploys it to DEV after the Google Play side exists.
//
// What it creates:
//   - an Azure Key Vault for the payment credentials (RBAC authorization, soft delete + purge protection).
//     It holds NO secret values here and the templates never receive one: secrets are set by the operator
//     (az keyvault secret set), and Container Apps read them as Key Vault references through a Managed
//     Identity - no value in the repo, in a parameter file, in appsettings or in a pipeline log.
//   - the billing-events Service Bus queue in the EXISTING namespace (SQL's billing.StoreEvents is the
//     record; the queue is only the wake-up, exactly like the notification pipeline).
//   - the billing identity (the billing worker and the reconcile Job share it) and the least-privilege roles.
//
// Secrets the operator must create in the vault (names are conventions, values are never in source):
//   google-play-service-account   the Google Play Developer API service-account credential JSON
//   google-purchase-token-key     Base64, 32 bytes: AES-256-GCM key sealing purchase tokens at rest
//   google-account-hash-key       Base64, >= 32 bytes: keys the opaque account id given to Google
//   trial-identity-hash-key       Base64, >= 32 bytes: keys the trial ledger (needed once Billing:ProgramEnabled is on)
// The three keys must be distinct values; the API refuses to start otherwise.
//
// Least privilege, per resource, never namespace-wide, never Data Owner, never vault-wide Officer:
//   API identity (existing, shared)   Service Bus Data Sender on billing-events (the post-commit wake-up of an
//                                     RTDN event); Key Vault Secrets User (to resolve its secret references).
//   Billing identity (created here)   Service Bus Data Receiver on billing-events; Key Vault Secrets User; AcrPull.
//                                     The reconcile Job needs neither Service Bus role - it sweeps SQL and Google.
targetScope = 'resourceGroup'

param environmentName string
param location string = resourceGroup().location

@description('Name of the existing Service Bus namespace (Foundation output "serviceBusNamespaceName") that gets the billing-events queue.')
param serviceBusNamespaceName string

@description('Name of the existing API Managed Identity (Foundation\'s id-juple-{env}).')
param apiIdentityName string

@description('Name of the existing ACR the billing worker / Job pull the Backend image from.')
param acrName string

var uniqueSuffix = uniqueString(resourceGroup().id)
// Key Vault names are globally unique and at most 24 characters.
var keyVaultName = take('kv-juple-${environmentName}-${uniqueSuffix}', 24)
var billingEventsQueueName = 'billing-events'
var billingIdentityName = 'id-juple-billing-${environmentName}'

// Azure built-in role definition GUIDs - identical in every tenant.
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d' // AcrPull
var serviceBusDataSenderRoleId = '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39' // Azure Service Bus Data Sender
var serviceBusDataReceiverRoleId = '4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0' // Azure Service Bus Data Receiver
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6' // Key Vault Secrets User

resource apiIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: apiIdentityName
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
}

resource serviceBusNamespace 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' existing = {
  name: serviceBusNamespaceName
}

// The billing worker's and reconcile Job's own identity: a compromise of the API's identity must not be able to
// receive (read or drain) the queue, and these need neither Blob nor the API's other grants.
resource billingIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: billingIdentityName
  location: location
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    // Azure RBAC, not legacy access policies: every grant below is an auditable role assignment.
    enableRbacAuthorization: true
    // Payment credentials are not something to lose to an accidental delete.
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    // Container Apps reach the vault over the public endpoint, authenticated by Managed Identity only.
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

// Same message shape and lifetime policy as the notification queues: ids only, short-lived, dead-lettered after
// 10 failed deliveries - a dead-lettered signal never invalidates the SQL event, which the sweep recovers.
resource billingEventsQueue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: serviceBusNamespace
  name: billingEventsQueueName
  properties: {
    lockDuration: 'PT1M'
    maxDeliveryCount: 10
    defaultMessageTimeToLive: 'PT1H'
    deadLetteringOnMessageExpiration: true
    maxSizeInMegabytes: 1024
  }
}

// API: send the wake-up for a stored RTDN event - nothing else.
resource apiBillingSenderRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(billingEventsQueue.id, apiIdentity.id, serviceBusDataSenderRoleId)
  scope: billingEventsQueue
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', serviceBusDataSenderRoleId)
    principalId: apiIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// Billing worker: receive billing-events.
resource billingReceiverRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(billingEventsQueue.id, billingIdentity.id, serviceBusDataReceiverRoleId)
  scope: billingEventsQueue
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', serviceBusDataReceiverRoleId)
    principalId: billingIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// Read the secrets (and only read): the API and the billing identity resolve their Key Vault references.
resource apiKeyVaultSecretsUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, apiIdentity.id, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: apiIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource billingKeyVaultSecretsUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, billingIdentity.id, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: billingIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// The billing worker / Job pull the same image as the API.
resource billingAcrPullRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, billingIdentity.id, acrPullRoleId)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: billingIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

output keyVaultName string = keyVault.name
// With the trailing slash: '${keyVaultUri}secrets/<name>' is a Container Apps Key Vault reference (a URI, not a secret).
output keyVaultUri string = keyVault.properties.vaultUri

output billingIdentityName string = billingIdentity.name
output billingIdentityResourceId string = billingIdentity.id
output billingIdentityClientId string = billingIdentity.properties.clientId

output billingEventsQueueName string = billingEventsQueue.name
