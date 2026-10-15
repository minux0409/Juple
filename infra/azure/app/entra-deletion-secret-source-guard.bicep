// Resource-less guard for where a workload's Entra account-deletion client secret comes from (see
// entraAccountDeletionClientSecretFromKeyVault in ../blob-cleanup-job/main.bicep). Same pattern as
// sql-connection-source-guard.bicep: ARM rejects the deployment during template validation - before anything is created or
// changed - when the chosen source is incomplete or ambiguous. Nothing is created and nothing is an output.
//
// It receives 0/1 flags, never the secret or the vault URI itself: a rejected @secure() value would be echoed back in ARM's
// validation error message, and a credential must never be printed. The parameter name is the message the operator sees. A
// template deploys this module once per mode with different arguments; the defaults below satisfy the constraints a given
// instance is not about.
targetScope = 'resourceGroup'

@description('Vault mode: 1 when the Key Vault URI parameter is non-empty. The client secret is a Key Vault reference and cannot be built without the vault URI.')
@minValue(1)
#disable-next-line no-unused-params
param keyVaultUriProvided int = 1

@description('Vault mode: 1 when a client secret VALUE was also supplied (must be 0). It would be silently ignored - the reference wins - which is a trap, so the deployment is refused; leave the @secure() entraAccountDeletionClientSecret parameter unset.')
@maxValue(0)
#disable-next-line no-unused-params
param plaintextClientSecretSupplied int = 0

@description('Parameter mode: 1 when the client secret VALUE was supplied (must be 1). Without it the Container Apps secret would be empty and every Graph deletion would fail.')
@minValue(1)
#disable-next-line no-unused-params
param clientSecretSupplied int = 1
