// Billing worker Container App - resource group scope. Deployed after Foundation (../foundation) AND ../foundation/billing.bicep
// (the Key Vault, the billing-events queue and the billing identity with its roles), and after the same Backend image the API runs has
// been pushed (one image, several entrypoints: the API, the Jobs, --run-notification-worker, and this app's --run-billing-worker).
// NOT deployed by R39-B1 - R39-B2 does that against DEV. With googleBillingEnabled false (the default) it is deployable before Google Play
// is configured: the worker starts and idles (no queue consumption, no KEDA queue rule, no Key Vault reference, no Google setting).
//
// What it does: consumes billing-events (one message = one stored Google Play notification id; never a purchase token), asks Google for
// the AUTHORITATIVE state of that purchase, ties it to the right account only by evidence, updates the purchase and acknowledges it if
// needed - see GoogleBillingProcessor. It is the fast path only: SQL (billing.StoreEvents) is the record and the reconcile Job
// (../billing-reconcile-job) sweeps whatever this app has not taken, so this app being scaled to zero, down or broken delays a
// subscription update but loses none.
//
// Secrets are Azure Key Vault references resolved through the billing identity - no secret value is ever a parameter here (the SQL
// connection string is the one value, supplied at deploy time exactly like every other app).
targetScope = 'resourceGroup'

@description('Short environment name - must match the Foundation/App deployment this is layered on top of.')
param environmentName string = 'dev'

param location string = 'koreacentral'

@description('ACR login server - Foundation output "acrLoginServer".')
param acrLoginServer string

@description('Repository name within the ACR - the same image as ../app/main.bicep.')
param imageRepository string = 'juple-api'

@description('Image tag to deploy. Empty only when imageDigest is used - the template never picks an image on its own. Should match the API\'s tag, so both record and process events with the same code.')
param imageTag string = ''

@description('Immutable image digest ("sha256:" + 64 hex characters) to deploy instead of a tag - Production pins the exact image the API runs, so a re-pushed tag can never change what runs. When set it wins over imageTag and the reference becomes {acrLoginServer}/{imageRepository}@{imageDigest}. Empty = use imageTag (Dev).')
param imageDigest string = ''

@description('Container Apps Environment resource ID - Foundation output "containerAppsEnvironmentId".')
param containerAppsEnvironmentId string

@description('The billing identity resource ID - ../foundation/billing.bicep output "billingIdentityResourceId" (never the API\'s). ACR pull, the billing-events Receiver role, Key Vault secret reads and the KEDA rule all use it.')
param billingIdentityResourceId string

@description('Its client ID - output "billingIdentityClientId". Not a secret; passed as AZURE_CLIENT_ID so DefaultAzureCredential picks this identity for Service Bus.')
param billingIdentityClientId string

@description('Turns Google Play billing on for this runtime - the same switch as ../app/main.bicep\'s googleBillingEnabled. false (the default): the runtime is deployed but inert - no Google call, no billing-event consumption, no reconciliation - and none of the Google / Key Vault settings below is wired or required.')
param googleBillingEnabled bool = false

// ---- Apple App Store billing (StoreKit + App Store Server API / Notifications V2). OFF by default, exactly like Google's: with
// appleBillingEnabled false the runtime gets no Apple secret and no Apple setting. Secrets are Key Vault references through the managed
// identity (names only here). The product ids stay empty until the App Store Connect subscription group exists.
@description('Turns on App Store billing (catalog / verify / restore / Server Notifications V2). Requires billingKeyVaultUri, billingEventsServiceBusNamespace and the settings below, set the SAME on the API, the billing worker and the reconcile Job.')
param appleBillingEnabled bool = false

@description('The iOS bundle id the App Store transactions must carry.')
param appleBundleId string = 'com.juple.app'

@description('The allowlisted auto-renewable product ids of the ONE membership group (monthly and yearly). Never guessed: set once they exist in App Store Connect.')
param appleProductIds array = []

