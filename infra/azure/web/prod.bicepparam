// Production parameter values for ./main.bicep - see ./dev.bicepparam's own header comment for the
// full explanation of why some parameters are literals and others use readEnvironmentVariable().
// Production Foundation/Web do not exist in Azure yet (see ../README.md) - this file exists so the
// eventual first Production deployment has a ready, environment-neutral parameter source to use,
// not because a deployment is imminent. No Azure mutation happens from this file merely existing.
//
// IMPORTANT: unlike dev.bicepparam, the live/per-deployment values below genuinely do not exist
// yet - no Production ACR/Container Apps Environment/Managed Identity has been created, and no
// image has been pushed anywhere for them. These use readEnvironmentVariable() the same as any
// other live/per-deployment value (see dev.bicepparam), which is exactly what makes this fail
// closed: deploying this file today fails immediately with a clear BCP427 "environment variable
// not set" error - it can never silently deploy with a blank or Dev-borrowed value.
using 'main.bicep'

param environmentName = 'prod'

// Matches ../README.md's Naming table pattern `cae-juple-{environmentName}` - a deterministic name
// derived from the naming convention itself, not a guess about a resource that does not exist yet.
param containerAppsEnvironmentName = 'cae-juple-prod'

// No Production custom domain is bound yet - both stay empty together (see main.bicep's own
// hasCustomDomain) until juple.co.kr (the documented canonical Production Web domain - see
// ../README.md) is actually verified and bound via `az containerapp hostname add`/`bind`, the same
// one-time CLI step this file's Dev counterpart documents for dev.juple.co.kr. Once that happens,
// replace these two lines with the real values - never guess a Managed Certificate name in advance.
param customDomainName = 'juple.co.kr'
param managedCertificateName = 'mc-cae-juple-prod-juple-co-kr-2013'

// Confirmed initial Production scale decision (see ../README.md's "Production SKU/scale" section
// for the full reasoning) - a fixed fact about how Production is meant to run, not a live-generated
// or per-deployment value, so a literal here is safe to commit. Unlike API's own Production
// scale (minReplicas=1 - see ../app/prod.bicepparam), the Web Viewer first kept main.bicep's
// scale-to-zero default. Measured on 2026-10-16: juple.co.kr scaled to zero 20+ times a day (cooldown
// 300 s) and the first request after idle took 29 s TTFB (warm 0.08-0.13 s; Next.js itself is ready
// in 0 ms - the wait is the platform's scale-from-zero activation). The landing / legal / share pages
// are the public front door, so Production now keeps one warm replica (minReplicas=1, approved; about
// USD 6 / KRW 8,000 a month at the idle rate for 0.25 vCPU + 0.5 GiB). maxReplicas is raised for burst headroom only - stated explicitly
// here (rather than left to main.bicep's own default of 1) so this file's own intent is visible
// without cross-referencing the template. CPU/memory stay at main.bicep's own Dev-equalling default
// (0.25 vCPU/0.5Gi) - this is a lightweight SSR/proxy workload with no heavy compute, so there is no
// reason yet to size it like the API.
param minReplicas = 1
param maxReplicas = 2

// googlePlayUrl/appStoreUrl/appStoreAppId/iosAppId are deliberately left unassigned - main.bicep's own
// "" defaults apply (storeConfig.ts/the two .well-known routes already treat "" identically to
// "unset"). None of these four have a real value yet (no Play/App Store listing, no Apple Developer
// Team ID - see ../README.md and the root README.md's "Production release signing" section).
// Add each here individually, with its own real confirmed value, only once it actually exists -
// never a placeholder, and never dev.bicepparam's own Dev debug-keystore fingerprint (a
// completely different, Dev-only certificate - see that file's own remarks).

// Live Foundation/deploy-time values - none of these exist yet either (no Production Foundation
// has been deployed - see ../README.md). Set the matching environment variable in the deploying
// shell before running `az deployment group create` with this file; never hardcode a real value
// on these lines, and never reuse a Dev value here.
param acrLoginServer = readEnvironmentVariable('JUPLE_WEB_PROD_ACR_LOGIN_SERVER')
param containerAppsEnvironmentId = readEnvironmentVariable('JUPLE_WEB_PROD_CONTAINER_APPS_ENVIRONMENT_ID')
param managedIdentityResourceId = readEnvironmentVariable('JUPLE_WEB_PROD_MANAGED_IDENTITY_RESOURCE_ID')
// Production deploys an IMMUTABLE digest (sha256:<64 hex>), never a tag - the digest of the image built from a
// known commit, inspected and pushed. No tag is passed at all.
param imageDigest = readEnvironmentVariable('JUPLE_WEB_PROD_IMAGE_DIGEST')
// The Production API's own live origin (its containerAppFqdn before api.juple.co.kr is bound, or
// that custom domain afterward) - a genuinely per-deployment value, never a literal, same
// treatment as dev.bicepparam's own apiBaseUrl.
param apiBaseUrl = readEnvironmentVariable('JUPLE_WEB_PROD_API_BASE_URL')

