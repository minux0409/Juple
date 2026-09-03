// Resource-group-scoped Foundation resources, deployed by ../foundation/main.bicep as a module
// scoped to the Resource Group it just created. Everything here exists independently of any
// container image - App (../app/main.bicep) is a separate, later deployment.
targetScope = 'resourceGroup'

param environmentName string
param location string
param sqlAdministratorLogin string

@secure()
param sqlAdministratorLoginPassword string

param sqlDatabaseSku object

// Deterministic suffix for the three globally-unique names below (ACR, Storage, SQL server) -
// derived purely from this Resource Group's own resource ID, so it is stable across redeployments
// without hardcoding a literal anywhere in source.
var uniqueSuffix = uniqueString(resourceGroup().id)

var managedIdentityName = 'id-juple-${environmentName}'
// ACR names: alphanumeric only, no hyphens allowed.
var acrName = toLower('acrjuple${environmentName}${uniqueSuffix}')
// Storage account names: lowercase alphanumeric only, 3-24 characters, no hyphens allowed.
var storageAccountName = toLower('stjuple${environmentName}${uniqueSuffix}')
var sqlServerName = 'sql-juple-${environmentName}-${uniqueSuffix}'
var sqlDatabaseName = 'Juple'
var blobContainerName = 'item-images'
var logAnalyticsWorkspaceName = 'log-juple-${environmentName}'
var containerAppsEnvironmentName = 'cae-juple-${environmentName}'

// Azure built-in role definition GUIDs - identical in every tenant; only the resourceId's scope
// prefix differs per assignment below.
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d' // AcrPull
// Storage Blob Data Contributor's own Actions already include
// Microsoft.Storage/storageAccounts/blobServices/generateUserDelegationKey/action (confirmed via
// `az role definition list --name "Storage Blob Data Contributor"`), on top of its DataActions
// covering blob read/write/delete - so this single role, at this same Storage Account scope, is
// everything ItemImageStore.cs/UserDelegationKeyCache.cs need. A separate Storage Blob Delegator
// assignment at the same scope would only be redundant. That role would earn its place again if
// this identity's Data Contributor grant were ever narrowed to a single container (ACLs at the
// container level, not the whole account) while user delegation key issuance still needs to stay
// account-wide - not the case today.
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe' // Storage Blob Data Contributor

resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: managedIdentityName
  location: location
}

// -----------------------------------------------------------------------------------------------
// Azure Container Registry - Basic SKU, admin user disabled. The Container App (../app/main.bicep)
// pulls images using managedIdentity's AcrPull role below, never a username/password.
// -----------------------------------------------------------------------------------------------
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

resource acrPullRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, managedIdentity.id, acrPullRoleId)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// -----------------------------------------------------------------------------------------------
// Storage Account - HTTPS only, TLS 1.2 minimum, no public blob access, and Shared Key auth
// disabled account-wide (allowSharedKeyAccess: false) so there is no connection-string/account-key
// path at all - only Azure AD (the Managed Identity below, via DefaultAzureCredential) can
// authenticate. This matches BlobServiceClientFactory.cs's Production path exactly, and is the
// same path ItemImageStore.cs's User Delegation SAS signing already expects (see
// UserDelegationKeyCache.cs) - the Storage Blob Data Contributor role assignment below already
// covers user delegation key issuance, not just blob read/write/delete.
// -----------------------------------------------------------------------------------------------
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    accessTier: 'Hot'
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: storageAccount
  name: 'default'
}

resource itemImagesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: blobContainerName
  properties: {
    publicAccess: 'None'
  }
}

resource storageBlobDataContributorRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, managedIdentity.id, storageBlobDataContributorRoleId)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// -----------------------------------------------------------------------------------------------
// Azure SQL - public endpoint (no VNet/Private Endpoint at this Dev scale, per design decision),
// TLS 1.2 minimum. AllowAzureServices is the well-known 0.0.0.0-0.0.0.0 sentinel rule (it does not
// mean "any public IP" - Azure treats this exact range specially) so the Container App and other
// Azure-internal callers can reach it; it is not how a developer's own PC reaches it for running
// migrations - that firewall rule is added and removed at deploy time, never hardcoded here (see
// ../README.md).
// -----------------------------------------------------------------------------------------------
resource sqlServer 'Microsoft.Sql/servers@2021-11-01' = {
  name: sqlServerName
  location: location
  properties: {
    administratorLogin: sqlAdministratorLogin
    administratorLoginPassword: sqlAdministratorLoginPassword
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

resource sqlAllowAzureServicesFirewallRule 'Microsoft.Sql/servers/firewallRules@2021-11-01' = {
  parent: sqlServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2021-11-01' = {
  parent: sqlServer
  name: sqlDatabaseName
  location: location
  sku: sqlDatabaseSku
}

// -----------------------------------------------------------------------------------------------
// Log Analytics - backs the Container Apps Environment below. Application Insights is not created
// here (see ../README.md's "not created yet" list); 30 days is the shortest retention Azure
// allows, kept short deliberately to bound Dev log cost.
// -----------------------------------------------------------------------------------------------
resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logAnalyticsWorkspaceName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

// -----------------------------------------------------------------------------------------------
// Container Apps Environment only - one Development environment, Consumption workload profile
// (no workloadProfiles specified). The Container App itself is created later, in ../app/main.bicep,
// once an image actually exists in the ACR above - this resource has no image dependency at all.
// -----------------------------------------------------------------------------------------------
resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: containerAppsEnvironmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsWorkspace.properties.customerId
        sharedKey: logAnalyticsWorkspace.listKeys().primarySharedKey
      }
    }
  }
}

output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer

output storageAccountName string = storageAccount.name
output storageBlobServiceUri string = storageAccount.properties.primaryEndpoints.blob

output sqlServerName string = sqlServer.name
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
output sqlDatabaseName string = sqlDatabase.name

output logAnalyticsWorkspaceName string = logAnalyticsWorkspace.name

output containerAppsEnvironmentName string = containerAppsEnvironment.name
output containerAppsEnvironmentId string = containerAppsEnvironment.id

output managedIdentityName string = managedIdentity.name
output managedIdentityResourceId string = managedIdentity.id
output managedIdentityClientId string = managedIdentity.properties.clientId
output managedIdentityPrincipalId string = managedIdentity.properties.principalId
