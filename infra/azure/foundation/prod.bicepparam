// Production parameter values for ./main.bicep - see ../app/dev.bicepparam's own header comment
// for the fuller explanation of why some parameters are literals and others use readEnvironmentVariable().
//
// rg-juple-prod already holds a PARTIAL Foundation (identity, ACR, Storage, SQL server + empty `Juple`
// database, Log Analytics, Container Apps environment). This file is the repeatable parameter source
// for re-deploying it - Service Bus, the notification worker identity and the rest of the template
// are added by an ordinary incremental deployment; nothing existing is deleted or recreated.
//
// SQL administrator credential - two explicit modes (see main.bicep / resources.bicep):
//   * UPDATE (default, every routine redeployment): sqlBootstrapAdministratorCredential = false and no
//     password. The password is not part of the request, so the existing one is never touched, and a
//     password supplied by mistake fails the deployment instead of being silently ignored.
//   * BOOTSTRAP (a brand-new server, or one deliberate controlled reset): set the two environment
//     variables below in the deploying shell only, deploy once, and remove them again. The password is
//     generated in memory and stored straight into Key Vault - never printed or written to a file.
using 'main.bicep'

param environmentName = 'prod'

// sqlAdministratorLogin is left unassigned - main.bicep's own default ('jupleadmin') applies, which
// is also the live Production server's login (read-only confirmed). Not a secret itself.

// Standard S0 - see ../README.md's "Production SKU/scale" section for the reasoning.
param sqlDatabaseSku = {
  name: 'S0'
  tier: 'Standard'
}

// Service Bus: Basic covers the notification pipeline today (queues, DLQ, max delivery count; idempotency
// lives in SQL). Moving to Standard is an operational scaling decision driven by observed backlog,
// throttling or latency - not a code change.
param serviceBusSku = 'Basic'

// Defaults to UPDATE mode. Only 'true' (exact) turns bootstrap on; any other value fails the build.
param sqlBootstrapAdministratorCredential = bool(readEnvironmentVariable('JUPLE_FOUNDATION_PROD_SQL_BOOTSTRAP', 'false'))
// Empty unless bootstrapping. The guard modules reject: bootstrap + empty, and update + non-empty.
param sqlAdministratorLoginPassword = readEnvironmentVariable('JUPLE_FOUNDATION_PROD_SQL_ADMINISTRATOR_LOGIN_PASSWORD', '')
