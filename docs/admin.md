# Juple Admin Web

The 2026-10-22 local workspace/ledger expansion, new feature flags, metric definitions and safe
deployment dependencies are documented in [admin-workspace.md](admin-workspace.md). Existing UTC
analytics contracts and operator authorization remain unchanged.

The operator tool at `https://admin.juple.co.kr` is a **separate Next.js app** (`apps/admin`, its own image and Container App). It calls only `https://api.juple.co.kr/api/v1/admin/*`. It is not a hidden path of the user Web (`juple.co.kr`), and the user Web contains no admin code.

## Security model

- **The API decides; the Admin Web only presents.** Every `/api/v1/admin/*` controller carries `[Authorize(Policy = JupleAdmin)]` (a reflection test fails the build if one does not, or if a non-admin controller uses it).
- **`JupleAdmin`** = the normal Juple identity checks (authenticated, the `access_as_user` scope, `tid`/`oid` GUIDs) **plus** `ActiveAdminRequirement`. Its handler maps the token to the internal Juple `UserId` (`ICurrentJupleUserAccessor`, which never creates a user) and reads `admin.AdminUsers` for an **active** grant **on every request**.
  - No token: 401.
  - A valid token with no Juple account, no grant, an inactive grant or the wrong scope: 403.
  - An active grant: the request runs.
- **The source of truth is the internal `UserId` in `admin.AdminUsers`.** The following never grant admin access:
  - an email (Juple stores none);
  - an Entra role or app role;
  - a token claim;
  - a request header or body;
  - anything the browser says.

  There is no "make me admin" endpoint, and no email or UserId is hard-coded anywhere.
- **The acting admin** of a change is the `UserId` that the policy authorized for that request (`AdminRequestContext`), never a value from the body.
- **Admin endpoints and account rules:**
  - Admin endpoints are exempt from the subscription write gate (`AllowWhenSubscriptionExpired`).
  - They are **not** exempt from the Terms rule: the operator is an ordinary Juple user who has accepted the current Terms.
- **Admin Web hardening** (`apps/admin/lib/securityHeaders.ts`, `proxy.ts`):
  - `noindex, nofollow, noarchive`, plus `robots.txt` `Disallow: /`.
  - `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'`. The `/auth/callback` bridge is the exception: `'self'`.
  - `Referrer-Policy: no-referrer`, `nosniff`, a restrictive Permissions-Policy, HSTS, and `Cache-Control: no-store`.
  - The per-request CSP limits `connect-src` to the app itself, the configured API and the Entra hosts.
  - Tokens live only in MSAL's session-storage cache: never in our own storage, never logged.
  - The server-rendered HTML contains no admin data. Pages render only after `GET /api/v1/admin/me` succeeds.
- **A non-admin sees only "관리자 권한이 없습니다."** and a sign-out button: no navigation, no data.
  - A 403 in the middle of a session (the grant was deactivated) drops to the same screen at once.

## Data model (migration `20261019005140_AddAdminUsersAuditLogAndInquiryProgress`)

- **`admin.AdminUsers`**
  - Columns: `UserId` (unique, FK to `users.Users`, cascade), `Role` (`Owner` | `Admin`, string with a check constraint), `IsActive`, `GrantedByUserId` (null for the bootstrap Owner), `CreatedAtUtc`, `UpdatedAtUtc`.
  - Deleting the account deletes its grant.
- **`admin.AdminAuditLogs`**
  - Columns: `AdminUserId`, `Action`, `TargetType`, `TargetId`, `Detail`, `CreatedAtUtc`.
  - No FKs, so the record outlives the admin's account.
  - It is written in the **same `SaveChanges` (one transaction)** as the change it records.
  - Actions: `support.inquiry.status_changed` (detail `Pending->InProgress`) and `support.inquiry.answered` (detail `X->Answered (N chars)`). **The answer text itself is never copied into the audit log.**
- **`support.SupportInquiries`**
  - New state `InProgress` (처리중). The check constraints are updated, and an answer is present exactly when the state is `Answered`.
  - New column `UpdatedAtUtc`.
  - `Down` turns every `InProgress` back into `Pending` before restoring the old constraints.

## Bootstrap: the first Owner (one-time operator procedure)

