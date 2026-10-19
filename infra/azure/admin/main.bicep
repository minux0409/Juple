// Admin Web entrypoint - resource group scope. The operator tool apps/admin (docs/admin.md) as its OWN Container App, next to the
// user Web (../web/main.bicep, whose pattern this follows): same Container Apps Environment, same ACR and the same Managed Identity
// for ACR pull only. Like the user Web it holds no secret of any kind - every env value below is a public OAuth/URL identifier
// (a browser app has no client secret), so there is no Key Vault reference and no `secrets` block. Admin rights are never decided
// here: the API checks admin.AdminUsers on every request (JupleAdmin policy).
//
// Deployed after the image exists in the ACR ({acrLoginServer}/juple-admin@{imageDigest}); this template never builds or pushes.
// The custom domain is bound in phases (see docs/admin.md "Production rollout"): deploy with bindCustomDomain=false first, add the
// DNS records Azure returns, create/bind the managed certificate once, then redeploy with bindCustomDomain=true for good.
targetScope = 'resourceGroup'

@description('Short environment name - must match the Foundation deployment this is layered on top of.')
param environmentName string

param location string = 'koreacentral'

@description('ACR login server - Foundation output "acrLoginServer".')
param acrLoginServer string

@description('Repository within the ACR (built from apps/admin/Dockerfile - environment-independent, no build-time env).')
param imageRepository string = 'juple-admin'

@description('Image tag (Dev). No default: the deployer always names an already-pushed image.')
param imageTag string = ''

@description('Immutable image digest ("sha256:" + 64 hex) - Production deploys only a digest. Wins over imageTag when set.')
param imageDigest string = ''

@description('Container Apps Environment resource ID - Foundation output "containerAppsEnvironmentId".')
param containerAppsEnvironmentId string

@description('Container Apps Environment name - needed only to address the existing Managed Certificate as its child resource.')
param containerAppsEnvironmentName string

@description('User Assigned Managed Identity resource ID - used for ACR pull only (the identity already holds AcrPull).')
param managedIdentityResourceId string

@description('Whether the custom domain is bound. false = phase A (only the default *.azurecontainerapps.io ingress, before DNS and the certificate exist). true = the domain and its existing managed certificate are declared, so a redeploy never drops the binding (ingress.customDomains is replaced, not merged, on every deployment). No default on purpose.')
param bindCustomDomain bool

@description('Custom domain of the Admin Web, e.g. admin.juple.co.kr. Required when bindCustomDomain is true.')
param customDomainName string = ''

@description('Name of the existing managed certificate (child of the Environment) that covers customDomainName. Required when bindCustomDomain is true; never guessed - it exists only after the binding flow created it.')
param managedCertificateName string = ''

@description('JUPLE_ADMIN_API_BASE_URL - the Juple API origin, e.g. https://api.juple.co.kr.')
param apiBaseUrl string

@description('JUPLE_ADMIN_ENTRA_AUTHORITY - the External ID authority, e.g. https://juple.ciamlogin.com.')
param entraAuthority string

@description('JUPLE_ADMIN_ENTRA_TENANT_ID - the External ID tenant id (GUID).')
param entraTenantId string

@description('JUPLE_ADMIN_ENTRA_CLIENT_ID - the Admin SPA app registration\'s client id (GUID; a public identifier, not a secret - but supplied by the deployer, never committed).')
param entraClientId string

@description('JUPLE_ADMIN_ENTRA_API_SCOPE - the Juple API scope, api://<api app id>/access_as_user.')
param entraApiScope string

@description('JUPLE_ADMIN_BASE_URL - this app\'s own origin (MSAL redirect https://<host>/auth/callback, sign-out return), e.g. https://admin.juple.co.kr.')
param adminBaseUrl string

@description('JUPLE_ADMIN_BUILD_VERSION - shown on 운영 > 시스템 상태 (e.g. the git commit the image was built from). Not a secret.')
param buildVersion string

@description('Operator-only traffic: scale to zero when idle. The first request after idle pays a cold start (sign-in redirect and API calls are unaffected once warm).')
param minReplicas int = 0
param maxReplicas int = 1

@description('Smallest Consumption-plan pairing - the same as the user Web; the Admin Web is a thin client-rendered app.')
param containerCpu string = '0.25'
param containerMemory string = '0.5Gi'

var containerAppName = 'ca-juple-admin-${environmentName}'
var containerImage = empty(imageDigest)
  ? '${acrLoginServer}/${imageRepository}:${imageTag}'
  : '${acrLoginServer}/${imageRepository}@${imageDigest}'

module imageReferenceGuard '../app/image-reference-guard.bicep' = {
  name: 'juple-${environmentName}-admin-image-reference-guard'
  params: {
    #disable-next-line BCP329
    imageReferenceSupplied: (empty(imageTag) ? 0 : 1) + (empty(imageDigest) ? 0 : 1)
    imageDigestLength: length(imageDigest)
  }
}

