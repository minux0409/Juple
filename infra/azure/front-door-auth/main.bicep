// Microsoft Entra External ID custom URL domain (https://login.juple.co.kr) - the Azure Front Door in front of the external tenant's
// sign-in endpoint, exactly as Microsoft's "How to enable custom URL domains for External ID" prescribes:
//   Standard tier, no WAF policy, no caching, origin = <tenant>.ciamlogin.com with the SAME value as origin host header,
//   a managed-certificate custom domain, default route enabled.
// The Entra side (verified domain name + Custom URL domain association) is configured in the tenant, not here. The tenant's own
// default domain stays reachable until a separate support request blocks it (only after the custom domain is proven in use).
targetScope = 'resourceGroup'

@description('Short environment name.')
param environmentName string = 'prod'

@description('The external tenant\'s default sign-in host, e.g. jupleprod.ciamlogin.com.')
param originHostName string

@description('The public sign-in host users see.')
param customDomainName string = 'login.juple.co.kr'

var profileName = 'afd-juple-${environmentName}'
var endpointName = 'login-juple-${environmentName}'

resource profile 'Microsoft.Cdn/profiles@2024-02-01' = {
  name: profileName
  location: 'global'
  sku: {
    name: 'Standard_AzureFrontDoor'
  }
}

resource endpoint 'Microsoft.Cdn/profiles/afdEndpoints@2024-02-01' = {
  parent: profile
  name: endpointName
  location: 'global'
  properties: {
    enabledState: 'Enabled'
  }
}

resource originGroup 'Microsoft.Cdn/profiles/originGroups@2024-02-01' = {
  parent: profile
  name: 'default-origin-group'
  properties: {
    loadBalancingSettings: {
      sampleSize: 4
      successfulSamplesRequired: 3
      additionalLatencyInMilliseconds: 50
    }
    healthProbeSettings: {
      probePath: '/'
      probeRequestType: 'HEAD'
      probeProtocol: 'Https'
      probeIntervalInSeconds: 100
    }
    sessionAffinityState: 'Disabled'
  }
}

resource origin 'Microsoft.Cdn/profiles/originGroups/origins@2024-02-01' = {
  parent: originGroup
  name: 'ciam-tenant'
  properties: {
    hostName: originHostName
    // Host name and origin host header must be the same value (Microsoft guidance).
    originHostHeader: originHostName
    httpPort: 80
    httpsPort: 443
    priority: 1
    weight: 1000
    enabledState: 'Enabled'
    enforceCertificateNameCheck: true
  }
}

resource customDomain 'Microsoft.Cdn/profiles/customDomains@2024-02-01' = {
  parent: profile
  name: replace(customDomainName, '.', '-')
  properties: {
    hostName: customDomainName
    tlsSettings: {
      certificateType: 'ManagedCertificate'
      minimumTlsVersion: 'TLS12'
    }
  }
}

resource route 'Microsoft.Cdn/profiles/afdEndpoints/routes@2024-02-01' = {
  parent: endpoint
  name: 'default-route'
  dependsOn: [
    origin
  ]
  properties: {
    customDomains: [
      {
        id: customDomain.id
      }
    ]
    originGroup: {
      id: originGroup.id
    }
    supportedProtocols: [
      'Https'
    ]
    patternsToMatch: [
      '/*'
    ]
    forwardingProtocol: 'HttpsOnly'
    linkToDefaultDomain: 'Enabled'
    httpsRedirect: 'Enabled'
    enabledState: 'Enabled'
  }
}

output endpointHostName string = endpoint.properties.hostName
output customDomainValidationToken string = customDomain.properties.validationProperties.validationToken
output frontDoorId string = profile.properties.frontDoorId
