# Admin workspace and business ledger

Implementation date: 2026-10-22. Review baseline: `60ec1bc1e00adf78d2c7df817668392f21edb011`.
This document records the original local implementation round, before Git publication. No PROD
deployment, database migration, RBAC, Key Vault, Billing or paid Azure resource changes were made.
The subsequent commits, selective deployment candidates and current compatibility findings are
recorded in [admin-workspace-release-review.md](admin-workspace-release-review.md).

## Existing system and operational baseline

- Admin is `apps/admin` (Next.js standalone Node, React/MSAL), separate from `apps/web` and the API.
  Production is `admin.juple.co.kr`, Container App `ca-juple-admin-prod`, min/max 1/1,
  0.25 vCPU / 0.5 GiB Consumption. Read-only observation: revision
  `ca-juple-admin-prod--admin-image-ba5c5a88`, image digest
  `sha256:04406ca730be512eaaf0292281f20acc695927f9845bde03484ccdba7436283a`.
  Its source is `31eae63` plus the versioned-static-cache fix, **not all of master**.
- Production API/Notification Worker/push-dispatch use a separately reconstructed APNs backport.
  This workspace cannot be deployed by rebuilding all of master without an independent compatibility review.
- AdminRoot verifies the server's active grant before rendering operator content. Existing
  users, inquiries, mobile-version settings, system health and UTC analytics are retained.
- Existing Expenses already supplied the company ledger, schedules, audit, private evidence,
  Azure daily service snapshots, reconciliation and CSV/XLSX. These are extended, not duplicated.
- Existing `AddBusinessExpenses` migration is `20261020110000_AddBusinessExpenses`.
  Actual PROD migration history remains unconfirmed (prior SQL 40615 network restriction).
  No firewall or PROD SQL connection is changed in this round.

## Navigation and screens

| Area | Routes and contents |
| --- | --- |
| Overview | `/`: current accounts/live links/collections/shared collections/open inquiries, period signups/saves/active people; common charts |
| Users | `/workspace/users`: new/cumulative surviving accounts, DAU/WAU/MAU, activity platforms, recent public Juple IDs; `/users` directory retained |
| Links | `/links`: daily saves/savers/cumulative surviving saves, collections, top domains, collaboration notification events |
| Operations | `/operations`: FCM/APNs latest delivery states, creation-to-attempt delay, latest outbox events, optional API 5xx telemetry; existing version/system children retained |
| Business Expenses | `/expenses`: ledger, daily/month/category/service breakdowns, evidence, refunds, audit, recurring forecasts, Azure synchronization/report |
| Revenue & Profit | `/revenue`: current purchase states and paid costs; missing monetary revenue/settlement/profit explicitly unavailable |
| Settings | `/settings`: grants, configured sources/scopes/scanner/categories and integration limitations |

Shared cards and SVG charts reuse the existing analytics implementation; no chart dependency or
paid service is added. The system dark theme remains supported. Charts expose captions, units,
data lists and SVG titles. Negative refunds/adjustments plot below zero. Skeletons, empty states,
errors and retry are distinct. The browser fixture exercises 390/768/1440px and dark mode.

## Period and metric definitions

- Default: last seven calendar days including today. Presets: today/7/30/90, or explicit `from` and
  `through`. Navigation preserves dates in the URL; browser history restores them. Maximum 366 days.
  Invalid, reversed, missing, pre-2000 or future dates are rejected by the new server API.
- Application events use Asia/Seoul boundaries: `[from 00:00 +09, through+1 day 00:00 +09)`;
  instants remain stored in UTC. Existing `/analytics` APIs retain their UTC contract/defaults.
- `TotalUsers` is the current surviving Users count. New signups and cumulative curves are derived
  from **surviving** rows; account deletion removes history, so these are not lifetime registration
  or historical churn totals. No invented deletion count is displayed.
- Saves count each owner Item row once, including trash, excluding permanently removed rows.
  Duplicate URLs remain independent saves. CollectionItem memberships do not multiply Item counts.
  Current live holdings exclude trash. Cumulative surviving-save curves cannot reconstruct actual
  historical holdings after purge; the UI names this limitation.
