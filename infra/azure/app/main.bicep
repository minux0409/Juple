// App entrypoint - resource group scope. Deployed *after* Foundation (../foundation) and *after*
// an image has been pushed to the ACR Foundation created (see ../README.md). References Foundation
// resources purely through the parameters below (Foundation's own deployment outputs) - it never
// re-declares or re-discovers them, so this file has no implicit ordering dependency on Foundation
// beyond "run it first and pass its outputs in here".
targetScope = 'resourceGroup'

@description('Short environment name - must match the Foundation deployment this is layered on top of.')
param environmentName string = 'dev'

param location string = 'koreacentral'

@description('ACR login server - Foundation output "acrLoginServer".')
param acrLoginServer string

@description('Repository name within the ACR. The image must already exist as {acrLoginServer}/{imageRepository}:{imageTag} before this deployment runs - this template never builds or pushes it.')
param imageRepository string = 'juple-api'

@description('Image tag to deploy. No default on purpose - this template does not decide a floating-tag (e.g. "latest") strategy; the deployer picks an explicit, already-pushed tag every time.')
param imageTag string

@description('Container Apps Environment resource ID - Foundation output "containerAppsEnvironmentId".')
param containerAppsEnvironmentId string

@description('Container Apps Environment name (not the full resource ID) - Foundation output "containerAppsEnvironmentName". Needed only to address an existing Managed Certificate as a child resource of this Environment (Microsoft.App/managedEnvironments/managedCertificates is looked up by parent+child name, not by a standalone resource ID) - see managedCertificateName below. Unused when no custom domain is bound (see hasCustomDomain).')
param containerAppsEnvironmentName string

@description('User Assigned Managed Identity resource ID - Foundation output "managedIdentityResourceId". Used both for ACR pull and for the running app to reach Blob Storage via DefaultAzureCredential.')
param managedIdentityResourceId string

@description('User Assigned Managed Identity client ID - Foundation output "managedIdentityClientId". Not a secret (an identifier, not a credential). Passed through as AZURE_CLIENT_ID so the container\'s DefaultAzureCredential() - which takes no options in code (see BlobServiceClientFactory.cs) - resolves this specific identity rather than probing ambiguously; AZURE_CLIENT_ID is one of the environment variables DefaultAzureCredential\'s ManagedIdentityCredential reads on its own, so this requires no C# change.')
param managedIdentityClientId string

@description('Full ASP.NET Core SQL connection string, credentials included. Never put a real value in a checked-in parameter file - supply it at deploy time (e.g. from a local environment variable the deploy command reads). Stored only as a Container Apps secret; never exposed as a plain env var or a template output. Foundation deliberately does not hand this back as an output either - the deployer assembles it from Foundation\'s sqlServerFqdn output plus whatever admin credentials they supplied to that deployment.')
@secure()
param sqlConnectionString string

@description('Base64-encoded 32-byte AES-256-GCM key for Public Collection Sharing cursor encryption (see PublicCollectionItemPageCursorCodec) - Backend fails startup outright if this is absent or does not decode to exactly 32 bytes (see README.md\'s own local dev setup notes for the same fail-fast). Never put a real value in a checked-in parameter file. Must stay the same value across redeployments/revisions - rotating it invalidates every public cursor already handed out (an in-flight "load more" page simply fails to decode, not a data-loss issue, but a needless disruption for anyone mid-scroll).')
@secure()
param publicCollectionCursorEncryptionKey string

@description('Base64-encoded 32-byte key for Collection unlock grants (see CollectionUnlockTokenProtector) - the short-lived tokens issued after the password of a locked Collection is entered, in the app and on the public share page. Backend fails startup outright if this is absent or does not decode to exactly 32 bytes; there is no fallback to any other key. Must be its own value, never the cursor key above. Never put a real value in a checked-in parameter file. Rotating it only invalidates grants already handed out (people re-enter the password) - no stored data depends on it. Not needed by the one-shot Jobs, which exit before this is validated.')
@secure()
param collectionUnlockGrantEncryptionKey string

@description('Base64-encoded 32-byte key that seals Collection share passwords so their Owner can see them again (AES-256-GCM, see CollectionSharePasswordProtector) - the API fails startup outright if this is absent or does not decode to exactly 32 bytes; there is no fallback to any other key. Its own value, never any other key here, and never shared between environments (Production gets its own). Never put a real value in a checked-in parameter file. NOT freely rotatable: stored ciphertexts are sealed with it and only one active key is supported (no keyring) - a different value makes every existing share password unreadable to its Owner (409 sharePasswordUnreadable until they set a new one; recipients are unaffected, they are checked against a separate hash). Every redeploy must therefore pass the SAME value that is already live - there is no "omitted means keep the current one": the Container App secret is written from this parameter on every deployment. Not needed by the one-shot Jobs, which exit before it is validated - API only.')
@secure()
param collectionSharePasswordEncryptionKey string

