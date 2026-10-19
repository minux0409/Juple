# Juple Admin Web

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
2. An operator runs the script against the target database with **their own** Entra database login, never the application's identity:

   ```
   sqlcmd -S <server> -d <database> -G -v JupleId="K7MP4Q8N" -i infra/sql/admin/grant-first-owner.sql
   ```

   The script behaves as follows:
   - It accepts `@`, dashes and any letter case.
   - It refuses an unknown Juple ID (error 51001).
   - It refuses when **another** active Owner already exists (51002).
   - Running it again for the same person changes nothing.
3. The person opens the Admin Web and signs in.

**Emergency stop:** `infra/sql/admin/deactivate-admin.sql` (same `-v JupleId=`) sets `IsActive = 0`. Access ends with the very next request, and the row is kept for the record.

Granting further admins is a later, audited Owner flow. It is not built yet, and there is no API for it.

## Features (round 1)

| Sidebar | State | Source |
| --- | --- | --- |
| 대시보드 | live | `GET dashboard/summary`: SQL `COUNT` aggregates (users total / today / 7 days, links not in trash, links saved today, Collections, shared Collections, open inquiries). "Today" starts at the admin browser's local midnight (validated: at most 36 h before now). |
| 사용자 | read-only | `GET users`: newest first, keyset paging, exact Juple ID search; link and Collection counts. |
| 콘텐츠 (링크/컬렉션) | disabled (준비중) | No moderation scope decided. |
| 문의 | live | `GET support/inquiries` (전체/접수/처리중/답변완료), `GET {id}`, `PUT {id}/status` (접수 <-> 처리중 only; an answered inquiry cannot go back), `PUT {id}/answer` (1..8000 chars; replaces the answer). The answer is written to the **same row** the person reads in 고객센터 > 문의내역. |
| 분석 | disabled (준비중) | See "Not available" below. |
| 운영 > 앱 버전 | read-only | `GET operations/app-version`: the `MobileVersionPolicy` the API serves. It changes only through a configuration deployment. |
| 운영 > 시스템 상태 | live | API `/health`, `GET operations/system` (environment, API build, server time) and the Admin Web build (`JUPLE_ADMIN_BUILD_VERSION`). |

### Not available (no reliable data, so nothing is shown)

- **DAU / MAU:** Juple records no per-user activity timestamps.
  - Push device `LastSeenAtUtc` covers only push-registered mobile devices, never the Web, so it would undercount.
  - A real number needs a deliberate daily-active record (e.g. one row per user per day, written by bootstrap), with a retention decision.
- **Country:** nothing is stored, and raw IP addresses must not be.
  - A future option is a coarse `CountryCode`, derived at request time from a trusted edge header and never from an IP kept in SQL. Privacy-policy review is needed first.
- **Platform usage:** only inquiry diagnostics and push registrations carry a platform. Neither represents all users.

## Compatibility and rollout order

1. Apply the migration (it is additive: the new schema, a nullable column, and widened constraints).
2. Deploy the new API **and** the new user Web together.
   - The previous Web parser would drop an `InProgress` inquiry.
   - The previous API revision cannot read one.
3. **Set nothing to 처리중** until the old API revision is fully retired.
4. Older mobile builds show an `InProgress` inquiry as 접수. That is acceptable, and nothing breaks.
5. Bootstrap the first Owner, then deploy the Admin Web.

## Azure deployment design (not created yet)

- **Image:** `apps/admin/Dockerfile`, a standalone Next.js server on port 3000. The image is pushed to the existing ACR (e.g. `juple-admin:<tag>`).
- **Container App** `ca-juple-admin-{env}` in the existing Container Apps environment:
  - ingress external, HTTPS only;
  - min replicas 0–1;
  - no secrets: every value is a public identifier.
- **Environment variables:**

  | Variable | Value |
  | --- | --- |
  | `JUPLE_ADMIN_API_BASE_URL` | `https://api.juple.co.kr` |
  | `JUPLE_ADMIN_ENTRA_AUTHORITY` | the External ID authority, the same tenant as the apps |
  | `JUPLE_ADMIN_ENTRA_TENANT_ID` | the tenant id |
  | `JUPLE_ADMIN_ENTRA_CLIENT_ID` | the **new** Admin SPA registration |
  | `JUPLE_ADMIN_ENTRA_API_SCOPE` | `api://<api app id>/access_as_user` |
  | `JUPLE_ADMIN_BASE_URL` | `https://admin.juple.co.kr` |
  | `JUPLE_ADMIN_BUILD_VERSION` | the image tag |

  A missing value shows "관리자 웹 설정이 완료되지 않았습니다." There are no defaults.
- **Entra:** a separate **SPA app registration** for the Admin Web, so it can be disabled, restricted or monitored independently of the user Web:
  - redirect URI `https://admin.juple.co.kr/auth/callback`;
  - the delegated permission `access_as_user` on the Juple API, with admin consent.

  Optionally, set "assignment required" with only operators assigned, as a second barrier. The API grant table remains the authority.
- **API configuration:** add `https://admin.juple.co.kr` to `AuthenticatedWeb:AllowedOrigins`. CORS is needed for the bearer calls and `/health`.
- **DNS:** a CNAME `admin` pointing to the Container App FQDN, plus the `asuid.admin` TXT verification record. Then bind a custom domain with a managed certificate.
- **CI/CD:** build, test (`npm test`, `tsc`, `eslint`, `next build`), push the image and update the Container App. Same pattern as the user Web.