- Daily savers and period users use `DISTINCT UserId`. Domains expose authority only (including an
  explicit port); no title, full URL, memo or image is returned by the statistics API.
- UTC daily activity cannot be accurately rebucketed into Seoul dates. A separate
  `analytics.UserDailyActivitiesKst` starts collecting only after explicit activation. There is no
  fabricated historical backfill. Pre-observation daily activity is null, not zero. DAU/WAU/MAU
  are observed unique users ending on the selected last day; initial windows can be partial.
  Earliest surviving activity date is shown; deletion can remove earlier records.
- Platforms mean **observed usage platform**, never signup platform. A person using Android and Web
  appears in both platform counts, but once in total active users. Unknown is retained as Unknown.
  Usage headers/HTTP-stack classification follow the existing detector; this is not verified device
  identity. Recent activity is throttled at most hourly, with a new bucket at KST midnight.
- Collaboration charts count retained logical NotificationEvents by type. A bulk/coalesced event
  is not converted to a count of links or human actions. Events removed on deletion are absent.
- Push metrics count the latest state of each retained Notification/Device delivery row, not
  all retries or confirmed device receipts. Delay is notification creation to latest attempt,
  not pure queue delay. No Push token/provider handle/user content is returned.
- API telemetry is observed AppRequests for an explicitly configured role. No Entra sign-in audit
  connector exists; API 401 is not presented as failed sign-ins. An inert Application Insights
  connection string does not guarantee an AppRequests table exists.

## APIs, authorization and query limits

`GET /api/v1/admin/workspace/{configuration,overview,operations,revenue}` uses the existing JupleAdmin
policy (401/403, active grant on every request, including cache hits). Statistics have a one-minute
process cache and one concurrent uncached aggregate per API replica; saturation returns 429 + Retry-After.
All new responses are no-store. Period validation runs server-side. No arbitrary SQL/KQL is accepted.

`POST /api/v1/admin/expenses/azure-report` accepts a configured scope and first day of a billing month,
with optional `includeDetails`. Owner/Admin is rechecked before ledger/ARM access. Reports cannot
query an arbitrary subscription. Optional resource/forecast requests have one concurrency slot,
a bounded deadline, ten-minute cache, fixed ARM hosts/dimensions and no redirect-following.

New model fields are nullable: CustomCategory (80), ExchangeRateSource (200), PeriodFrom/PeriodThrough
(date). Categories are appended without renaming old values. Provisional is appended to statuses.
`AddAdminWorkspace` creates the KST bucket with unique User/Date/Platform and cascade deletion;
it extends the expense check constraint and adds four nullable columns.
`AddAdminWorkspaceQueryIndexes` separately adds narrow date indexes for Users/Items/Collections
and Source/SubscriptionId/OccurredOn for Azure scope checks. This supports range filtering and
locking without copying full URL/text into an index. Index write/storage overhead needs staging
query-plan review on representative volumes before production activation.

## Ledger semantics and safeguards

- Manual, recurring and Azure entries share the existing Expense ledger. Original currency and
  decimal amount remain authoritative. No implicit FX or cross-currency total is introduced.
  Exchange rate/date/source and service name are retained and exported. Legacy rates without a
  source remain unknown; new UI lets the operator name the issuer/report source.
- Literal keyword search covers cost name, provider, service and custom classification. Newest/oldest
  registration order uses stable ID cursors in both directions; CSV and summaries share the filters.
- Other supports a custom category label. Accounting period is stored as supplied; summaries are
  **occurrence-date** based, not automatic accrual/day-by-day amortization.
- Estimated (future/manual forecast), Provisional (unfinalized usage/bill), Paid (actual payment date
  required), and Cancelled remain separate totals. Recurring generation is idempotent and always
  Estimated. It does not reuse an old invoice number, FX conversion or old accounting period.
- Existing optimistic revisions, request/invoice dedup, refund bounds, soft deletion and audit
  persist. Reconciled/removed/cancelled Azure rows are excluded from ledger totals. Imported amounts
  are read-only; reconcile to a paid invoice rather than overwriting the upstream record.
- Evidence remains private, 10 MiB max, authenticated, attachment/expense bound and fail closed
  without ClamAV. No public SAS or browser inline PDF rendering is added. CSV/XLSX preserve source
  and new accounting fields; untrusted cells remain formula-safe.

