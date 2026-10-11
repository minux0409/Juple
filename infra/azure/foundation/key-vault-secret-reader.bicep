// Grants ONE managed identity read access to ONE Key Vault secret - not to the vault. Its own lifecycle, like
// ./billing.bicep (the vault is created there), and nothing depends on it.
//
// Why it exists: the vault-wide "Key Vault Secrets User" roles that billing.bicep gives the API and billing
// identities are broader than a workload that needs a single secret should hold. The notification worker needs
// only the SQL runtime connection string (it reads and writes SQL and nothing else in the vault), so it gets a
// role assignment scoped to that secret alone and never sees the billing keys or the administrator credential.
// Deploy it before the notification worker; a Key Vault reference from an identity without the role fails at
// revision start.
//
// Least privilege: role "Key Vault Secrets User" (read secret values), scope = the secret resource.
targetScope = 'resourceGroup'

@description('Name of the existing Key Vault (billing.bicep output "keyVaultName").')
param keyVaultName string

@description('Name of the existing secret the identity may read (e.g. sql-runtime-connection-string).')
param secretName string

@description('Name of the existing user-assigned managed identity that gets read access (e.g. id-juple-notify-worker-prod).')
param readerIdentityName string

var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6' // Key Vault Secrets User

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource secret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = {
  parent: keyVault
  name: secretName
}

resource readerIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: readerIdentityName
}

resource secretReaderRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(secret.id, readerIdentity.id, keyVaultSecretsUserRoleId)
  scope: secret
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: readerIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
