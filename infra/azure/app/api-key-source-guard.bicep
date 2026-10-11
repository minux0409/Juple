// Resource-less guard for where the API's three own keys come from (see apiKeysFromKeyVault in main.bicep).
// Its only purpose is the parameter validation below: ARM rejects the deployment during template validation -
// before anything is created or changed - when the chosen source is incomplete or ambiguous. Nothing is
// created and nothing is an output.
//
// It receives 0/1 flags and counts, never a key value or the vault URI itself: a rejected @secure() value
// would be echoed back in ARM's validation error message, and a key must never be printed. The parameter
// name is the message the operator sees. main.bicep deploys this module twice with different arguments;
// the defaults below satisfy the constraints a given instance is not about.
targetScope = 'resourceGroup'

@description('Vault mode: 1 when billingKeyVaultUri is non-empty. The API\'s key secrets are Key Vault references and cannot be built without the vault URI.')
@minValue(1)
#disable-next-line no-unused-params
param keyVaultUriProvided int = 1

@description('Vault mode: how many of the three key VALUES were also supplied as parameters (must be 0). They would be silently ignored - the references win - which is a trap, so the deployment is refused; leave the three @secure() parameters unset.')
@maxValue(0)
#disable-next-line no-unused-params
param plaintextKeyValuesSupplied int = 0

@description('Parameter mode: how many of the three key VALUES were supplied (must be 3). Without them a Container Apps secret would be empty and the API would not start.')
@minValue(3)
#disable-next-line no-unused-params
param apiKeyValuesSupplied int = 3