@description('The App Store Connect issuer id (UUID) and the in-app purchase API key id.')
param appleIssuerId string = ''
param appleKeyId string = ''

@description('Whether Sandbox transactions are accepted (App Review and TestFlight purchase in the Sandbox even against the production server).')
param appleAcceptSandbox bool = true

@description('Key Vault secret NAMES (never values): the .p8 in-app purchase key (PEM text), the App Account Token key and the stored-transaction handle key (Base64 >= 32 bytes / exactly 32 bytes, distinct from every other billing secret).')
param applePrivateKeySecretName string = 'apple-iap-private-key'
param appleAccountTokenKeySecretName string = 'apple-account-token-key'
param appleHandleKeySecretName string = 'apple-handle-key'

@description('Service Bus namespace name (the KEDA rule takes the name, the app the FQDN). Needed only when googleBillingEnabled.')
param serviceBusNamespaceName string = ''

@description('Key Vault URI with trailing slash - ../foundation/billing.bicep output "keyVaultUri". Needed only when googleBillingEnabled.')
param billingKeyVaultUri string = ''

@description('Full ASP.NET Core SQL connection string, credentials included - same value/shape as ../app/main.bicep\'s. Never put a real value in a checked-in parameter file.')
@secure()
param sqlConnectionString string = ''

@description('Where the SQL runtime connection string comes from. false (default - Dev): the @secure() sqlConnectionString parameter carries the VALUE into a Container Apps secret. true (Production): a Key Vault reference to the secret named by sqlConnectionStringSecretName, resolved at runtime through this workload\'s own managed identity - the deployer never reads or passes a connection string, and a supplied one is refused by ../app/sql-connection-source-guard.bicep rather than silently ignored. Requires the Key Vault URI. The vault secret holds the RUNTIME principal\'s connection string, never the administrator\'s.')
param sqlConnectionStringFromKeyVault bool = false

@description('Key Vault secret NAME (never a value) of the runtime connection string - used only when sqlConnectionStringFromKeyVault. The Container Apps secret keeps its own name, sql-connection-string, so the env secretRef is unchanged.')
param sqlConnectionStringSecretName string = 'sql-runtime-connection-string'

@description('The allowlisted product / base plan (the same values as the API\'s). Needed only when googleBillingEnabled.')
param googleProductId string = ''
param googleBasePlanId string = ''

@description('Pub/Sub push settings (validated at startup like the API\'s; the worker does not serve the webhook but shares the validated configuration). Needed only when googleBillingEnabled.')
param googlePubSubAudience string = ''
param googlePushServiceAccountEmail string = ''

@description('Key Vault secret NAMES (never values).')
param googleServiceAccountSecretName string = 'google-play-service-account'
param googlePurchaseTokenKeySecretName string = 'google-purchase-token-key'
param googleAccountHashKeySecretName string = 'google-account-hash-key'
param trialIdentityHashKeySecretName string = 'trial-identity-hash-key'

@description('Replicas kept running while idle. 0 (dev default): scale to zero; a billing event then waits for KEDA to notice it plus a cold start, and the reconcile Job covers any gap. Production may prefer 1.')
@minValue(0)
param minReplicas int = 0

@minValue(1)
param maxReplicas int = 2

@description('KEDA target: messages waiting per replica before another replica is added.')
param messagesPerReplica int = 20

@description('How often KEDA checks the queue (seconds). Not 1s - every poll is a Service Bus management call.')
@minValue(5)
param pollingIntervalSeconds int = 15

@minValue(60)
param cooldownPeriodSeconds int = 300

param containerCpu string = '0.25'
param containerMemory string = '0.5Gi'

@description('Application Insights connection string (../monitoring/main.bicep output "applicationInsightsConnectionString"). Empty (default) = not wired. The backend has no Application Insights / OpenTelemetry SDK yet, so this only sets APPLICATIONINSIGHTS_CONNECTION_STRING and is inert until instrumentation is added.')
param applicationInsightsConnectionString string = ''