@description('Blob service endpoint URI - Foundation output "storageBlobServiceUri". No Storage key is ever used; the app authenticates via managedIdentityResourceId (see BlobServiceClientFactory.cs).')
param storageBlobServiceUri string

param blobContainerName string = 'item-images'

@description('Microsoft Entra External ID config - all public OAuth identifiers, not secrets (already committed as such in backend/src/Juple.Api/appsettings.Development.json for Dev). No default on purpose - this template used to default these three to the Dev tenant, which meant a Production deployment that forgot to override them would silently authenticate against the Dev tenant instead of failing (the same class of bug ../web/main.bicep\'s own customDomainName/managedCertificateName fix already closed for custom domains - see ../README.md). Every environment now states its own real value explicitly in its own parameter file (e.g. dev.bicepparam), never inherited from this template.')
param entraInstance string
param entraTenantId string
param entraClientId string

@description('The API scope name this Backend requires (see Program.cs\'s RequiredScope validation) - not tied to a specific tenant the way instance/tenantId/clientId are, so it keeps a default here. Override if a future environment\'s App Registration exposes a differently-named scope.')
param entraRequiredScope string = 'access_as_user'

@description('Public Web Viewer origin (PublicWebOptions.BaseUrl) - CollectionsController composes every share URL server-side as "{this}/c/{PublicId}" (see CollectionsController.ToShareResponse), and the same value also scopes api/v1/public/*\'s CORS policy (see Program.cs). Not a secret - a public URL. Defaults to empty, the same safe no-op appsettings.json\'s own "" default already means (CORS allows no origins; share URLs compose with an empty origin) - the real Public Web origin does not exist yet (no production domain - see ../README.md and ../web/main.bicep\'s own "no custom domain yet" note), so this must be supplied explicitly once a real Web Container App/domain exists, e.g. ../web/main.bicep\'s own containerAppUrl output before a custom domain, or the real domain after one is bound.')
param publicWebBaseUrl string = ''

@description('MobileVersionPolicy (docs/architecture.md "App update policy"): the newest Android BUILD (versionCode) available in Google Play. 0 = no policy (nobody is prompted). Operations rule: never set a build here before that build can actually be downloaded from the store. Not a secret.')
@minValue(0)
param mobileAndroidLatestBuild int = 0

@description('The oldest Android build still allowed to run - an installed build below it is told to update (forced). 0 = nothing is forced. Must not exceed mobileAndroidLatestBuild (the API refuses to start otherwise). Raise it only when older builds are unsafe or incompatible - never automatically to the latest build.')
@minValue(0)
param mobileAndroidMinimumSupportedBuild int = 0

@description('Optional https Play Store URL. Empty: the app falls back to its own Play listing. Only emitted when non-empty.')
param mobileAndroidStoreUrl string = ''

@description('iOS counterparts (iOS is not released yet - leave 0 / 0 / empty). iOS needs the real App Store URL once a build exists; no id is invented here.')
@minValue(0)
param mobileIosLatestBuild int = 0

@minValue(0)
param mobileIosMinimumSupportedBuild int = 0

param mobileIosStoreUrl string = ''

@description('Application Insights connection string (../monitoring/main.bicep output "applicationInsightsConnectionString"). Empty (default) = not wired. NOTE: the backend has no Application Insights / OpenTelemetry SDK yet, so this only sets APPLICATIONINSIGHTS_CONNECTION_STRING and is inert until instrumentation is added.')
param applicationInsightsConnectionString string = ''

@description('Custom domain hostname bound to this Container App\'s ingress (e.g. "api.juple.co.kr" for Production - Dev has none yet). The domain must already be verified and DNS-pointed at this Container App (TXT ownership record + CNAME/A, done once outside this template via `az containerapp hostname add`/`bind` - see ../web/main.bicep\'s own customDomainName for the identical pattern already in production use there, and ../README.md\'s "Web custom domain" section for the incident that motivated it). This template never performs that binding step itself, it only declares the resulting state so a later Bicep redeploy does not drop it - Microsoft.App/containerApps\' ingress.customDomains is fully replaced (not merged) on every deployment. Shared by every environment and intentionally carries no per-environment default here - each environment\'s real value lives in its own parameter file (e.g. dev.bicepparam), never in this template, so a Production deployment can never end up referencing a Dev domain by omission. Defaults to "" (no binding, Container Apps\' own default *.azurecontainerapps.io ingress). Must be set together with managedCertificateName - see hasCustomDomain below.')
param customDomainName string = ''

