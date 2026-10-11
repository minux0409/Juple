# Production bring-up: prerequisites in order

A checklist, not a runbook; do not run it before the decisions in step 0 are made. The Azure-side templates are in `infra/azure` (see its README, "Production IaC (Round 2)").

## Current state

**Production is partially built, not empty.** `rg-juple-prod` (koreacentral) already contains, from an earlier Foundation deployment:

| Resource | Name |
|---|---|
| Managed identity | `id-juple-prod` |
| Container Registry (empty - no image pushed) | `acrjupleprody5v2isrk3zbwu` |
| Storage account (`item-images` container, no shared-key access, no public blob) | `stjupleprody5v2isrk3zbwu` |
| Azure SQL server / database (empty `Juple`, Standard S0, admin login `jupleadmin`) | `sql-juple-prod-y5v2isrk3zbwu` |
| Log Analytics (30 days) | `log-juple-prod` |
| Container Apps environment | `cae-juple-prod` |

Not present: Service Bus, the notification worker identity, Key Vault, the billing identity, Application Insights, any Container App or Job, custom domains, an Entra tenant, secrets. Nothing runs and nothing consumes the SQL credential. A read-only `what-if` of `foundation/prod.bicepparam` (no password) shows only creations (Service Bus namespace + queues, the worker identity, role assignments) and no deletion or re-creation of the existing resources; the SQL server reports "no change".

**DEV credentials are never reused in Production** - not SQL, not any key, not Firebase, not Entra.

## SQL administrator credential

- The existing Production SQL admin password was **not found** anywhere reachable (see the Round 1 findings) and is not needed for routine work: since Round 2 the Foundation template does not send `administratorLoginPassword` unless `sqlBootstrapAdministratorCredential=true`. An ordinary re-deployment of an existing environment needs **no password**, and a password supplied to one fails the deployment (it is never silently ignored).
- A brand-new SQL server is created in bootstrap mode, which requires a password (an empty one fails validation).
- **Plan:** after Key Vault exists, perform **one controlled reset** of the Production SQL admin password (bootstrap mode, same template), while no workload consumes it yet. The password is generated in memory in that single shell session and **stored straight into Key Vault** - never printed, never written to a file, never in shell history or a parameter file - and the environment variables are removed afterwards. If the session is lost before it is stored, repeat the reset (nothing depends on it yet).
- If a consumer already exists (it does not today), a reset requires re-deploying every connection-string secret in the same change.

Exact commands: `infra/azure/README.md`, "SQL administrator credential lifecycle".

## Steps

