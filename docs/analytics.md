# Analytics (Admin 분석)

This page covers what the Admin Web's 분석 pages count, where each number comes from, and what is deliberately not collected. The API is `GET /api/v1/admin/analytics/overview?range=7d|30d|90d`, behind the JupleAdmin policy:

- without a token: 401;
- a non-admin: 403;
- any other range: 400.

## Source audit (2026-10-19)

| Source | What exists | Usable for |
| --- | --- | --- |
| `users.Users` | `CreatedAtUtc`, `PreferredLocale`, `TimeZoneId`. There is no last-login or last-activity field and no country. A deleted account's row is removed. | Signups, total accounts. |
| `items.Items` | `SavedAtUtc`, `DeletedAtUtc` (trash), owner `UserId`. Trash is **hard-deleted** after 30 days, when emptied, or on account deletion. | Saved links that still exist. |
| `collections.Collections` | `CreatedAtUtc`, `DeletedAtUtc`. Soft-deleted Collections are purged after 30 days and on account deletion. Sharing is a member or an active share link. | Created Collections that still exist; shared Collections. |
| `notifications` push registrations | `Platform`, `LastSeenAtUtc` for push-registered phones only (never the Web, never a phone without push). | Not representative, so not used. |
| Sign-in events | None stored (Entra keeps its own sign-in logs). | Not used. |
| Application Insights | Not wired: the backend has no telemetry SDK, and the connection string is inert. | No historical backfill is possible. |
| Country | None. The Users table has no country, the External ID token carries none, Container Apps ingress adds no geo header, and no GeoIP database exists. | Not available (see "Country"). |

Locale, time zone and language are **never** read as a country.

## Activity tracking (`analytics.UserDailyActivities`)

| Column | Meaning |
| --- | --- |
| `UserId` | The internal Juple user. FK to `users.Users` with **cascade**, so account deletion removes the person's rows. |
| `ActivityDateUtc` | The UTC calendar day. |
| `Platform` | `Android` / `Ios` / `Web` / `Unknown`, stored by name with a check constraint. |
| `AppBuild` | The app's own build number (Android versionCode / iOS CFBundleVersion), when the mobile app sent it. Null for the Web. |
| `FirstSeenAtUtc` / `LastSeenAtUtc` | The first request and the latest refresh of that day. |

- **Unique `(UserId, ActivityDateUtc, Platform)`.** One row per person, day and platform, however many requests the person makes.
- **Index `(ActivityDateUtc) INCLUDE (UserId, Platform)`** serves the range queries.
- **Not stored:** no IP address, no User-Agent, no device id or model, no token, no location.

### How a day is recorded

1. After every request, `UserActivityMiddleware` checks for an authenticated request on `/api/v1/*`. It skips `/api/v1/admin/*` (operating Juple is not using it) and any 401.
2. The person is the validated token's tenant and object id, never a header or the body.
3. `UserActivityPump.Observe` is in memory and non-blocking: has this identity been recorded on this platform today, within the last hour?
4. If not, it hands a key to a bounded channel.
5. The background loop resolves the internal UserId and runs one `MERGE … WITH (HOLDLOCK)` upsert.
   - Concurrent first requests converge on one row, with the unique index as the backstop.
   - `LastSeenAtUtc` only moves forward.

**Cost:** at most one write per person, platform and hour per API instance, and none on the request path. A failed write is logged (`analytics.activity.record_failed`, exception type only) and retried by a later request. The person's own request is never delayed or failed by it.

### Platform

- **The mobile app** sends `X-Juple-Platform: android|ios` and `X-Juple-App-Build: <build>` on every request (`apps/mobile/src/api/clientIdentityHeaders.ts`). The API accepts only that closed set and a build of at most 32 characters `[0-9A-Za-z._-]`. Anything else is ignored.
- **Without the header**, the HTTP stack's User-Agent is read in memory only, never stored:
  - `okhttp` → Android (React Native on Android, including installed builds older than the header);
  - `CFNetwork` / `Darwin/` → iOS;
  - `Mozilla/` → Web (the signed-in Juple Web);
  - anything else → Unknown.
- **The Web** needs no header and no CORS change.
- **Effect of a wrong claim:** a client claiming another platform only skews that statistic. Access never depends on it.

## Metric definitions

All days are **UTC calendar days**, because the service is global and DB times are UTC. A Korean evening is the next UTC day after 15:00 KST. The pages say "날짜는 UTC 기준입니다."