1. The person signs in to the Juple app once, so their account exists, and reads their Juple ID (내 페이지, e.g. `@K7MP-4Q8N`).
2. An operator runs the script against the target database. Use **their own** database sign-in, never the application's managed identity:
   - **Preferred:** an Entra database login (`-G`), if the server has an Entra admin.
   - **Otherwise:** the SQL administrator login, read from Key Vault into memory for this one run. It is never printed, typed into a file or committed.

   In Production the server is `sql-juple-prod-y5v2isrk3zbwu.database.windows.net` and the database is `Juple`. Open a temporary firewall rule for the operator's IP the same way as for migrations, and remove it afterwards. Only the Juple ID is passed:

   ```
   sqlcmd -S <server> -d <database> -G -v JupleId="K7MP4Q8N" -i infra/sql/admin/grant-first-owner.sql
   ```

   The script behaves as follows:
   - It accepts `@`, dashes and any letter case.
   - It refuses an unknown Juple ID (error 51001).
   - It refuses when **another** active Owner already exists (51002).
   - Running it again for the same person changes nothing.
3. Verify that exactly one active Owner exists, and that it is that person:

   ```sql
   SELECT a.[Id], u.[PublicCode], a.[Role], a.[IsActive], a.[GrantedByUserId], a.[CreatedAtUtc]
   FROM [admin].[AdminUsers] a JOIN [users].[Users] u ON u.[Id] = a.[UserId];
   ```

   Expect one row: the person's Juple ID, `Owner`, `IsActive = 1`, `GrantedByUserId` NULL.
4. The person opens the Admin Web and signs in.

**Emergency stop:** `infra/sql/admin/deactivate-admin.sql` (same `-v JupleId=`) sets `IsActive = 0`. Access ends with the very next request, and the row is kept for the record.

Granting further admins is a later, audited Owner flow. It is not built yet, and there is no API for it.

## Features (round 1)

| Sidebar | State | Source |
| --- | --- | --- |
| 대시보드 | live | `GET dashboard/summary`: SQL `COUNT` aggregates (users total / today / 7 days, links not in trash, links saved today, Collections, shared Collections, open inquiries). "Today" starts at the admin browser's local midnight (validated: at most 36 h before now). |
| 사용자 | read-only | `GET users`: newest first, keyset paging, exact Juple ID search; link and Collection counts. |
| 콘텐츠 (링크/컬렉션) | disabled (준비중) | No moderation scope decided. |
| 문의 | live | `GET support/inquiries` (전체/접수/처리중/답변완료), `GET {id}`, `PUT {id}/status` (접수 <-> 처리중 only; an answered inquiry cannot go back), `PUT {id}/answer` (1..8000 chars; replaces the answer). The answer is written to the **same row** the person reads in 고객센터 > 문의내역. |
| 분석 (개요 / 사용자 / 저장 활동 / 국가 / 플랫폼) | live (Round 4) | `GET analytics/overview?range=7d\|30d\|90d`. It covers DAU/WAU/MAU from `analytics.UserDailyActivities`, signups, saved links, Collections and platforms; country is "not collected yet". All definitions are in `docs/analytics.md`. |
| 운영 > 앱 버전 | read-only | `GET operations/app-version`: the `MobileVersionPolicy` the API serves. It changes only through a configuration deployment. |
| 운영 > 시스템 상태 | live | API `/health`, `GET operations/system` (environment, API build, server time) and the Admin Web build (`JUPLE_ADMIN_BUILD_VERSION`). |

### Still not available

- **DAU / WAU / MAU before activity tracking started:** not backfilled, because there is no reliable source. The pages show the tracking start date (`docs/analytics.md`).
- **Country:** not collected, and raw IP addresses are never stored. The options and the recommendation are in `docs/analytics.md` "Country".

## Production infrastructure (`infra/azure/admin`)

`ca-juple-admin-prod` follows the user Web (`infra/azure/web`) and creates nothing else. It shares with the user Web:

- the Container Apps environment `cae-juple-prod`;
- the ACR;
- the identity `id-juple-prod`, which already has AcrPull;
- Log Analytics, through the environment.

A read-only `what-if` of `admin/prod.bicepparam` against `rg-juple-prod` shows one change: **Create `ca-juple-admin-prod`**. Every other resource is Ignore.