0. **Decisions (blocking):** production domains (`juple.co.kr` web, `api.juple.co.kr` API are the documented targets), launch model (paid at launch or free first - see `subscription-launch-policy.md`), review of the working retention values (`data-retention.md`: 5-year purchase record, trial ledger) and the privacy/terms text (`docs/legal/*.draft.md`), a support contact and operator information for the legal pages (business registration pending - do not publish placeholders).
1. **Legal URLs live** (public, no sign-in): `/privacy`, `/terms`, `/account-deletion`. Implemented in `apps/web` but **not deployed**. Still open before they can be given to Play Console: (a) deploy `juple-web` to the host the app/Play will use (DEV `dev.juple.co.kr` can serve them for Closed testing); (b) the web Bicep now takes `LEGAL_OPERATOR_NAME`, `LEGAL_BUSINESS_REGISTRATION_NUMBER`, `LEGAL_BUSINESS_ADDRESS`, `LEGAL_EFFECTIVE_DATE` (and optional `LEGAL_SUPPORT_EMAIL`/`LEGAL_PRIVACY_EMAIL`). **No value is committed or guessed.** Production declares `launchSettingsRequired` explicitly: `false` for a first, not-launch-ready deployment (the pages leave unset fields out), `true` for the launch deployment, which then **fails** unless the domain + certificate, Play URL, Play App Signing fingerprint and all four operator values are set; (c) the deletion-request channel is `jupleinfo@gmail.com` (support and privacy contact) - make sure the mailbox is monitored and a handling procedure exists. The mobile Customer Center derives `이용약관` / `개인정보처리방침` from `JUPLE_PUBLIC_WEB_HOST`, so those rows 404 until (a) is done.
2. **Microsoft Entra External ID (production tenant)** - create the tenant, API app registration (exposed scope `access_as_user`, `auth_time` optional claim), native app registration (redirect `com.juple.app.auth://oauthredirect`; iOS later), sign-in methods. Collection-lock `auth_time` / `prompt=login` behavior must be measured for each enabled provider (documented production blocker).
3. **Complete the Foundation** (`infra/azure/foundation`, `prod.bicepparam`, UPDATE mode - no password): Service Bus (queues `notification-events`, `push-deliveries`), the notify-worker identity and its queue roles; then `foundation/billing.bicep` (Key Vault with RBAC, soft delete and purge protection, the `billing-events` queue, the billing identity and its roles). Run `what-if` first. Then `monitoring/` (Application Insights, action group, Job and dead-letter alerts; the app alerts follow once the apps exist).
4. **Secrets into Key Vault** (new values, never reusing DEV): collection cursor key, unlock-grant key, share-password key, billing purchase-token key, Google account-hash key, trial-identity hash key (all distinct), Firebase service account (push), Google Play service account (billing), the SQL admin password (controlled reset above) and the connection string built from it.
5. **Images:** build and push `juple-api` and `juple-web` to the production ACR with immutable tags.
6. **Database:** apply the migrations (59) to production SQL through a deliberate migration step (bundle or reviewed script), never at app startup. Rehearse the whole chain on an empty local SQL Server first. Decide the SQL access path for that step (temporary firewall rule, closed afterwards). Confirm backup/PITR settings (PITR is 7 days, no long-term retention today) and write down the restore procedure.
7. **Deploy workloads** from `infra/azure`: API (`app/prod.bicepparam`), Web, notify-worker, billing-worker, and the Jobs - push-dispatch, blob-cleanup (a hard prerequisite for account deletion), Instagram-metadata-retry, billing-reconcile and **retention-cleanup** (daily; deploy before the subscription program starts). Every Production parameter file reads only `JUPLE_*_PROD_*` variables and fails if one is missing. Bind custom domains and managed certificates. Enable the Container App alerts (`containerAppAlertsEnabled`).
8. **Public links:** set `JUPLE_PUBLIC_WEB_HOST`, the API's `publicWebBaseUrl`; serve `/.well-known/assetlinks.json` with the **Google Play App Signing** certificate fingerprint; iOS AASA stays 404 until an Apple Team ID exists.
9. **Google Play billing (production):** Android Publisher API access for the production service account in Play Console (verify with a read call), product/base plan active, Pub/Sub topic + push subscription with OIDC audience = the production RTDN URL, RTDN configured in Play Console, send a test notification. The API takes `googleBillingEnabled` explicitly and fails the deployment if a required billing value is empty; the subscription program (`billingProgramEnabled`) stays `false`.
10. **Firebase/push:** production FCM credential to the notify-worker and push-dispatch Job; release `google-services.json` (project `juple-production`) is already in the repo.
11. **Mobile release build:** `JUPLE_API_BASE_URL`, `JUPLE_ENTRA_PROD_*`, `JUPLE_PUBLIC_WEB_HOST`, upload keystore via the `JUPLE_RELEASE_*` settings; build the release AAB; confirm the package, signing and non-debuggable flags. The update policy (`mobileAndroidLatestBuild`) is set only after that build is downloadable from Play.
12. **Play Console:** store listing, content rating, Data safety, privacy policy URL, account-deletion URL, target audience/ads declaration, subscription disclosure, closed testing, then production.
13. **Verify end to end on production:** sign-in, save/share, push, account deletion (blob cleanup Job executes), purchase/restore/RTDN, App Links.
14. **Only then** consider activating the subscription program (`subscription-launch-policy.md`).

## Observability status

Azure resources and alerts are defined (`infra/azure/monitoring`), but the backend has **no Application Insights / OpenTelemetry SDK**. Until instrumentation is added in a separate reviewed change, the connection string is inert; the alerts rely on platform metrics and the Container Apps logs already sent to Log Analytics.
