// Resource-less guard: deployed only when the SQL administrator credential is being bootstrapped
// (sqlBootstrapAdministratorCredential = true). Its only purpose is the parameter validation below:
// ARM rejects the deployment during template validation - before any resource is created or changed -
// when no password was supplied.
//
// It deliberately receives a 0/1 flag, not the password: a rejected @secure() value is echoed back in
// ARM's validation error message, and a credential must never be printed. The parameter name is the
// message the operator sees.
targetScope = 'resourceGroup'

@description('1 when a non-empty administrator password (sqlAdministratorLoginPassword) was supplied, 0 when not. Bootstrap mode requires 1.')
@minValue(1)
#disable-next-line no-unused-params
param sqlBootstrapRequiresAdministratorPassword int