// -----------------------------------------------------------------------------------------------
// Launch settings. Staged on purpose:
//   Stage 1 (first deployment, before the domain is bound / legal details exist):
//       JUPLE_WEB_PROD_LAUNCH_SETTINGS_REQUIRED=false - a conscious, visible choice. Such a deployment is
//       NOT launch-ready and must not be announced or given to Play Console: the legal pages then leave
//       the operator lines out (nothing is invented) and the install CTA has no store link.
//   Stage 2 (the launch deployment): JUPLE_WEB_PROD_LAUNCH_SETTINGS_REQUIRED=true. The deployment then
//       fails during validation unless customDomainName/managedCertificateName (the two literals above -
//       'juple.co.kr' and its real managed certificate), the Play URL, the assetlinks fingerprint and
//       every LEGAL_* operator value below are set (launch-settings-guard.bicep).
// No default for the switch: omission fails the build (BCP427), so "launch-ready" is never implied.
// -----------------------------------------------------------------------------------------------
param launchSettingsRequired = bool(readEnvironmentVariable('JUPLE_WEB_PROD_LAUNCH_SETTINGS_REQUIRED'))

// The real Google Play listing URL - only once a listing exists (never invented).
param googlePlayUrl = readEnvironmentVariable('JUPLE_WEB_PROD_GOOGLE_PLAY_URL', '')

// SHA-256 fingerprint(s) of the certificate that signs the INSTALLED app: the Google Play App Signing
// certificate - never the upload key, never debug/dogfood. Confirmed from Play Console > Setup > App
// integrity > App signing key certificate (Production, com.juple.app). It is a public certificate
// fingerprint, not a secret, so it lives here as a literal: a redeploy can never silently drop it.
// The upload key (D0:6E:41:FE:...) is deliberately NOT listed - it signs nothing a user installs from
// Play. Dev's three fingerprints are NOT carried over: Production serves only what Production installs
// are signed with. Comma-separated for several (e.g. during a signing-certificate rotation).
param androidAssetlinksSha256Fingerprints = 'D5:2E:DD:99:E9:EC:7B:7F:38:12:9C:A9:1A:0F:12:9D:FE:CA:A0:6E:65:AF:F1:1B:D0:74:0B:4E:3C:F9:AB:D6'

// Operator details for /privacy, /terms, /account-deletion and the landing page. NO value is committed: they come from the deploying
// shell (the operator's confirmed details). Empty = left out of the pages (allowed only while launchSettingsRequired is false; the
// launch deployment requires operator, representative, business number, address, effective date and the privacy officer).
param legalOperatorName = readEnvironmentVariable('JUPLE_WEB_PROD_LEGAL_OPERATOR_NAME', '')
param legalRepresentativeName = readEnvironmentVariable('JUPLE_WEB_PROD_LEGAL_REPRESENTATIVE_NAME', '')
param legalBusinessRegistrationNumber = readEnvironmentVariable('JUPLE_WEB_PROD_LEGAL_BUSINESS_REGISTRATION_NUMBER', '')
// 통신판매업 신고번호: only once one exists (empty = the line is left out).
param legalEcommerceRegistrationNumber = readEnvironmentVariable('JUPLE_WEB_PROD_LEGAL_ECOMMERCE_REGISTRATION_NUMBER', '')
param legalBusinessAddress = readEnvironmentVariable('JUPLE_WEB_PROD_LEGAL_BUSINESS_ADDRESS', '')
param legalEffectiveDate = readEnvironmentVariable('JUPLE_WEB_PROD_LEGAL_EFFECTIVE_DATE', '')
// 개인정보 보호책임자 - its mailbox defaults to the confirmed contact mailbox.
param legalPrivacyOfficerName = readEnvironmentVariable('JUPLE_WEB_PROD_LEGAL_PRIVACY_OFFICER_NAME', '')
param legalPrivacyOfficerTitle = readEnvironmentVariable('JUPLE_WEB_PROD_LEGAL_PRIVACY_OFFICER_TITLE', '')

// The signed-in Juple Web app on Production (activated 2026-10-16): the Production External ID tenant and its "Juple" SPA app
// registration (11ba52b5-...; SPA redirect URIs https://juple.co.kr/auth/callback and https://juple.co.kr, the Juple API's
// access_as_user with admin consent, linked to the JupleSignUpSignIn user flow - the same shape as Dev's "Juple Web (DEV)"), the
// Production API scope, this site's own origin and the host of Production's Collection share links. Public identifiers, never secrets
// (a browser app has no client secret). ../app/prod.bicepparam lists https://juple.co.kr in authenticatedWebAllowedOrigins.
param signedInWebEntraAuthority = 'https://juple.ciamlogin.com'
param signedInWebEntraTenantId = '9cc10dba-a023-436b-a90b-181829718f38'
param signedInWebEntraClientId = '11ba52b5-88aa-4e29-bb80-06b23b244b31'
param signedInWebEntraApiScope = 'api://a61bc80e-2d14-4ff0-9fd7-bc6a63c8e2a0/access_as_user'
param signedInWebBaseUrl = 'https://juple.co.kr'
param signedInWebPublicHost = 'juple.co.kr'

// The full site: "/" is the Juple landing for a signed-out visitor (웹에서 시작하기 -> sign-in) and the app once signed in; the legal
// pages, the shared-Collection viewer and the app-link files stay public. Public-only mode (apps/web/lib/publicOnly.ts) is off.
param publicOnly = false
// legalSupportEmail / legalPrivacyEmail are left unassigned: the code's confirmed contact mailbox applies.
