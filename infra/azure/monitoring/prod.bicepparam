// Production parameters for ./main.bicep. Nothing is deployed by this file existing.
//
// Two stages, because the Container App alerts reference apps that do not exist until the workloads are
// deployed: stage 1 now (the Foundation exists), stage 2 once ca-juple-api-prod and the workers exist -
// flip containerAppAlertsEnabled to true and redeploy; nothing else changes.
using 'main.bicep'

param environmentName = 'prod'

// Foundation output "serviceBusNamespaceName". The Production namespace does not exist yet (the
// Production Foundation predates the notification pipeline); no value is guessed, so this fails closed
// (BCP427) until the Foundation has been re-deployed and the output is known.
param serviceBusNamespaceName = readEnvironmentVariable('JUPLE_MONITORING_PROD_SERVICE_BUS_NAMESPACE_NAME')

// The on-call mailbox. Supplied at deploy time - never guessed.
param alertEmailAddress = readEnvironmentVariable('JUPLE_MONITORING_PROD_ALERT_EMAIL')

// Stage 1. Set to true only once the API and workers are deployed.
param containerAppAlertsEnabled = false
