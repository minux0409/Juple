// Dev parameters for ./main.bicep. Nothing is deployed by this file existing; Application Insights does
// not exist in Dev today, and creating it is a separate, approved step.
using 'main.bicep'

param environmentName = 'dev'

// Live Dev Service Bus namespace (read-only confirmed): the Foundation output "serviceBusNamespaceName".
param serviceBusNamespaceName = 'sb-juple-dev-lg4zigc62h2qg'

// The on-call mailbox. Supplied at deploy time - not committed.
param alertEmailAddress = readEnvironmentVariable('JUPLE_MONITORING_ALERT_EMAIL')

// Dev's Container Apps exist, so their metric alerts can be created in the same deployment.
param containerAppAlertsEnabled = true