| Setting | Value | Why |
| --- | --- | --- |
| Ingress | external, target port 3000, `allowInsecure: false`, revisions `Single` | same as the user Web |
| Image | `{acr}/juple-admin@sha256:...` (digest only in Production) | `app/image-reference-guard.bicep` rejects a missing or malformed digest |
| CPU / memory | 0.25 vCPU / 0.5 GiB | the smallest Consumption pair; the app is a thin client-rendered UI |
| Replicas | min **0**, max **1** | operator-only traffic, so it costs nothing while idle (see "Cost" below) |
| Probes | liveness and readiness `GET /health` | `app/health/route.ts`: 200 `ok` from the Next.js process, with no sign-in, API call or configuration |
| Secrets | none | every env value is a public identifier |
| Custom domain | `admin.juple.co.kr`, certificate `mc-cae-juple-prod-admin-juple-co-k-2603` (bound 2026-10-19) | both literals in `admin/prod.bicepparam` (`bindCustomDomain = true`), because `ingress.customDomains` is replaced on every deployment |

### Runtime environment (7 values, all public configuration, none of them a secret)

| Variable | Production value | Source in `admin/prod.bicepparam` |
| --- | --- | --- |
| `JUPLE_ADMIN_API_BASE_URL` | `https://api.juple.co.kr` | literal |
| `JUPLE_ADMIN_ENTRA_AUTHORITY` | `https://juple.ciamlogin.com` | literal |
| `JUPLE_ADMIN_ENTRA_TENANT_ID` | `9cc10dba-a023-436b-a90b-181829718f38` | literal (the same tenant as the user Web) |
| `JUPLE_ADMIN_ENTRA_API_SCOPE` | `api://a61bc80e-2d14-4ff0-9fd7-bc6a63c8e2a0/access_as_user` | literal |
| `JUPLE_ADMIN_BASE_URL` | `https://admin.juple.co.kr` | literal |
| `JUPLE_ADMIN_ENTRA_CLIENT_ID` | the "Juple Admin Web (PROD)" SPA client id | deployer's shell: `JUPLE_ADMIN_ENTRA_CLIENT_ID`. **Not committed.** No default. |
| `JUPLE_ADMIN_BUILD_VERSION` | the commit the image was built from | deployer's shell: `JUPLE_ADMIN_PROD_BUILD_VERSION`. No default. |

- **Fail-fast in two places:**
  - A missing variable fails the parameter build (BCP427).
  - `admin/admin-config-guard.bicep` rejects the deployment during validation when any of these holds:
    - a URL is not `https://host`;
    - a tenant or client id is not a GUID;
    - the scope is not `api://…/access_as_user`;
    - Production points at localhost, `127.0.0.1`, a `dev.` host or `jupledev`;
    - `bindCustomDomain=true` lacks the domain or certificate, or `adminBaseUrl` is not `https://<that domain>`.
- **The app checks again:** in `next start` / the container, `lib/adminConfig.ts` accepts only https, no local host, GUID ids and the `access_as_user` scope. Otherwise it shows "관리자 웹 설정이 완료되지 않았습니다."
- **Future secrets:** a secret added later goes through a Container Apps secret / Key Vault reference, never a plain env value or bicepparam literal.

### API CORS

`app/prod.bicepparam` now reads:

```
authenticatedWebAllowedOrigins = ['https://juple.co.kr', 'https://admin.juple.co.kr']
```

- It is https only, with no wildcard, no localhost and no credentials.
- The Admin Web sends `Authorization: Bearer` and `Content-Type: application/json`, using GET, and PUT on the two inquiry actions. Both headers and methods are already in `AuthenticatedWebCors`. No cookie is involved (`credentials: 'omit'`).
- `AuthenticatedWebCorsTests` reads this line from the file and runs a real preflight evaluation:
  - the user Web and the Admin Web are allowed;
  - `https://evil.example`, `http://admin.juple.co.kr` and `https://admin.juple.co.kr.evil.example` are refused.
- A read-only `what-if` of the API with live values shows exactly one change: env `AuthenticatedWeb__AllowedOrigins__1 = https://admin.juple.co.kr`.
- The same file now also states `mobileAndroidLatestBuild = 31`, the value the live API serves. It used to say 26, so a redeploy would have lowered it. The minimum stays 24.