@description('Name of the existing Managed Certificate resource (Microsoft.App/managedEnvironments/managedCertificates, a child of the Environment named by containerAppsEnvironmentName) that covers customDomainName. This template only references an existing certificate by name - it never creates, renews, or deletes one (Container Apps\' free managed certificate is provisioned once via `az containerapp env certificate create`/the domain-binding flow, outside this template). No per-environment default here either, same reasoning as customDomainName. Must be set together with customDomainName (both empty, or both set).')
param managedCertificateName string = ''

@description('Service Bus namespace FQDN - Foundation output "serviceBusNamespaceFqdn". Not a secret. Empty = no fast path: the API still records every notification event in SQL and the push-dispatch Job delivers them on its schedule (the behavior before Service Bus). Set it once the namespace exists and the identity has its queue roles.')
param serviceBusNamespaceFqdn string = ''

@description('Scale-to-zero by default - the cheapest Dev option. The first request after idle pays a cold-start cost; raise minReplicas to 1 if that proves disruptive.')
param minReplicas int = 0

@description('Kept small on purpose - a personal Dev/dogfooding environment has no horizontal-scale need yet.')
param maxReplicas int = 1

@description('Smallest Consumption-plan cpu/memory pairing (0.25 cpu : 0.5Gi is one of the platform\'s allowed combinations).')
param containerCpu string = '0.25'
param containerMemory string = '0.5Gi'

var containerAppName = 'ca-juple-api-${environmentName}'

// ASPNETCORE_ENVIRONMENT, from environmentName (no separate parameter): "Production" for prod,
// "AzureDevelopment" for every other Azure environment - and never "Development" anywhere in Azure
// (Program.cs maps /openapi only for the literal "Development"). Today nothing else in the API
// reads the name and there is no appsettings.{name}.json for either, so the two behave the same;
// the split keeps Production from running under a Dev-looking name and leaves room for
// Production-only configuration. The one-shot Jobs set none (.NET's own default, "Production").
var aspNetCoreEnvironment = environmentName == 'prod' ? 'Production' : 'AzureDevelopment'
var containerImage = '${acrLoginServer}/${imageRepository}:${imageTag}'

// Both-or-neither: a custom domain binding is meaningless without the certificate that covers it,
// and vice versa. An environment with neither yet (Dev today) deploys with an empty customDomains
// array - Container Apps' own default, no different from before this parameter existed. Identical
// pattern to ../web/main.bicep's own hasCustomDomain.
// ---- Google Play billing (R39-B1). Everything here is OFF by default: with googleBillingEnabled false the API gets no
// billing secret and no billing setting, and starts exactly as before. Secrets are never parameters - they are Azure Key Vault
// references resolved through the API's Managed Identity (the vault itself is ../foundation/billing.bicep); only their NAMES are
// parameters. The product and base plan stay empty until they exist in Play Console (R39-B2).
@description('Turns on Google Play billing in the API (catalog / verify / restore / RTDN). Requires billingKeyVaultUri and the settings below.')
param googleBillingEnabled bool = false

@description('Key Vault URI with trailing slash - ../foundation/billing.bicep output "keyVaultUri". Needed only when googleBillingEnabled or billingProgramEnabled.')
param billingKeyVaultUri string = ''

@description('The ONE allowlisted subscription product / base plan (proposed: juple_monthly / monthly - confirmed in R39-B2, never guessed).')
param googleProductId string = ''
param googleBasePlanId string = ''

@description('Pub/Sub push audience (the RTDN webhook URL the subscription is configured with) and the push service account that signs the OIDC token.')
param googlePubSubAudience string = ''
param googlePushServiceAccountEmail string = ''

@description('Key Vault secret NAMES (never values) - see ../foundation/billing.bicep for what each holds.')
param googleServiceAccountSecretName string = 'google-play-service-account'
param googlePurchaseTokenKeySecretName string = 'google-purchase-token-key'
param googleAccountHashKeySecretName string = 'google-account-hash-key'
param trialIdentityHashKeySecretName string = 'trial-identity-hash-key'

@description('Fully-qualified Service Bus namespace for the billing-events wake-up (usually the same as serviceBusNamespaceFqdn). Empty = no wake-up; the reconcile Job sweep still processes every event.')
param billingEventsServiceBusNamespace string = ''

