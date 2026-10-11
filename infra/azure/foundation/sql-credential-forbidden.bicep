// Resource-less guard: deployed on every ordinary (non-bootstrap) deployment. Its only purpose is the
// parameter validation below: ARM rejects the deployment during template validation - before any
// resource is created or changed - when a password was supplied although
// sqlBootstrapAdministratorCredential is false (that value would otherwise be silently ignored: it is
// not sent to the SQL server, which is a trap, not a reset).
//
// It deliberately receives a 0/1 flag, not the password: a rejected @secure() value is echoed back in
// ARM's validation error message, and a credential must never be printed. The parameter name is the
// message the operator sees.
targetScope = 'resourceGroup'

@description('1 when an administrator password was supplied, 0 when not. An update never carries a SQL administrator password: leave sqlAdministratorLoginPassword empty, or set sqlBootstrapAdministratorCredential = true for a deliberate bootstrap/reset.')
@maxValue(0)
#disable-next-line no-unused-params
param sqlUpdateModeMustNotSupplyAdministratorPassword int
