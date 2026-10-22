// Production parameter values for ./main.bicep - ca-juple-admin-prod (apps/admin, https://admin.juple.co.kr). Same structure as
// ../web/prod.bicepparam: fixed public facts are literals; live / per-deployment values come from the deploying shell through
// readEnvironmentVariable() with NO default, so a missing one fails the build (BCP427) instead of deploying a blank value.
// See docs/admin.md "Production rollout" for the phases and the exact commands. No Azure change happens from this file existing.
using 'main.bicep'

param environmentName = 'prod'
param containerAppsEnvironmentName = 'cae-juple-prod'

// The Production External ID tenant, its authority and the Juple API scope - the same public identifiers the user Web uses
// (../web/prod.bicepparam signedInWeb*), and the Production API / Admin origins.
param entraAuthority = 'https://juple.ciamlogin.com'
param entraTenantId = '9cc10dba-a023-436b-a90b-181829718f38'
param entraApiScope = 'api://a61bc80e-2d14-4ff0-9fd7-bc6a63c8e2a0/access_as_user'
param apiBaseUrl = 'https://api.juple.co.kr'
param adminBaseUrl = 'https://admin.juple.co.kr'
param customDomainName = 'admin.juple.co.kr'

// The "Juple Admin Web (PROD)" SPA registration's client id. A public identifier, not a secret - but deliberately not committed:
// the deployer supplies it from the Entra portal. No default (BCP427 when unset).
param entraClientId = readEnvironmentVariable('JUPLE_ADMIN_ENTRA_CLIENT_ID')

// admin.juple.co.kr is bound (2026-10-19: Gabia CNAME admin + TXT asuid.admin, `az containerapp hostname add/bind --validation-method
// CNAME`). Both are literals now, as ../web/prod.bicepparam does for juple.co.kr, so every redeploy keeps the binding
// (ingress.customDomains is replaced on every deployment). The certificate is the one Azure issued - free, renewed by the platform
// while the DNS records stay in place.
param bindCustomDomain = true
param managedCertificateName = 'mc-cae-juple-prod-admin-juple-co-k-2603'

// Keep one admin replica warm to avoid cold starts (docs/admin.md "Cost").
param minReplicas = 1
param maxReplicas = 1

// Live Foundation / build values - the same resources the user Web uses (rg-juple-prod).
param acrLoginServer = readEnvironmentVariable('JUPLE_ADMIN_PROD_ACR_LOGIN_SERVER')
param containerAppsEnvironmentId = readEnvironmentVariable('JUPLE_ADMIN_PROD_CONTAINER_APPS_ENVIRONMENT_ID')
param managedIdentityResourceId = readEnvironmentVariable('JUPLE_ADMIN_PROD_MANAGED_IDENTITY_RESOURCE_ID')
// Production deploys an IMMUTABLE digest (sha256:<64 hex>) of the image built from a known commit - never a tag.
param imageDigest = readEnvironmentVariable('JUPLE_ADMIN_PROD_IMAGE_DIGEST')
// The commit the image was built from, shown on 운영 > 시스템 상태.
param buildVersion = readEnvironmentVariable('JUPLE_ADMIN_PROD_BUILD_VERSION')