@description('The subscription program switch (trial + entitlement). Stays false until the product launch: nothing is blocked, no trial starts. Turning it on additionally needs billingProgramStartAtUtc and the trial-identity-hash-key secret.')
param billingProgramEnabled bool = false
param billingProgramStartAtUtc string = ''

var billingSecrets = concat(
  googleBillingEnabled
    ? [
        {
          name: 'google-play-credential'
          keyVaultUrl: '${billingKeyVaultUri}secrets/${googleServiceAccountSecretName}'
          identity: managedIdentityResourceId
        }
        {
          name: 'google-purchase-token-key'
          keyVaultUrl: '${billingKeyVaultUri}secrets/${googlePurchaseTokenKeySecretName}'
          identity: managedIdentityResourceId
        }
        {
          name: 'google-account-hash-key'
          keyVaultUrl: '${billingKeyVaultUri}secrets/${googleAccountHashKeySecretName}'
          identity: managedIdentityResourceId
        }
      ]
    : [],
  billingProgramEnabled
    ? [
        {
          name: 'trial-identity-hash-key'
          keyVaultUrl: '${billingKeyVaultUri}secrets/${trialIdentityHashKeySecretName}'
          identity: managedIdentityResourceId
        }
      ]
    : []
)

var billingEnv = concat(
  googleBillingEnabled
    ? [
        {
          name: 'Billing__Google__Enabled'
          value: 'true'
        }
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
          name: 'Billing__Google__PubSub__Audience'
          value: googlePubSubAudience
        }
        {
          name: 'Billing__Google__PubSub__PushServiceAccountEmail'
          value: googlePushServiceAccountEmail
        }
        {
          name: 'Billing__Events__ServiceBusNamespace'
          value: billingEventsServiceBusNamespace
        }
      ]
    : [],
  billingProgramEnabled
    ? [
        {
          name: 'Billing__ProgramEnabled'
          value: 'true'
        }
        {
          name: 'Billing__ProgramStartAtUtc'
          value: billingProgramStartAtUtc
        }
        {
          name: 'Billing__TrialIdentityHashKey'
          secretRef: 'trial-identity-hash-key'
        }
      ]
    : []
)

var mobileVersionPolicyEnv = concat(
  [
    {
      name: 'MobileVersionPolicy__Android__LatestBuild'
      value: string(mobileAndroidLatestBuild)
    }
    {
      name: 'MobileVersionPolicy__Android__MinimumSupportedBuild'
      value: string(mobileAndroidMinimumSupportedBuild)
    }
    {
      name: 'MobileVersionPolicy__Ios__LatestBuild'
      value: string(mobileIosLatestBuild)
    }
    {
      name: 'MobileVersionPolicy__Ios__MinimumSupportedBuild'
      value: string(mobileIosMinimumSupportedBuild)
    }
  ],
  empty(mobileAndroidStoreUrl)
    ? []
    : [
        {
          name: 'MobileVersionPolicy__Android__StoreUrl'
          value: mobileAndroidStoreUrl
        }
      ],
  empty(mobileIosStoreUrl)
    ? []
    : [
        {
          name: 'MobileVersionPolicy__Ios__StoreUrl'
          value: mobileIosStoreUrl
        }
      ]
)

var observabilityEnv = empty(applicationInsightsConnectionString)
  ? []
  : [
      {
        name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
        value: applicationInsightsConnectionString
      }
    ]

var hasCustomDomain = !empty(customDomainName) && !empty(managedCertificateName)
var managedCertificateResourceId = hasCustomDomain
  ? resourceId('Microsoft.App/managedEnvironments/managedCertificates', containerAppsEnvironmentName, managedCertificateName)
  : ''

