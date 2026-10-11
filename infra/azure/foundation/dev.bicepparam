// Dev parameter values for ./main.bicep. Foundation had no parameter file for Dev before - Dev was
// deployed with inline `--parameters environmentName=dev ...` (see ../README.md). This file only
// states the same facts so a what-if / redeploy of the Dev Foundation is reproducible and, above all,
// can never carry a SQL password: the live Dev server keeps the password it has.
//
// Nothing here changes Dev by existing. Deploying it is a normal incremental deployment of the same
// template Dev already runs.
using 'main.bicep'

param environmentName = 'dev'

// Update mode, explicitly: no administratorLoginPassword is sent to the live Dev SQL server.
param sqlBootstrapAdministratorCredential = false

// sqlDatabaseSku / serviceBusSku are left unassigned - main.bicep's own defaults ('Basic' / 'Basic')
// are what Dev runs (confirmed read-only: Service Bus namespace sku = Basic).