var observabilityEnv = empty(applicationInsightsConnectionString)
  ? []
  : [
      {
        name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
        value: applicationInsightsConnectionString
      }
    ]

var containerAppName = 'ca-juple-billing-worker-${environmentName}'
var containerImage = empty(imageDigest)
  ? '${acrLoginServer}/${imageRepository}:${imageTag}'
  : '${acrLoginServer}/${imageRepository}@${imageDigest}'

// Fail-closed image reference, shared with the API template (see ../app/image-reference-guard.bicep): an image must
// be named (no floating-tag fallback) and a digest must have the exact length of a sha256 reference.
module imageReferenceGuard '../app/image-reference-guard.bicep' = {
  name: 'juple-${environmentName}-billing-worker-image-reference-guard'
  params: {
    #disable-next-line BCP329
    imageReferenceSupplied: (empty(imageTag) ? 0 : 1) + (empty(imageDigest) ? 0 : 1)
    imageDigestLength: length(imageDigest)
  }
}

var serviceBusNamespaceFqdn = '${serviceBusNamespaceName}.servicebus.windows.net'

// The worker is enabled when EITHER store is: it consumes the one billing-events queue for both.
var billingEnabled = googleBillingEnabled || appleBillingEnabled
var billingEventsQueueName = 'billing-events'

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
      {
        name: 'Billing__Events__ServiceBusNamespace'
        value: serviceBusNamespaceFqdn
      }
    ]
  : []

// One env var per allowlisted product id (a for-expression must be a variable's own value).
var appleProductIdEnv = [for (productId, index) in appleProductIds: {
  name: 'Billing__Apple__ProductIds__${index}'
  value: productId
}]

var appleEnv = appleBillingEnabled
    ? concat(
        [
          {
            name: 'Billing__Apple__Enabled'
            value: 'true'
          }
          {
            name: 'Billing__Apple__BundleId'
            value: appleBundleId
          }
          {
            name: 'Billing__Apple__IssuerId'
            value: appleIssuerId
          }
          {
            name: 'Billing__Apple__KeyId'
            value: appleKeyId
          }
          {
            name: 'Billing__Apple__AcceptSandbox'
            value: string(appleAcceptSandbox)
          }
          {
            name: 'Billing__Apple__PrivateKeyPem'
            secretRef: 'apple-iap-private-key'
          }
          {
            name: 'Billing__Apple__AccountTokenKey'
            secretRef: 'apple-account-token-key'
          }
          {
            name: 'Billing__Apple__HandleEncryptionKey'
            secretRef: 'apple-handle-key'
          }
          {
            name: 'Billing__Events__ServiceBusNamespace'
            value: serviceBusNamespaceFqdn
          }
        ],
        appleProductIdEnv
      )
    : []

// Only an enabled worker scales on the queue; a disabled one has nothing to consume, so it runs minReplicas (0 in dev: none at all).
var queueScaleRules = billingEnabled
  ? [
      {
        name: 'billing-events'
        custom: {
          type: 'azure-servicebus'
          metadata: {
            namespace: serviceBusNamespaceName
            queueName: billingEventsQueueName
            messageCount: string(messagesPerReplica)
          }
          identity: billingIdentityResourceId
        }
      }
    ]
  : []

// Fail-closed: with billing enabled, an empty required setting stops the deployment during validation
// (shared with the API - see ../app/billing-settings-guard.bicep) instead of deploying a worker that
// cannot start.
module billingSettingsGuard '../app/billing-settings-guard.bicep' = if (googleBillingEnabled) {
  name: 'juple-${environmentName}-worker-billing-settings-guard'
  params: {
    googleProductId: googleProductId
    googleBasePlanId: googleBasePlanId
    googlePubSubAudience: googlePubSubAudience
    googlePushServiceAccountEmail: googlePushServiceAccountEmail
    billingKeyVaultUri: billingKeyVaultUri
    billingEventsServiceBusNamespace: serviceBusNamespaceName
  }
}