// Fail-closed: with billing enabled, an empty required setting stops the deployment during validation
// (see billing-settings-guard.bicep) instead of producing an API that cannot start - or, worse, one that
// quietly runs without billing.
module billingSettingsGuard 'billing-settings-guard.bicep' = if (googleBillingEnabled) {
  name: 'juple-${environmentName}-api-billing-settings-guard'
  params: {
    googleProductId: googleProductId
    googleBasePlanId: googleBasePlanId
    googlePubSubAudience: googlePubSubAudience
    googlePushServiceAccountEmail: googlePushServiceAccountEmail
    billingKeyVaultUri: billingKeyVaultUri
    billingEventsServiceBusNamespace: billingEventsServiceBusNamespace
  }
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentityResourceId}': {}
    }
  }
  properties: {
    environmentId: containerAppsEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      // External: an Android phone over the internet must reach this with no VPN. HTTPS is
      // terminated by Container Apps' own ingress - either the default *.azurecontainerapps.io
      // managed certificate, or, once customDomainName/managedCertificateName are set, the
      // existing Managed Certificate declared below (same pattern as ../web/main.bicep). The
      // container behind it only ever speaks plain HTTP on targetPort 8080 either way (see
      // backend/src/Juple.Api/Dockerfile).
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
        // Declared here (not left to a one-off `az containerapp hostname add` CLI call) because
        // ingress.customDomains is fully replaced - not merged - on every deployment of this
        // resource. A binding added only via CLI therefore disappears on the next plain Bicep
        // redeploy (e.g. a runtime env change) unless the binding is also expressed in the
        // template that owns this resource - see ../README.md's "Web custom domain" section for
        // the incident this exact pattern (copied from ../web/main.bicep) was introduced to fix.
        customDomains: hasCustomDomain
          ? [
              {
                name: customDomainName
                bindingType: 'SniEnabled'
                certificateId: managedCertificateResourceId
              }
            ]
          : []
      }
      // ACR pull via the Managed Identity's AcrPull role (granted in ../foundation/resources.bicep)
      // - no username/password secret of any kind.
      registries: [
        {
          server: acrLoginServer
          identity: managedIdentityResourceId
        }
      ]
      secrets: concat(
        [
          {
            name: 'sql-connection-string'
            value: sqlConnectionString
          }
          {
            name: 'public-collection-cursor-key'
            value: publicCollectionCursorEncryptionKey
          }
          {
            name: 'collection-unlock-grant-key'
            value: collectionUnlockGrantEncryptionKey
          }
          {
            name: 'collection-share-password-key'
            value: collectionSharePasswordEncryptionKey
          }
        ],
        billingSecrets
      )
    }
    template: {
      containers: [
        {
          name: 'juple-api'
          image: containerImage
          resources: {
            cpu: json(containerCpu)
            memory: containerMemory
          }
          env: concat([
            {
              // Never "Development" - see aspNetCoreEnvironment above.
              name: 'ASPNETCORE_ENVIRONMENT'
              value: aspNetCoreEnvironment
            }
            {
              name: 'ConnectionStrings__JupleDatabase'
              secretRef: 'sql-connection-string'
            }
            {
              name: 'PublicCollectionCursor__EncryptionKey'
              secretRef: 'public-collection-cursor-key'
            }
            {
              name: 'CollectionUnlockGrant__EncryptionKey'
              secretRef: 'collection-unlock-grant-key'
            }
            {
              name: 'CollectionSharePassword__EncryptionKey'
              secretRef: 'collection-share-password-key'
            }
            {
              // Deliberately no ConnectionStrings__BlobStorage - its absence is what makes
              // BlobServiceClientFactory.cs fall through to the ServiceUri + DefaultAzureCredential
              // (Managed Identity) path instead of a Shared Key connection string.
              name: 'BlobStorage__ServiceUri'
              value: storageBlobServiceUri
            }
            {
              // Not a secret - a public identifier (see managedIdentityClientId's description
              // above). Never pair this with AZURE_TENANT_ID/AZURE_CLIENT_SECRET - those belong to
              // Service Principal auth, which this app does not use.
              name: 'AZURE_CLIENT_ID'
              value: managedIdentityClientId
            }
            {
              name: 'BlobStorage__ContainerName'
              value: blobContainerName
            }
            {
              name: 'Authentication__EntraExternalId__Instance'
              value: entraInstance
            }
            {
              name: 'Authentication__EntraExternalId__TenantId'
              value: entraTenantId
            }
            {
              name: 'Authentication__EntraExternalId__ClientId'
              value: entraClientId
            }
            {
              name: 'Authentication__EntraExternalId__RequiredScope'
              value: entraRequiredScope
            }
            {
              // Not a secret. The API only SENDS to it (a post-commit wake-up signal per change, ids
              // only, bounded) - it never receives, and never calls FCM/APNs. Empty = no fast path.
              name: 'NotificationPipeline__ServiceBusNamespace'
              value: serviceBusNamespaceFqdn
            }
            {
              // Not a secret. Empty is a safe no-op (see publicWebBaseUrl's own description) -
              // always passed through as-is rather than conditionally omitted, so a redeploy
              // without an explicit value predictably resets to "unconfigured" instead of silently
              // keeping whatever a previous revision happened to have.
              name: 'PublicWeb__BaseUrl'
              value: publicWebBaseUrl
            }
          ], mobileVersionPolicyEnv, billingEnv, observabilityEnv)
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
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 8080
              }
              initialDelaySeconds: 5
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
}

output containerAppName string = containerApp.name
output containerAppFqdn string = containerApp.properties.configuration.ingress.fqdn
output containerAppHealthUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}/health'