### Content-Security-Policy (per request, `proxy.ts`)

```
frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self';
connect-src 'self' https://api.juple.co.kr https://juple.ciamlogin.com https://9cc10dba-a023-436b-a90b-181829718f38.ciamlogin.com; img-src 'self' data:
```

- `script-src` is not restricted, because Next's inline bootstrap needs nonces. There is no `*`.
- The `/auth/callback` bridge alone uses `frame-ancestors 'self'`.
- **Measured in headless Chrome against the production image:**
  - Starting sign-in fetches only `https://juple.ciamlogin.com/juple.onmicrosoft.com/v2.0/.well-known/openid-configuration`, then navigates to `https://juple.ciamlogin.com/<tenant>/oauth2/v2.0/authorize`.
  - No `login.microsoftonline.com` call is made (instance discovery is skipped because the authority is in `knownAuthorities`).
  - There were no CSP violations.
  - The token and logout endpoints in the discovery document are on `juple.ciamlogin.com` too.

### Cost

min 0 / max 1 at 0.25 vCPU / 0.5 GiB costs nothing while idle.

- **Cold start:** the first request after idle waits for the platform to scale from zero. The user Web measured up to ~29 s.
- **Impact:** an operator sees a slow first page. Sign-in itself is unaffected, because the redirect returns to a warm replica, and so are health probes.
- **If it bothers the operators:** set `minReplicas = 1`, about USD 6 a month, the same as the user Web.

## Production rollout (in this order)

The `InProgress` state is the constraint:

- an API revision older than migration `AddAdminUsersAuditLogAndInquiryProgress` cannot read an `InProgress` inquiry;
- a user Web older than `b0baf7e` drops it from the list.

So the migration comes first, then the API and the user Web. **No inquiry is set to 처리중 before both are fully rolled out.**

1. **PROD DB migration.** Use the existing reviewed procedure (`infra/azure/README.md` "EF Core migration 적용"):
   1. Open a temporary firewall rule.
   2. `SELECT` `__EFMigrationsHistory`.
   3. Generate the idempotent script, review it and apply it.
   4. Remove the rule.

   The migration is additive: the new `admin` schema, a nullable `UpdatedAtUtc`, and widened check constraints. The running API keeps working.
2. **API.** Build `juple-api` from the release commit, push it, record its digest, then deploy `app/prod.bicepparam`. This one deployment carries the new code **and** the Admin CORS origin. Do a `what-if` first.
3. **API healthy.** The new revision is Running, and `/health` and `/health/ready` return 200. Retire the old revision before anything is set to 처리중.
4. **User Web.** Deploy `juple-web` from the same release, with the 처리중 label.
5. **Web healthy.** Check `https://juple.co.kr` and the 고객센터 page.
6. **First Owner.** See "Bootstrap" below.
7. **Admin Container App, phase A.**
   1. Build and push `juple-admin` (see "Image").
   2. Set the variables: `JUPLE_ADMIN_ENTRA_CLIENT_ID`, `JUPLE_ADMIN_PROD_BUILD_VERSION`, `JUPLE_ADMIN_PROD_IMAGE_DIGEST`, `JUPLE_ADMIN_PROD_ACR_LOGIN_SERVER`, `JUPLE_ADMIN_PROD_CONTAINER_APPS_ENVIRONMENT_ID`, `JUPLE_ADMIN_PROD_MANAGED_IDENTITY_RESOURCE_ID`. In this phase `bindCustomDomain` was `false` (done 2026-10-19).
   3. Run `what-if`, then `az deployment group create -g rg-juple-prod --parameters infra/azure/admin/prod.bicepparam`.
   4. The outputs give `containerAppFqdn` and `customDomainVerificationId`.
   5. `https://<fqdn>/health` returns 200. Sign-in cannot work on the FQDN yet, because the redirect URI is `admin.juple.co.kr`.