## Azure costs and external sources

- Existing Cost Management ActualCost/PreTaxCost queries import daily service snapshots. Stable
  scope/day/service/currency keys and a DB lease make repeated imports corrections, not additions.
  Imported usage is now Provisional. Removed upstream rows are flagged, not silently counted.
- Explicit resource groups are the safe default. Whole subscriptions require
  `AllowWholeSubscription=true`; they can include unrelated projects. Overlapping subscription/RG
  configuration is rejected. A transaction/key-range lock also rejects overlapping persisted
  monthly snapshots after a configuration change or concurrent conflicting import.
- Azure report shows current month-to-date, prior month same elapsed day count, prior full month
  and percent change by currency. Unsynchronized comparisons are null, and zero prior cost is not
  used as a denominator. Source usage analysis is separate from the reconciled financial ledger.
- Azure UsageDate is a UTC billing calendar date, not a full timestamp that can be rebucketed into
  KST. This is explicitly labelled separately from the application-event period.
- Optional ResourceId breakdown queries are read-only and not added to the service ledger again.
  Optional Azure Forecast ActualCost includes actuals and is displayed separately as model output,
  **not an invoice or extra cost**. It is not linearly extrapolated when Azure provides no forecast.
  Unsupported/denied/empty/throttled sources have explicit states and no fabricated amounts.
- Credentials prefer Managed Identity; the standard developer credential chain is a local fallback
  if MI is unavailable. No secrets are supplied by the browser. Read-only RBAC inspection found
  the existing API identity's registry/blob/Service Bus/Key Vault roles; it did not demonstrate
  Cost Management or Log Analytics read access. No roles were granted, and actual MI cost queries
  remain unverified.
- Minimum planned cost permission: Cost Management Reader at each approved project RG (or reviewed
  subscription), plus billing-account cost-visibility settings where required. Telemetry requires
  an approved Log Analytics query-reader permission (for example Log Analytics Reader at the
  selected workspace). Avoid Contributor/Owner merely for reporting.
- No new scheduler is deployed. Existing one-shot expense job code can be scheduled only in a
  separately approved operations step. Manual sync/status/last success/failure are usable now.
- Cost API usage can lag and be corrected. Pre-tax actual usage can reflect discounts/credits under
  account-specific billing semantics; it is not automatically a final taxed/card/converted invoice.
  The operator records missing taxes, credits and FX from statements, not guesses.
- Apple sales/finance APIs and Google purchase/revenue APIs do not establish access to developer
  enrollment-fee invoices. This round has no verified connector/authorization for Apple membership,
  Play registration, domain renewal or AI/tool subscription charges. Use manual evidence plus
  monthly/yearly schedules; no browser scraping, account-login workaround or speculative connector.

Official references:

- [Cost Management query](https://learn.microsoft.com/en-us/rest/api/cost-management/query/usage)
- [Forecast 2025-03-01 schema](https://learn.microsoft.com/en-us/rest/api/cost-management/forecast/usage?view=rest-cost-management-2025-03-01)
- [Cost access scopes and roles](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/assign-access-acm-data)
- [Apple sales and finance](https://developer.apple.com/documentation/appstoreconnectapi/sales-and-finance)

## Revenue and remaining data gaps

Current StorePurchase rows contain the **latest Google Play entitlement state**, not transaction
amount/currency, each renewal/refund, fee or settlement. iOS/Web monetary reports are not connected.
The new page exposes those current states and paid expense trends, and explicitly leaves revenue,
fees, settlement and profit unavailable. It does not multiply a $1.99 reference price by users.
Billing activation and checkout/store prices are unchanged. A future append-only transaction/report
import with provenance and settlement currency is required for actual monthly profit.

## Configuration and deployment order (plan only)

All new features default OFF; no appsettings/PROD flags were changed:

```
AdminWorkspace__Enabled=false
AdminWorkspace__TelemetryEnabled=false
AdminWorkspace__TelemetryWorkspaceId=<approved workspace GUID>
AdminWorkspace__TelemetryRoleName=<verified API AppRoleName>
Expenses__Enabled=false
Expenses__AzureSyncEnabled=false
Expenses__AzureInsightsEnabled=false
```

Existing Billing/Export/RET controls stay at their existing values. Disabling Workspace avoids new
KST table reads/writes; legacy UTC statistics continue. Expenses must remain disabled until its
schema is present. Merely disabling a flag does **not** make an arbitrarily mismatched full-master
backend compatible with PROD's other schemas.

1. Review/commit the source separately; this round leaves reviewable uncommitted files.
2. Through an already approved SQL environment, read actual PROD migration history. Do not open
   a firewall or apply all pending master migrations automatically.
3. Produce and test an explicitly reviewed API candidate compatible with the deployed APNs
   backport. Include required existing Expense schema and these two new migrations only after
   dependency/script review. Retain flags OFF. No Worker deployment is required for the new UI;
   any future expense one-shot Job is a separate approval.
4. In staging, apply `AddBusinessExpenses` if absent, then `AddAdminWorkspace`, then
   `AddAdminWorkspaceQueryIndexes` in EF dependency order. Verify generated SQL against actual
   history, backups, privileges, index cost and evidence storage. Do not execute Down on a populated
   ledger containing Provisional data; rollback code/flags while retaining additive schema.
5. After explicit PROD migration/deployment approval, deploy the reviewed API before admin UI;
   exercise active-grant rejection, disabled-source handling, period boundaries and ledger smoke.
   Deploy a reviewed Admin candidate (not all undeployed master features by accident).
6. Enable Workspace collection only after schema validation; observe KST collection coverage.
   Enable ledger and private scanner/storage only after evidence security checks.
7. Configure approved project scopes/MI reader roles separately; verify a real cost query before
   enabling sync/insights. Validate AppRequests and exact API role before optional telemetry.
8. Roll back only the relevant API/admin images and feature flags if needed. Preserve company
   audit/ledger evidence and additive schema. No customer data cleanup is part of this work.

## Verification record

- Backend Unit: 2,223 passed, zero skipped (existing unrelated compiler warnings remain).
- Related real SQL Integration: 32 passed, zero skipped, guarded localhost:14333/JupleRetTests
  plus local Azurite. Includes KST midnight, distinct platforms, concurrent bucket upsert,
  deletion cascade, real positive FCM status/delay, event counts, invoice/refund/evidence,
  new fields/recurrence, sync idempotency, overlapping scopes, monthly comparisons, literal
  search/custom classification and both cursor sort orders. Both new migrations applied locally;
  zero pending migrations in that test fixture. No PROD migration execution.
- Admin tests: 55 passed, zero skipped; includes real browser ledger CRUD/export/evidence and
  new dashboard responsive/dark/loading/error/date-switch checks. Test data is synthetic.
- Admin typecheck/lint/Production build passed; real Production cache/security header tests 4/4
  passed (HTML/callback no-store, only versioned static JS/CSS immutable).
- New feature authorization uses the real local ASP.NET policy pipeline, including anonymous,
  ordinary, inactive and active admin/feature-OFF cases. Adapter tests use mock HTTP handlers;
  they do not call real ARM/APNs/FCM endpoints.
- Real Entra admin login, actual MI Cost/Forecast/Log Analytics access and representative-volume
  query plans remain staging/operations checks. Historical KST backfill and actual monetary revenue
  cannot be recovered from existing source data. They are not reported as tested or complete.
- `unit-test-diag.log` SHA-256 preserved:
  `A9FEFCC27B8D2C861F950526FFACFAA801D13D6C75311F82C45ADC6220135CFE`.

The following manifest preserves the original implementation review file set. See the release
review above for subsequent source-control changes; this historical list is not current Git status.

## Original working-tree review manifest

31 tracked files modified, 25 new implementation/test/documentation files; staging is empty.
The pre-existing untracked protected log remains excluded and unchanged.

```text
 M apps/admin/app/(admin)/AdminRoot.tsx
 M apps/admin/app/(admin)/expenses/page.tsx
 M apps/admin/app/(admin)/page.tsx
 M apps/admin/app/globals.css
 M apps/admin/lib/analytics.ts
 M apps/admin/lib/expenses.ts
 M apps/admin/lib/navigation.ts
 M apps/admin/tests/admin.test.ts
 M apps/admin/tests/expenses.test.ts
 M apps/admin/tests/expensesBrowser.test.ts
 M backend/src/Juple.Api/Controllers/Admin/AdminExpensesController.cs
 M backend/src/Juple.Application/Expenses/ExpenseContracts.cs
 M backend/src/Juple.Application/Expenses/ExpenseRules.cs
 M backend/src/Juple.Application/Expenses/ExpenseSpreadsheetWriter.cs
 M backend/src/Juple.Domain/Expenses/Expense.cs
 M backend/src/Juple.Infrastructure/Analytics/UserActivityPump.cs
 M backend/src/Juple.Infrastructure/Analytics/UserActivityStore.cs
 M backend/src/Juple.Infrastructure/DependencyInjection.cs
 M backend/src/Juple.Infrastructure/Expenses/AzureExpenseSource.cs
 M backend/src/Juple.Infrastructure/Expenses/ExpenseStore.cs
 M backend/src/Juple.Infrastructure/Persistence/Configurations/Admin/ExpenseConfiguration.cs
 M backend/src/Juple.Infrastructure/Persistence/Configurations/Collections/CollectionConfiguration.cs
 M backend/src/Juple.Infrastructure/Persistence/Configurations/Items/ItemConfiguration.cs
 M backend/src/Juple.Infrastructure/Persistence/Configurations/Users/UserConfiguration.cs
 M backend/src/Juple.Infrastructure/Persistence/JupleDbContext.cs
 M backend/src/Juple.Infrastructure/Persistence/Migrations/JupleDbContextModelSnapshot.cs
 M backend/tests/Juple.IntegrationTests/Expenses/ExpenseIntegrationTests.cs
 M backend/tests/Juple.UnitTests/Admin/AdminAuthorizationPipelineTests.cs
 M backend/tests/Juple.UnitTests/Analytics/UserActivityTrackingTests.cs
 M backend/tests/Juple.UnitTests/Billing/AccessPolicyAndWriteAccessTests.cs
 M docs/admin.md
?? apps/admin/app/(admin)/expenses/AzureCostReport.tsx
?? apps/admin/app/(admin)/links/page.tsx
?? apps/admin/app/(admin)/operations/page.tsx
?? apps/admin/app/(admin)/revenue/page.tsx
?? apps/admin/app/(admin)/settings/page.tsx
?? apps/admin/app/(admin)/workspace/WorkspaceDates.tsx
?? apps/admin/app/(admin)/workspace/WorkspacePage.tsx
?? apps/admin/app/(admin)/workspace/users/page.tsx
?? apps/admin/lib/workspace.ts
?? apps/admin/tests/workspace.test.ts
?? backend/src/Juple.Api/Controllers/Admin/AdminAzureCostsController.cs
?? backend/src/Juple.Api/Controllers/Admin/AdminWorkspaceController.cs
?? backend/src/Juple.Application/Admin/AdminWorkspaceContracts.cs
?? backend/src/Juple.Domain/Analytics/UserDailyActivityKst.cs
?? backend/src/Juple.Infrastructure/Analytics/AdminWorkspaceStore.cs
?? backend/src/Juple.Infrastructure/Analytics/AzureAdminTelemetrySource.cs
?? backend/src/Juple.Infrastructure/Expenses/AzureCostReportStore.cs
?? backend/src/Juple.Infrastructure/Persistence/Configurations/Analytics/UserDailyActivityKstConfiguration.cs
?? backend/src/Juple.Infrastructure/Persistence/Migrations/20261022033737_AddAdminWorkspace.Designer.cs
?? backend/src/Juple.Infrastructure/Persistence/Migrations/20261022033737_AddAdminWorkspace.cs
?? backend/src/Juple.Infrastructure/Persistence/Migrations/20261022035853_AddAdminWorkspaceQueryIndexes.Designer.cs
?? backend/src/Juple.Infrastructure/Persistence/Migrations/20261022035853_AddAdminWorkspaceQueryIndexes.cs
?? backend/tests/Juple.IntegrationTests/Analytics/AdminWorkspaceIntegrationTests.cs
?? backend/tests/Juple.UnitTests/Admin/AdminWorkspaceTests.cs
?? docs/admin-workspace.md
```
