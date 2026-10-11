// Resource-less guard for where a workload's SQL runtime connection string comes from (see
// sqlConnectionStringFromKeyVault in each workload template). Its only purpose is the parameter validation
// below: ARM rejects the deployment during template validation - before anything is created or changed - when
// the chosen source is incomplete or ambiguous. Nothing is created and nothing is an output.
//
// It receives 0/1 flags, never the connection string or the vault URI itself: a rejected @secure() value would be
// echoed back in ARM's validation error message, and a credential must never be printed. The parameter name is
// the message the operator sees. Each template deploys this module twice with different arguments; the defaults
// below satisfy the constraints a given instance is not about.
targetScope = 'resourceGroup'

@description('Vault mode: 1 when the Key Vault URI parameter is non-empty. The SQL connection string is a Key Vault reference and cannot be built without the vault URI.')
@minValue(1)
#disable-next-line no-unused-params
param keyVaultUriProvided int = 1

@description('Vault mode: 1 when a connection string VALUE was also supplied (must be 0). It would be silently ignored - the reference wins - which is a trap, so the deployment is refused; leave the @secure() sqlConnectionString parameter unset. This is how an admin connection string is kept out of Production workloads.')
@maxValue(0)
#disable-next-line no-unused-params
param plaintextConnectionStringSupplied int = 0

@description('Parameter mode: 1 when the connection string VALUE was supplied (must be 1). Without it the Container Apps secret would be empty and the workload could not reach SQL.')
@minValue(1)
#disable-next-line no-unused-params
param connectionStringSupplied int = 1
