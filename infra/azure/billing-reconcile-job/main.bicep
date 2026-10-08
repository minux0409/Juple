// Billing reconcile scheduled Job - resource group scope. Deployed after Foundation (../foundation) and
// ../foundation/billing.bicep, and after the Backend image has been pushed (same image as the API, entrypoint --run-billing-reconcile).
// NOT deployed by R39-B1 - R39-B2 does that against DEV. With googleBillingEnabled false (the default) each run logs that billing
// reconciliation is disabled and exits 0 - no Google call, no billing write, no Key Vault reference, no Google setting required.
//
// What it does, in one bounded pass per run (see GoogleBillingProcessor.SweepAsync):
//   1. sweeps billing.StoreEvents that are not processed yet - including any whose wake-up never reached the queue or whose
//      worker never ran - and processes them (an authoritative Google fetch each);
//   2. re-checks every store purchase whose periodic reconciliation is due (the cadence is set per purchase by its own state - at
//      most a day for a healthy one, a few hours during a grace period - so Google is never hammered), which is what recovers a
//      MISSED notification, detects an expiry / hold / revoke, and retries a failed acknowledgement.
// It uses no Service Bus (SQL + the Google API only), and the same identity as the billing worker for the Key Vault secrets.
targetScope = 'resourceGroup'

@description('Short environment name - must match the Foundation/App deployment this is layered on top of.')
param environmentName string = 'dev'

param location string = 'koreacentral'

@description('ACR login server - Foundation output "acrLoginServer".')
param acrLoginServer string

@description('Repository name within the ACR - the same image as ../app/main.bicep.')
param imageRepository string = 'juple-api'

@description('Image tag to deploy. No default on purpose.')
param imageTag string

@description('Container Apps Environment resource ID - Foundation output "containerAppsEnvironmentId".')
param containerAppsEnvironmentId string

@description('The billing identity resource ID - ../foundation/billing.bicep output "billingIdentityResourceId". ACR pull and Key Vault secret reads.')
param billingIdentityResourceId string

@description('Turns Google Play billing on for this runtime - the same switch as ../app/main.bicep\'s googleBillingEnabled. false (the default): the runtime is deployed but inert - no Google call, no billing-event consumption, no reconciliation - and none of the Google / Key Vault settings below is wired or required.')
param googleBillingEnabled bool = false

@description('Key Vault URI with trailing slash - ../foundation/billing.bicep output "keyVaultUri". Needed only when googleBillingEnabled.')
param billingKeyVaultUri string = ''

@description('Full ASP.NET Core SQL connection string, credentials included. Never put a real value in a checked-in parameter file.')
@secure()
param sqlConnectionString string

@description('The allowlisted product / base plan (the same values as the API\'s).')
param googleProductId string = ''
param googleBasePlanId string = ''
param googlePubSubAudience string = ''
param googlePushServiceAccountEmail string = ''

@description('Key Vault secret NAMES (never values).')
param googleServiceAccountSecretName string = 'google-play-service-account'
param googlePurchaseTokenKeySecretName string = 'google-purchase-token-key'
param googleAccountHashKeySecretName string = 'google-account-hash-key'
param trialIdentityHashKeySecretName string = 'trial-identity-hash-key'

@description('UTC cron expression (Container Apps Job schedules are always UTC). Default: every 15 minutes - lost wake-ups are recovered within minutes, and each purchase is only re-asked of Google when its own cadence says it is due. Overlapping executions are safe: events and purchases are claimed with compare-and-set leases.')
param cronExpression string = '*/15 * * * *'

@description('Wall-clock ceiling for one execution (a bounded pass of at most 100 events and 100 purchases).')
param replicaTimeoutSeconds int = 600

param replicaRetryLimit int = 1

param containerCpu string = '0.25'
param containerMemory string = '0.5Gi'

var jobName = 'caj-juple-billing-reconcile-${environmentName}'
var containerImage = '${acrLoginServer}/${imageRepository}:${imageTag}'

var googleEnv = googleBillingEnabled
  ? [
      {
        name: 'Billing__Google__ProductId'
        value: googleProductId
      }
      {
        name: 'Billing__Google__BasePlanId'
        value: googleBasePlanId
      }
      {
        name: 'Billing__Google__ServiceAccountCredentialJson'
        secretRef: 'google-play-credential'
      }
      {
        name: 'Billing__Google__PurchaseTokenEncryptionKey'
        secretRef: 'google-purchase-token-key'
      }
      {
        name: 'Billing__Google__AccountHashKey'
        secretRef: 'google-account-hash-key'
      }
      {
        name: 'Billing__TrialIdentityHashKey'
        secretRef: 'trial-identity-hash-key'
      }
      {
        name: 'Billing__Google__PubSub__Audience'
        value: googlePubSubAudience
      }
      {
        name: 'Billing__Google__PubSub__PushServiceAccountEmail'
        value: googlePushServiceAccountEmail
      }
    ]
  : []

resource billingReconcileJob 'Microsoft.App/jobs@2024-03-01' = {
  name: jobName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${billingIdentityResourceId}': {}
    }
  }
  properties: {
    environmentId: containerAppsEnvironmentId
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: replicaTimeoutSeconds
      replicaRetryLimit: replicaRetryLimit
      scheduleTriggerConfig: {
        cronExpression: cronExpression
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: acrLoginServer
          identity: billingIdentityResourceId
        }
      ]
      // Key Vault references only while enabled: a disabled run resolves no Google secret at all.
      secrets: concat(
        [
          {
            name: 'sql-connection-string'
            value: sqlConnectionString
          }
        ],
        googleBillingEnabled
          ? [
              {
                name: 'google-play-credential'
                keyVaultUrl: '${billingKeyVaultUri}secrets/${googleServiceAccountSecretName}'
                identity: billingIdentityResourceId
              }
              {
                name: 'google-purchase-token-key'
                keyVaultUrl: '${billingKeyVaultUri}secrets/${googlePurchaseTokenKeySecretName}'
                identity: billingIdentityResourceId
              }
              {
                name: 'google-account-hash-key'
                keyVaultUrl: '${billingKeyVaultUri}secrets/${googleAccountHashKeySecretName}'
                identity: billingIdentityResourceId
              }
              {
                // Read so the shared secret-distinctness validation sees the same three secrets the API does.
                name: 'trial-identity-hash-key'
                keyVaultUrl: '${billingKeyVaultUri}secrets/${trialIdentityHashKeySecretName}'
                identity: billingIdentityResourceId
              }
            ]
          : []
      )
    }
    template: {
      containers: [
        {
          name: 'juple-billing-reconcile'
          image: containerImage
          // Dockerfile's ENTRYPOINT is kept; this appends the one argument that switches Program.cs into its one-shot branch,
          // which returns before any HTTP pipeline starts.
          args: [
            '--run-billing-reconcile'
          ]
          resources: {
            cpu: json(containerCpu)
            memory: containerMemory
          }
          env: concat(
            [
              {
                name: 'ConnectionStrings__JupleDatabase'
                secretRef: 'sql-connection-string'
              }
              {
                name: 'Billing__Google__Enabled'
                value: string(googleBillingEnabled)
              }
            ],
            googleEnv
          )
        }
      ]
    }
  }
}

output jobName string = billingReconcileJob.name
