// Foundation entrypoint - subscription scope, so it can create the Resource Group itself before
// deploying anything into it. Creates every Azure-based resource Juple's Backend needs to exist
// *before* an image is ever pushed: Resource Group, User Assigned Managed Identity, ACR, Storage
// Account (+ item-images Blob container), Azure SQL server/database, Log Analytics Workspace, and
// the Container Apps Environment. It deliberately never creates a Microsoft.App/containerApps
// resource - that only happens in ../app/main.bicep, after an image has actually been pushed to
// the ACR this template creates (see ../README.md for the full order).
targetScope = 'subscription'

@description('Short environment name used throughout resource naming. Only "dev" is actually deployed today - docs/architecture.md still treats Production as future work - but every name here is parameterized on it, and "prod" is now an allowed value too so Production Foundation can be deployed with this same template (no separate copy/fork) once that work actually starts. Defaults to "dev" so an existing Dev redeploy that omits this parameter is unaffected.')
@allowed([
  'dev'
  'prod'
])
param environmentName string = 'dev'

@description('Azure region for every Foundation resource.')
param location string = 'koreacentral'

@description('Azure SQL server administrator login name. Not a secret itself, but paired with sqlAdministratorLoginPassword below.')
param sqlAdministratorLogin string = 'jupleadmin'

@description('Azure SQL server administrator password. Never put a real value in a checked-in parameter file - supply it at deploy time (e.g. from a local environment variable the deploy command reads), and it is never included in this template\'s outputs.')
@secure()
param sqlAdministratorLoginPassword string

@description('Azure SQL Database SKU. Defaults to Basic - the simplest, most predictable Dev/dogfooding tier. Change to a Serverless or higher tier by overriding this parameter, no template edits needed.')
param sqlDatabaseSku object = {
  name: 'Basic'
  tier: 'Basic'
}

var resourceGroupName = 'rg-juple-${environmentName}'

resource rg 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: resourceGroupName
  location: location
  tags: {
    project: 'juple'
    environment: environmentName
  }
}

module resources 'resources.bicep' = {
  name: 'juple-${environmentName}-foundation-resources'
  scope: rg
  params: {
    environmentName: environmentName
    location: location
    sqlAdministratorLogin: sqlAdministratorLogin
    sqlAdministratorLoginPassword: sqlAdministratorLoginPassword
    sqlDatabaseSku: sqlDatabaseSku
  }
}

output resourceGroupName string = rg.name

output acrName string = resources.outputs.acrName
output acrLoginServer string = resources.outputs.acrLoginServer

output storageAccountName string = resources.outputs.storageAccountName
output storageBlobServiceUri string = resources.outputs.storageBlobServiceUri

output sqlServerName string = resources.outputs.sqlServerName
output sqlServerFqdn string = resources.outputs.sqlServerFqdn
output sqlDatabaseName string = resources.outputs.sqlDatabaseName

output logAnalyticsWorkspaceName string = resources.outputs.logAnalyticsWorkspaceName

output containerAppsEnvironmentName string = resources.outputs.containerAppsEnvironmentName
output containerAppsEnvironmentId string = resources.outputs.containerAppsEnvironmentId

output managedIdentityName string = resources.outputs.managedIdentityName
output managedIdentityResourceId string = resources.outputs.managedIdentityResourceId
output managedIdentityClientId string = resources.outputs.managedIdentityClientId
output managedIdentityPrincipalId string = resources.outputs.managedIdentityPrincipalId
