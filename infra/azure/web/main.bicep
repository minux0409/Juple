// Web entrypoint - resource group scope. Deployed *after* Foundation (../foundation) and *after*
// an image has been pushed to the ACR Foundation created (see ../README.md), same two-phase
// ordering ../app/main.bicep already uses. References Foundation resources purely through the
// parameters below - it never re-declares or re-discovers them.
//
// This is the Public Collection Sharing Web Viewer (apps/web) - a completely separate Container
// App from ../app/main.bicep's Backend API. It needs no database, no Blob Storage, and no secret
// of any kind: it only serves static/SSR pages and calls the Backend's already-public,
// unauthenticated api/v1/public/* surface over plain HTTPS (see apps/web/lib/publicApi.ts). The
// Managed Identity below is reused solely for ACR pull, exactly like ../app/main.bicep - no new
// role assignment is needed or created here (see ../foundation/resources.bicep, unchanged).
targetScope = 'resourceGroup'

@description('Short environment name - must match the Foundation deployment this is layered on top of.')
param environmentName string = 'dev'

param location string = 'koreacentral'

@description('ACR login server - Foundation output "acrLoginServer".')
param acrLoginServer string

@description('Repository name within the ACR. The image must already exist as {acrLoginServer}/{imageRepository}:{imageTag} before this deployment runs - this template never builds or pushes it (see apps/web/Dockerfile). The image itself is environment-independent - it takes no build-time env of any kind, so the exact same tag can be deployed to Dev/Staging/Prod unchanged; only the env values below differ per environment.')
param imageRepository string = 'juple-web'

@description('Image tag to deploy. No default on purpose, same reasoning as ../app/main.bicep: the deployer picks an explicit, already-pushed tag every time.')
param imageTag string

@description('Container Apps Environment resource ID - Foundation output "containerAppsEnvironmentId".')
param containerAppsEnvironmentId string

@description('Container Apps Environment name (not the full resource ID) - Foundation output "containerAppsEnvironmentName". Needed only to address an existing Managed Certificate as a child resource of this Environment (Microsoft.App/managedEnvironments/managedCertificates is looked up by parent+child name, not by a standalone resource ID) - see managedCertificateName below.')
param containerAppsEnvironmentName string

@description('User Assigned Managed Identity resource ID - Foundation output "managedIdentityResourceId". Used for ACR pull only - this app never talks to SQL or Blob Storage, so it needs none of the other role assignments ../app/main.bicep\'s identity also carries.')
param managedIdentityResourceId string

@description('Custom domain hostname bound to this Container App\'s ingress (e.g. "dev.juple.co.kr" for Dev, "juple.co.kr" for Production). The domain must already be verified and DNS-pointed at this Container App (TXT ownership record + CNAME/A, done once outside this template via `az containerapp hostname add`/`bind` - see ../README.md\'s "Web custom domain" section) - this template never performs that binding step itself, it only declares the resulting state so a later Bicep redeploy does not drop it. Microsoft.App/containerApps\' ingress.customDomains is fully replaced (not merged) on every deployment, which is exactly the bug this parameter exists to close. This template is shared by every environment and intentionally carries no per-environment default here - each environment\'s real value lives in its own parameter file (e.g. dev.bicepparam), never in this template, so a Production deployment can never end up referencing a Dev domain by omission. Defaults to "" (no binding, Container Apps\' own default *.azurecontainerapps.io ingress) - the safe, explicit choice for a genuinely new environment with no domain bound yet. Must be set together with managedCertificateName - see hasCustomDomain below.')
param customDomainName string = ''

@description('Name of the existing Managed Certificate resource (Microsoft.App/managedEnvironments/managedCertificates, a child of the Environment named by containerAppsEnvironmentName) that covers customDomainName. This template only references an existing certificate by name - it never creates, renews, or deletes one (Container Apps\' free managed certificate is provisioned once via `az containerapp env certificate create`/the domain-binding flow, outside this template). No per-environment default here either, same reasoning as customDomainName - see dev.bicepparam for Dev\'s real value. Must be set together with customDomainName (both empty, or both set).')
param managedCertificateName string = ''

@description('Backend Public API origin (api/v1/public/* only - see apps/web/lib/publicApi.ts) - a genuine runtime env var (JUPLE_API_BASE_URL, never NEXT_PUBLIC_*), read fresh by the running container, not frozen into the image at `docker build` time. Not a secret - the same anonymous, unauthenticated surface apps/mobile itself calls. No default on purpose, unlike the four values below: a meaningful value always exists for any real deployment (e.g. ../app/main.bicep\'s own containerAppFqdn output), unlike the store/Team ID values, which genuinely may not exist yet.')
param apiBaseUrl string

@description('Google Play Store listing URL for the "install Juple" CTA (see apps/web/lib/storeConfig.ts) - a genuine runtime env var (GOOGLE_PLAY_URL, never NEXT_PUBLIC_*). No real listing exists yet (see docs/architecture.md); leave empty until one does - storeConfig.ts already treats an empty value as "not configured" (CTA hidden entirely), never a fabricated placeholder.')
param googlePlayUrl string = ''

@description('Apple App Store listing URL for the same CTA - see googlePlayUrl\'s own description; same "leave empty, never fabricate" rule.')
param appStoreUrl string = ''

@description('Apple Smart App Banner\'s numeric App Store id (e.g. "123456789", no "id" prefix - see apps/web/lib/storeConfig.ts and page.tsx\'s generateMetadata). Same "leave empty, never fabricate" rule as appStoreUrl.')
param appStoreAppId string = ''

