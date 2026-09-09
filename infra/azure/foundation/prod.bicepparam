// Production parameter values for ./main.bicep - see ../app/dev.bicepparam's own header comment
// for the fuller explanation of why some parameters are literals and others use
// readEnvironmentVariable(); this file follows the exact same convention. Production Foundation
// does not exist in Azure yet (see ../README.md) - this file exists so the eventual first
// Production deployment has a ready parameter source to use, not because a deployment is
// imminent. No Azure mutation happens from this file merely existing.
using 'main.bicep'

param environmentName = 'prod'

// sqlAdministratorLogin is left unassigned - main.bicep's own default ('jupleadmin') applies,
// matching Dev's own login name. Not a secret itself (see main.bicep's own description), but
// paired with the real secret below.

// Confirmed initial Production SQL tier decision (see ../README.md's "Production SKU/scale"
// section for the full reasoning) - a fixed fact about how Production is meant to run, not a
// live-generated or per-deployment value, so a literal here is safe to commit. Standard S0
// (10 DTU, 250GB) replaces Dev's Basic default (5 DTU, 2GB) - Basic's DTU ceiling is a real
// throttling risk once real user traffic overlaps with the hourly Push dispatch Job and the
// 5-minute Blob cleanup Job querying the same database, and its 2GB storage ceiling leaves
// little room to grow. S0 is still one of the cheapest genuinely-production tiers - this is not
// an overprovision, and higher tiers were deliberately not chosen without an actual load signal
// to justify them.
param sqlDatabaseSku = {
  name: 'S0'
  tier: 'Standard'
}

// The Azure SQL administrator password does not exist yet either - no literal to commit, and
// even once it does, it must never be written to a checked-in file (see main.bicep's own
// @secure() description). readEnvironmentVariable() makes a deployment attempt before this
// password has actually been generated and set fail closed with a clear BCP427 error, exactly
// like every other not-yet-real Production value in ../app/prod.bicepparam and
// ../web/prod.bicepparam - never a blank or guessed value. Set the matching environment variable
// in the deploying shell before running `az deployment sub create` with this file; this round
// does not generate or set a real Production password.
param sqlAdministratorLoginPassword = readEnvironmentVariable('JUPLE_FOUNDATION_PROD_SQL_ADMINISTRATOR_LOGIN_PASSWORD')
