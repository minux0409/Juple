// Resource-less guard for the Admin Web's runtime configuration (see main.bicep). Its only purpose is the parameter validation
// below: ARM rejects the deployment during template validation - before anything is created or changed - when a value the Admin
// Web needs is missing or malformed. The app itself would only show "관리자 웹 설정이 완료되지 않았습니다." at runtime; this makes the
// mistake visible at deployment instead. Nothing is created and nothing is an output. No value is a secret.
targetScope = 'resourceGroup'

@description('JUPLE_ADMIN_API_BASE_URL is https://host with no path.')
@minValue(1)
#disable-next-line no-unused-params
param apiBaseUrlIsHttpsOrigin int

@description('JUPLE_ADMIN_ENTRA_AUTHORITY is https://host with no path.')
@minValue(1)
#disable-next-line no-unused-params
param entraAuthorityIsHttpsOrigin int

@description('JUPLE_ADMIN_BASE_URL is https://host with no path.')
@minValue(1)
#disable-next-line no-unused-params
param adminBaseUrlIsHttpsOrigin int

@description('JUPLE_ADMIN_ENTRA_TENANT_ID is a GUID.')
@minValue(1)
#disable-next-line no-unused-params
param entraTenantIdIsGuid int

@description('JUPLE_ADMIN_ENTRA_CLIENT_ID (the Admin SPA registration) is a GUID.')
@minValue(1)
#disable-next-line no-unused-params
param entraClientIdIsGuid int

@description('JUPLE_ADMIN_ENTRA_API_SCOPE is api://<api app id>/access_as_user.')
@minValue(1)
#disable-next-line no-unused-params
param entraApiScopeIsAccessAsUser int

@description('Production never points at localhost, 127.0.0.1, a dev. host or the Dev tenant (jupledev).')
@minValue(1)
#disable-next-line no-unused-params
param noLocalOrDevHostInProduction int

@description('JUPLE_ADMIN_BUILD_VERSION (e.g. the commit the image was built from).')
@minLength(1)
@maxLength(64)
#disable-next-line no-unused-params
param buildVersion string

@description('bindCustomDomain=true needs the domain, its existing managed certificate, and JUPLE_ADMIN_BASE_URL = https://<that domain>.')
@minValue(1)
#disable-next-line no-unused-params
param customDomainComplete int