@description('iOS Universal Links appID ("<TeamID>.com.juple.app") - see apps/web/app/.well-known/apple-app-site-association/route.ts. No Apple Developer Team ID exists yet (see docs/architecture.md); leave empty until one does - the route itself already treats an empty value as "not configured" (404), never a fabricated placeholder.')
param iosAppId string = ''

@description('Comma-separated SHA-256 fingerprints of the certificate that actually signs the released Android APK/AAB - see apps/web/app/.well-known/assetlinks.json/route.ts. Leave empty until Play App Signing is enabled and a real fingerprint is known; the route already treats an empty value as "not configured" (404).')
param androidAssetlinksSha256Fingerprints string = ''

@description('Scale-to-zero by default - same Dev cost posture as ../app/main.bicep. The first request after idle pays a cold-start cost; raise minReplicas to 1 if that proves disruptive.')
param minReplicas int = 0

@description('Kept small on purpose, same reasoning as ../app/main.bicep - a personal Dev environment has no horizontal-scale need yet.')
param maxReplicas int = 1

@description('Smallest Consumption-plan cpu/memory pairing, same as ../app/main.bicep.')
param containerCpu string = '0.25'
param containerMemory string = '0.5Gi'

var containerAppName = 'ca-juple-web-${environmentName}'
var containerImage = '${acrLoginServer}/${imageRepository}:${imageTag}'

// Both-or-neither: a custom domain binding is meaningless without the certificate that covers it,
// and vice versa. An environment with neither yet (a brand new environment, or Dev before its
// first domain was bound) deploys with an empty customDomains array - Container Apps' own default,
// no different from before this parameter existed.
var hasCustomDomain = !empty(customDomainName) && !empty(managedCertificateName)
var managedCertificateResourceId = hasCustomDomain
  ? resourceId('Microsoft.App/managedEnvironments/managedCertificates', containerAppsEnvironmentName, managedCertificateName)
  : ''

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
      // External: this is the public-facing Web Viewer, reachable from any browser/Android App
      // Links/iOS Universal Links resolver with no VPN. HTTPS is terminated by Container Apps' own
      // ingress - either the default *.azurecontainerapps.io managed certificate, or, once
      // customDomainName/managedCertificateName are set, the existing Managed Certificate declared
      // below. The container behind it only ever speaks plain HTTP on targetPort 3000 (see
      // apps/web/Dockerfile's PORT=3000) either way.
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        // Declared here (not left to a one-off `az containerapp hostname add` CLI call) because
        // ingress.customDomains is fully replaced - not merged - on every deployment of this
        // resource. A binding added only via CLI therefore disappears on the next plain Bicep
        // redeploy (e.g. a runtime env change) unless the binding is also expressed in the
        // template that owns this resource, which is what this does.
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
      // ACR pull via the Managed Identity's AcrPull role (granted in ../foundation/resources.bicep,
      // same identity ../app/main.bicep already reuses for the same purpose) - no username/password
      // secret of any kind.
      registries: [
        {
          server: acrLoginServer
          identity: managedIdentityResourceId
        }
      ]
      // No secrets - this app holds no database credential, no Storage key, no API credential.
    }
    template: {
      containers: [
        {
          name: 'juple-web'
          image: containerImage
          resources: {
            cpu: json(containerCpu)
            memory: containerMemory
          }
          env: [
            {
              // Read at request time by app/c/[publicId]/page.tsx (and threaded from there as a
              // prop into the Client Component that does the "load more" fetch - see
              // ItemList.tsx) - a genuine runtime value, never NEXT_PUBLIC_*, never inlined at
              // `docker build` time. This is what lets the exact same image be deployed to
              // Dev/Staging/Prod unchanged.
              name: 'JUPLE_API_BASE_URL'
              value: apiBaseUrl
            }
            {
              // Read at request time by lib/storeConfig.ts. Empty behaves identically to "unset"
              // (storeConfig.ts's own `|| undefined`), so always safe to pass through as-is.
              name: 'GOOGLE_PLAY_URL'
              value: googlePlayUrl
            }
            {
              name: 'APP_STORE_URL'
              value: appStoreUrl
            }
            {
              name: 'APP_STORE_APP_ID'
              value: appStoreAppId
            }
            {
              // Read at request time by app/.well-known/apple-app-site-association/route.ts - a
              // genuine runtime value (confirmed via `next build`'s own route report, which lists
              // this route "ƒ Dynamic"). An empty value behaves identically to "unset" (the
              // route's own `!appId` check), so this is always safe to pass through as-is, even
              // before a real Team ID exists.
              name: 'IOS_APP_ID'
              value: iosAppId
            }
            {
              // Same runtime reasoning as IOS_APP_ID above, for
              // app/.well-known/assetlinks.json/route.ts. Empty behaves identically to "unset".
              name: 'ANDROID_ASSETLINKS_SHA256_FINGERPRINTS'
              value: androidAssetlinksSha256Fingerprints
            }
          ]
          probes: [
            {
              // /robots.txt (app/robots.ts) is a static, always-200 route that touches neither the
              // Backend Public API nor any env var - a stable liveness/readiness target that says
              // nothing about the Backend's own health, exactly the same separation of concerns as
              // ../app/main.bicep's own /health probe for the API.
              type: 'Liveness'
              httpGet: {
                path: '/robots.txt'
                port: 3000
              }
              initialDelaySeconds: 10
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/robots.txt'
                port: 3000
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
output containerAppUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