8. **CORS.** Already live since step 2.
9. **DNS (Gabia, `ns.gabia.co.kr`), phase B:**
   - `CNAME admin` → the `containerAppFqdn` from step 7.
   - `TXT asuid.admin` → `customDomainVerificationId`. This is the environment's verification id, the same value `asuid` / `asuid.api` already carry.

   Check with `nslookup -type=CNAME admin.juple.co.kr` and `nslookup -type=TXT asuid.admin.juple.co.kr`.
10. **Certificate and binding, phase C.** This is a one-time step outside Bicep, the same as `juple.co.kr` and `api.juple.co.kr`:

    ```
    az containerapp hostname add  -g rg-juple-prod -n ca-juple-admin-prod --hostname admin.juple.co.kr
    az containerapp hostname bind -g rg-juple-prod -n ca-juple-admin-prod --hostname admin.juple.co.kr --environment cae-juple-prod --validation-method CNAME
    az containerapp env certificate list -g rg-juple-prod -n cae-juple-prod --managed-certificates-only -o table   # the new certificate's name
    ```

    Then write that certificate name and `bindCustomDomain = true` into `admin/prod.bicepparam` as literals (done 2026-10-19: `mc-cae-juple-prod-admin-juple-co-k-2603`). A `what-if` must then show `ingress.customDomains` unchanged.
11. **Admin login.** Open `https://admin.juple.co.kr` and sign in as the Owner.
12. **Owner check.** The Owner gets the dashboard, and `GET /api/v1/admin/me` returns 200 with role `Owner`.
13. **Non-admin check.** A non-admin Juple account sees only "관리자 권한이 없습니다." (403).
14. **Inquiry E2E.**
    1. Write a test inquiry in the app.
    2. Admin: 처리중. The app shows 처리중.
    3. Admin: answer. The app shows 답변완료 and the answer.
    4. The detail page's 처리 이력 shows both audit entries.

### Image

This follows the user Web's procedure: build locally, push, deploy by digest. There is no CI workflow (`.github/workflows` does not exist).

```
docker build -f apps/admin/Dockerfile -t <acr>.azurecr.io/juple-admin:admin-<commit>-prod-<yyyymmdd> apps/admin
az acr login --name <acr>
docker push <acr>.azurecr.io/juple-admin:admin-<commit>-prod-<yyyymmdd>
docker inspect --format '{{index .RepoDigests 0}}' <acr>.azurecr.io/juple-admin:admin-<commit>-prod-<yyyymmdd>   # -> JUPLE_ADMIN_PROD_IMAGE_DIGEST
```

- The build context is `apps/admin`. The image has no build-time configuration, so one image serves every environment.
- It runs as the non-root `node` user and is about 79 MB.

### Rollback

- **API:** redeploy the previous image digest with the same parameter file. Revisions are `Single`, so the previous revision cannot simply take traffic next to the new one. Do it **only if that image can read the current data.**
  - Once anything is `InProgress`, a revision older than the migration fails on those rows.
  - First set those inquiries back: an admin moves them to 접수. Or, as an operator, run `UPDATE support.SupportInquiries SET Status = N'Pending' WHERE Status = N'InProgress'`.
- **User Web:** redeploy the previous image. Under the same condition, it would hide `InProgress` inquiries.
- **Admin Web:** new and standalone. Deactivate its revision, scale it to 0, or remove the hostname binding and the DNS records. Nothing else depends on it.
  - Removing the Admin origin from `authenticatedWebAllowedOrigins` (an API redeploy) closes the browser path entirely.
  - The API's JupleAdmin policy stays the real barrier either way.
- **Database:** do **not** run the migration's `Down` in Production once admin data exists. It drops `admin.AdminUsers` and `admin.AdminAuditLogs`, including the audit history, and rewrites `InProgress`.
  - The migration is additive, so rolling back code never requires rolling back the schema. Leave it in place.

## Compatibility notes

- Older mobile builds show an `InProgress` inquiry as 접수. That is acceptable, and nothing breaks.
- The Entra SPA registration "Juple Admin Web (PROD)" is configured as follows:
  - redirect `https://admin.juple.co.kr/auth/callback`;
  - the API's `access_as_user` with admin consent, and Microsoft Graph removed;
  - implicit grant off, public client flows off, no secret;
  - the `JupleSignUpSignIn` user flow.

  Its client id goes only into `JUPLE_ADMIN_ENTRA_CLIENT_ID` at deployment.
