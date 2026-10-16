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

// Stage 2 (prepared 2026-10-15, not yet deployed): ca-juple-api-prod, ca-juple-web-prod, both workers and the four Jobs exist, and
// log-juple-prod has ContainerAppSystemLogs_CL rows for every Job (checked with a read-only query) - so the API 5xx, restart and
// scheduled-Job-failure alerts can be created. The Job alert is what watches caj-juple-blob-cleanup-prod, whose exit code is non-zero
// while an Entra sign-in account deletion keeps failing (3 failed runs in 30 minutes = 15 minutes of a persisting Graph failure).
param containerAppAlertsEnabled = true

// Alert 5 - Key Vault secret near-expiry / expired (Entra account-deletion client secrets end 2027-04-13). Enabled 2026-10-16 (approved):
// the Microsoft.EventGrid provider is registered and an Event Grid system topic on kv-juple-prod-y5v2isrk3z forwards SecretNearExpiry (30 days
// ahead - the platform's only lead time) and SecretExpired to ag-juple-prod. No fixed cost; no Function / Logic App for extra reminders.
param keyVaultExpiryAlertsEnabled = true
param keyVaultName = 'kv-juple-prod-y5v2isrk3z'
