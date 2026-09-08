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

@description('Blob service endpoint URI - Foundation output "storageBlobServiceUri". No Storage key is ever used; the app authenticates via managedIdentityResourceId (see BlobServiceClientFactory.cs).')
param storageBlobServiceUri string

param blobContainerName string = 'item-images'

@description('Microsoft Entra External ID config - all public OAuth identifiers, not secrets (already committed as such in backend/src/Juple.Api/appsettings.Development.json). Defaults match the existing Dev tenant; override for a future Staging/Production tenant.')
param entraInstance string = 'https://jupledev.ciamlogin.com/'
param entraTenantId string = 'd2e79a05-cf5f-43ab-86d2-717e025a74b1'
param entraClientId string = '14bcc3b7-7b37-4051-9e40-63cc2a5ffc8b'
param entraRequiredScope string = 'access_as_user'

@description('Public Web Viewer origin (PublicWebOptions.BaseUrl) - CollectionsController composes every share URL server-side as "{this}/c/{PublicId}" (see CollectionsController.ToShareResponse), and the same value also scopes api/v1/public/*\'s CORS policy (see Program.cs). Not a secret - a public URL. Defaults to empty, the same safe no-op appsettings.json\'s own "" default already means (CORS allows no origins; share URLs compose with an empty origin) - the real Public Web origin does not exist yet (no production domain - see ../README.md and ../web/main.bicep\'s own "no custom domain yet" note), so this must be supplied explicitly once a real Web Container App/domain exists, e.g. ../web/main.bicep\'s own containerAppUrl output before a custom domain, or the real domain after one is bound.')
param publicWebBaseUrl string = ''

@description('Scale-to-zero by default - the cheapest Dev option. The first request after idle pays a cold-start cost; raise minReplicas to 1 if that proves disruptive.')
param minReplicas int = 0

@description('Kept small on purpose - a personal Dev/dogfooding environment has no horizontal-scale need yet.')
param maxReplicas int = 1

@description('Smallest Consumption-plan cpu/memory pairing (0.25 cpu : 0.5Gi is one of the platform\'s allowed combinations).')
param containerCpu string = '0.25'
param containerMemory string = '0.5Gi'

var containerAppName = 'ca-juple-api-${environmentName}'
var containerImage = '${acrLoginServer}/${imageRepository}:${imageTag}'

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
      // terminated by Container Apps' own managed ingress/certificate - the container behind it
      // only ever speaks plain HTTP on targetPort 8080 (see backend/src/Juple.Api/Dockerfile).
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      // ACR pull via the Managed Identity's AcrPull role (granted in ../foundation/resources.bicep)
      // - no username/password secret of any kind.
      registries: [
        {
          server: acrLoginServer
          identity: managedIdentityResourceId
        }
      ]
      secrets: [
        {
          name: 'sql-connection-string'
          value: sqlConnectionString
        }
        {
          name: 'public-collection-cursor-key'
          value: publicCollectionCursorEncryptionKey
        }
      ]
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
          env: [
            {
              // Never "Development" - Program.cs only maps /openapi when
              // Environment.IsDevelopment() is true, which checks for the literal string
              // "Development". "AzureDevelopment" deliberately does not match that, so an
              // internet-facing Azure Dev backend never exposes Development-only behavior. No
              // C# change was needed to get this property, and none was made.
              name: 'ASPNETCORE_ENVIRONMENT'
              value: 'AzureDevelopment'
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
              // Not a secret. Empty is a safe no-op (see publicWebBaseUrl's own description) -
              // always passed through as-is rather than conditionally omitted, so a redeploy
              // without an explicit value predictably resets to "unconfigured" instead of silently
              // keeping whatever a previous revision happened to have.
              name: 'PublicWeb__BaseUrl'
              value: publicWebBaseUrl
            }
          ]
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