// The SQL connection string secret: a Key Vault reference (vault mode) or the supplied value (parameter mode).
// Same secret name in both modes, so the env secretRef below never changes.
var sqlConnectionStringSecret = sqlConnectionStringFromKeyVault
  ? {
      name: 'sql-connection-string'
      keyVaultUrl: '${billingKeyVaultUri}secrets/${sqlConnectionStringSecretName}'
      identity: billingIdentityResourceId
    }
  : {
      name: 'sql-connection-string'
      value: sqlConnectionString
    }

// Fail-closed connection string source (see ../app/sql-connection-source-guard.bicep): vault mode needs the vault
// URI and must not also receive a value; parameter mode needs the value. Only 0/1 flags reach the guard.
module sqlConnectionSourceVaultGuard '../app/sql-connection-source-guard.bicep' = if (sqlConnectionStringFromKeyVault) {
  name: 'juple-${environmentName}-billing-worker-sql-source-vault-guard'
  params: {
    #disable-next-line BCP329
    keyVaultUriProvided: empty(billingKeyVaultUri) ? 0 : 1
    #disable-next-line BCP330
    plaintextConnectionStringSupplied: empty(sqlConnectionString) ? 0 : 1
  }
}

module sqlConnectionSourceParameterGuard '../app/sql-connection-source-guard.bicep' = if (!sqlConnectionStringFromKeyVault) {
  name: 'juple-${environmentName}-billing-worker-sql-source-parameter-guard'
  params: {
    #disable-next-line BCP329
    connectionStringSupplied: empty(sqlConnectionString) ? 0 : 1
  }
}

resource billingWorker 'Microsoft.App/containerApps@2025-01-01' = {
  name: containerAppName
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
      activeRevisionsMode: 'Single'
      // No ingress: nothing calls the worker; it only pulls from Service Bus. /health is for the container's own probes.
      registries: [
        {
          server: acrLoginServer
          identity: billingIdentityResourceId
        }
      ]
      // Key Vault references only while enabled: a disabled worker resolves no Google secret at all.
      secrets: concat(
        [
          sqlConnectionStringSecret
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
          : [],
        appleBillingEnabled
            ? [
                {
                  name: 'apple-iap-private-key'
                  keyVaultUrl: '${billingKeyVaultUri}secrets/${applePrivateKeySecretName}'
                  identity: billingIdentityResourceId
                }
                {
                  name: 'apple-account-token-key'
                  keyVaultUrl: '${billingKeyVaultUri}secrets/${appleAccountTokenKeySecretName}'
                  identity: billingIdentityResourceId
                }
                {
                  name: 'apple-handle-key'
                  keyVaultUrl: '${billingKeyVaultUri}secrets/${appleHandleKeySecretName}'
                  identity: billingIdentityResourceId
                }
              ]
            : []
      )
    }
    template: {
      containers: [
        {
          name: 'juple-billing-worker'
          image: containerImage
          // Dockerfile's ENTRYPOINT is kept; this switches Program.cs into the worker mode, which runs no controllers
          // and authenticates no request.
          args: [
            '--run-billing-worker'
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
                name: 'AZURE_CLIENT_ID'
                value: billingIdentityClientId
              }
              {
                name: 'Billing__Google__Enabled'
                value: string(googleBillingEnabled)
              }
              {
                name: 'Billing__Apple__Enabled'
                value: string(appleBillingEnabled)
              }
            ],
            googleEnv,
            appleEnv,
            observabilityEnv
          )
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 8080
              }
              initialDelaySeconds: 10
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        pollingInterval: pollingIntervalSeconds
        cooldownPeriod: cooldownPeriodSeconds
        rules: queueScaleRules
      }
    }
  }
}

output containerAppName string = billingWorker.name