// https://host[:port] with nothing after it (no path, query or trailing slash).
func isHttpsOrigin(url string) bool => startsWith(url, 'https://') && length(url) > 8 && !contains(substring(url, 8), '/') && !contains(url, '?') && !contains(url, '#') && !contains(url, '@')

func isLocalOrDevHost(url string) bool => contains(toLower(url), 'localhost') || contains(toLower(url), '127.0.0.1') || contains(toLower(url), '://dev.') || contains(toLower(url), 'jupledev')

func isGuid(value string) bool => length(value) == 36 && length(split(value, '-')) == 5

var isProduction = environmentName == 'prod'

// Fail-closed runtime configuration (admin-config-guard.bicep): every value present and well-formed, https only, and in Production
// never a local or Dev host. A deployment that fails here changes nothing.
module configGuard 'admin-config-guard.bicep' = {
  name: 'juple-${environmentName}-admin-config-guard'
  // 1 = the check passed, 0 = it failed (the guard requires 1).
  params: {
    #disable-next-line BCP329
    apiBaseUrlIsHttpsOrigin: isHttpsOrigin(apiBaseUrl) ? 1 : 0
    #disable-next-line BCP329
    entraAuthorityIsHttpsOrigin: isHttpsOrigin(entraAuthority) ? 1 : 0
    #disable-next-line BCP329
    adminBaseUrlIsHttpsOrigin: isHttpsOrigin(adminBaseUrl) ? 1 : 0
    #disable-next-line BCP329
    entraTenantIdIsGuid: isGuid(entraTenantId) ? 1 : 0
    #disable-next-line BCP329
    entraClientIdIsGuid: isGuid(entraClientId) ? 1 : 0
    #disable-next-line BCP329
    entraApiScopeIsAccessAsUser: startsWith(entraApiScope, 'api://') && endsWith(entraApiScope, '/access_as_user') ? 1 : 0
    #disable-next-line BCP329
    noLocalOrDevHostInProduction: !isProduction || !(isLocalOrDevHost(apiBaseUrl) || isLocalOrDevHost(entraAuthority) || isLocalOrDevHost(adminBaseUrl)) ? 1 : 0
    buildVersion: buildVersion
    #disable-next-line BCP329
    customDomainComplete: !bindCustomDomain || (!empty(customDomainName) && !empty(managedCertificateName) && adminBaseUrl == 'https://${customDomainName}') ? 1 : 0
  }
}

var managedCertificateResourceId = bindCustomDomain
  ? resourceId('Microsoft.App/managedEnvironments/managedCertificates', containerAppsEnvironmentName, managedCertificateName)
  : ''

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  dependsOn: [
    configGuard
    imageReferenceGuard
  ]
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
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        customDomains: bindCustomDomain
          ? [
              {
                name: customDomainName
                bindingType: 'SniEnabled'
                certificateId: managedCertificateResourceId
              }
            ]
          : []
      }
      registries: [
        {
          server: acrLoginServer
          identity: managedIdentityResourceId
        }
      ]
      // No secrets - see the header.
    }
    template: {
      containers: [
        {
          name: 'juple-admin'
          image: containerImage
          resources: {
            cpu: json(containerCpu)
            memory: containerMemory
          }
          // Exactly the names apps/admin/lib/adminConfig.ts reads (ADMIN_CONFIG_ENV), read at request time - never NEXT_PUBLIC_*.
          env: [
            {
              name: 'JUPLE_ADMIN_API_BASE_URL'
              value: apiBaseUrl
            }
            {
              name: 'JUPLE_ADMIN_ENTRA_AUTHORITY'
              value: entraAuthority
            }
            {
              name: 'JUPLE_ADMIN_ENTRA_TENANT_ID'
              value: entraTenantId
            }
            {
              name: 'JUPLE_ADMIN_ENTRA_CLIENT_ID'
              value: entraClientId
            }
            {
              name: 'JUPLE_ADMIN_ENTRA_API_SCOPE'
              value: entraApiScope
            }
            {
              name: 'JUPLE_ADMIN_BASE_URL'
              value: adminBaseUrl
            }
            {
              name: 'JUPLE_ADMIN_BUILD_VERSION'
              value: buildVersion
            }
          ]
          probes: [
            {
              // apps/admin/app/health/route.ts: 200 "ok" from the Next.js process itself - no sign-in, no API call, no configuration.
              type: 'Liveness'
              httpGet: {
                path: '/health'
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
                path: '/health'
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
// The value of the asuid.<host> TXT record that proves domain ownership (the Environment's verification id).
output customDomainVerificationId string = containerApp.properties.customDomainVerificationId