| Metric | Definition |
| --- | --- |
| DAU | Distinct users with an activity row today (UTC). |
| WAU | Distinct users with an activity row in the last 7 UTC days including today. |
| MAU | Distinct users with an activity row in the last 30 UTC days including today. |
| Active users (series) | Distinct users per UTC day. Days before tracking started are "no data", never 0. |
| Platform active users | Distinct users per platform in the range. A person on Android and the Web is in both, so the shares can add up to more than 100%. "기간 내 활성 사용자 (중복 제외)" is the distinct total. |
| Signups | Accounts whose `CreatedAtUtc` falls on the day. A since-deleted account is not counted. |
| Total users | Existing accounts. |
| Saved links (series, today / 7d / 30d / range) | Links whose `SavedAtUtc` falls on the day and that **still exist**, in the trash or not. Permanently deleted links are gone (see below). |
| Total links | Links not in the trash (the dashboard's number). |
| Unique savers / avg per saver | Distinct owners of the range's saved links; saved links ÷ savers. |
| Collections created | Collections whose `CreatedAtUtc` falls on the day and that still exist; soft-deleted ones count until they are purged. |
| Total / shared Collections | Not deleted. Shared means it has a member or an active share link (the dashboard's definition). |

DAU, WAU and MAU are separate distinct counts. **WAU is never the sum of 7 DAUs.**

### Known limitations

**Saved links and Collections are counted from the rows that still exist.** A link saved on day X and permanently deleted later (trash after 30 days, emptying the trash, account deletion) disappears from day X. So an older day can go down slightly over time.

The exact "saved event" count would need an event or counter written in the save transaction. That is a possible next step: a daily counter per (day, metric), incremented with the save, with no user link. It was not added this round, to avoid touching the save path.

## Tracking start and history

Activity exists from the first day the new API runs; that is `activityTrackingSince`, the earliest row.

- **Nothing is backfilled.** No reliable source exists: there is no App Insights, and push `LastSeen` covers only push devices.
- **A 30-day window that starts before tracking** counts only the days since tracking started. The page shows "활동 데이터 수집 시작: <date>. 그 이전 기간은 집계에 포함되지 않습니다."
- **Before the first row** it shows that collection has not started.

**Retention analysis (D1/D7/D30)** waits until enough activity has accumulated.

## Country

Not collected. The page says "국가 데이터 수집을 아직 시작하지 않았습니다." and invents nothing. If a country is wanted later, these are the options, safest first:

1. **An in-process GeoIP country lookup at activity time** (e.g. MaxMind GeoLite2 Country, free with an account and attribution, updated monthly, about 99% accurate at country level).
   - Only the 2-letter `CountryCode` would be added to the activity row; the IP is used in memory and never stored.
   - Costs: a database file to update (a Job or the image build), a license and attribution note, and a privacy-policy update before use.
   - Behind the Container Apps ingress the client IP is in `X-Forwarded-For`, and only the platform-added entry may be trusted.
2. **A self-declared "Country/Region" sign-up attribute in Entra External ID**, emitted as a token claim. This is reliable as the person's own statement, not their location. It needs a user-flow and token-configuration change, and existing accounts have none.
3. **Azure Front Door in front of the API.** Its WAF can match by geography, but forwarding a country header to the backend needs verification. It also adds a new resource and cost.

Recommendation: option 1 when the product needs country statistics, after the privacy-policy text is updated. Nothing is built yet.

## Privacy and retention

- **Purpose:** service-level usage statistics for the operators only. No profiling, no advertising, and never shown per person.
- **Collected:** internal user id, UTC day, platform, app build, first and last time of that day.
- **Not collected:** IP, User-Agent, device id, location, tokens. The Admin UI shows only aggregates: no email, Juple ID, IP or device data.
- **Account deletion:** the person's rows are deleted with the account (FK cascade, tested with the real `AccountDeletionStore`). No aggregate keeps a user id.
- **Retention recommendation (not enforced yet):** keep the user-linked rows for **13 months**, enough for year-over-year MAU. After that, either delete them or first roll them up into an anonymous daily aggregate (day, platform, distinct count), then delete. This would be a new category in the daily retention Job (`docs/data-retention.md`) once a year of data exists.

## Rollout order

1. **PROD migration** `AddUserDailyActivities`. It is additive: a new schema, one table, two indexes. The running API is unaffected.
2. **API.** The middleware and the analytics endpoint. Without the migration, every write would fail and be logged (no request breaks), so the migration goes first.
3. **Admin Web.** The analytics pages. They need the new endpoint; on an older API they show an error.
4. **Mobile.** The headers ship with the next app release. Older builds are still attributed by their HTTP stack, so nothing waits for it. The Web needs no change.

## Query performance

Every number is a SQL aggregate: `COUNT`, `COUNT(DISTINCT)`, and `GROUP BY CONVERT(date, …)`. At most one row per day or platform is returned, and the series is filled in memory (at most 90 entries). There are about 15 queries per overview call, admin-only.

Local query plans:
- the activity range queries seek `IX_UserDailyActivities_ActivityDateUtc`;
- signups scan `PK_Users`;
- links and Collections scan their narrow existing `(UserId, date, Id)` indexes.

No index was added to Users, Items or Collections for an operator-only page at the current size. Add `(SavedAtUtc)` / `(CreatedAtUtc)` indexes when those scans show up in a measured plan.
