# Admin workspace: Git publication and selective release review

Review date: 2026-10-22. Source review started at master `60ec1bc`.
This round publishes source and creates local source candidates. It does **not** deploy an image,
upload to ACR, execute PROD migrations, change Azure RBAC/Key Vault, enable features or change Billing.

## Commits and verification

| Commit | Scope | Verification after commit |
| --- | --- | --- |
| `05419daa267847220cf445ab6fb64517f69861cc` | KST statistics, workspace API, expense reporting, EF metadata/migrations and related Backend tests (34 files) | API build: zero warnings/errors; related Unit 181/181 |
| `858b3c0eb65cc3801d20a8d94ffcde61b630a958` | Dashboard, common period navigation, ledger/Azure views and UI tests (20 files) | Admin typecheck; tests 55/55 |
| Documentation/SQL follow-up | This review, implementation record and candidate-specific SQL | Diff/manifest review |

Backend features share DI, the EF model, a combined workspace migration and authorization tests;
they were committed together to keep each commit buildable. Earlier implementation verification
recorded full master Unit 2,223/2,223, related Integration 32/32, admin build/lint/typecheck,
55/55 tests and production cache tests 4/4. No tests were skipped. These results are distinct from
the operating-base candidate results below.

The only additional runtime fix during this review selects the configured `AZURE_CLIENT_ID` for
the new cost/telemetry Azure credential. The operating API uses a user-assigned managed identity;
a system-assigned-only first choice would fail there. Other Push/authentication credentials and
existing Billing behavior are unchanged.

## Read-only operating baseline

| Component | Observed ready revision / configuration | Image digest |
| --- | --- | --- |
| API | `ca-juple-api-prod--sec-1f24389c0db8`; min/max 1/3, Single | `sha256:1948396d17cc316d9d88f3b55c8072685656ea824c00db943fa5ca8d8f4f4e58` |
| Notification Worker | `ca-juple-notify-worker-prod--push-33dcd3922e16`; min/max 1/10, Single | Same API digest |
| push-dispatch Job | `caj-juple-push-dispatch-prod`; schedule `* * * * *` | Same API digest |
| Admin | `ca-juple-admin-prod--admin-image-ba5c5a88`; min/max 1/1, 0.25 vCPU / 0.5 GiB Consumption | `sha256:04406ca730be512eaaf0292281f20acc695927f9845bde03484ccdba7436283a` |

Non-destructive GETs returned 200 for API `/health`, `/health/ready` and Admin `/health`.
The API/Worker/Job operating image is the independently verified APNs backport, not all of master.
The Admin operating source is `31eae63` plus cache commit `4f4ff1c`.

## Actual PROD migration history: BLOCKED

| Migration | Actual PROD applied state |
| --- | --- |
| `20261020110000_AddBusinessExpenses` | Unconfirmed |
| `20261022033737_AddAdminWorkspace` | Unconfirmed |
| `20261022035853_AddAdminWorkspaceQueryIndexes` | Unconfirmed |
| `20261021010225_AddApnsDeviceSupport` | Unconfirmed by SQL |
| `AddDataExportLinks` / `FreezeDataExportImagePlan` | Unconfirmed |

An Entra SQL attempt returned 18456. After the user explicitly authorized use of the API's exact
`sql-runtime-connection-string` reference, a second read-only attempt returned **40615**. This is
a network/firewall restriction, not evidence that a migration is absent. No migration/schema
SELECT result was obtained. No firewall changes or alternate access bypass were attempted.

The authorized runtime credential was retrieved in process memory and passed to the SQL helper
through redirected stdin. It was not printed, put in command arguments/environment variables,
logged or stored in a file. The helper allowed only the expected server/database and migration/
schema metadata SELECTs; the persisted result contains only status and numeric error codes.

An operator in an already-approved SQL network environment must supply migration history and
required schema metadata before a PROD SQL plan can be finalized. No credentials are needed in chat.
Working APNs and previous deployment records do not replace actual schema/history confirmation.

## Selective candidates

Permanent local package directory:
`C:\Users\IT\Juple\DeploymentCandidates\admin-workspace-05419da-858b3c0-20261022-v2`

| Candidate | Archive SHA-256 | Runtime source SHA-256 |
| --- | --- | --- |
| API (`api-candidate.zip`) | `2f77edb74b3bc3807fcbb25087deb7fd247282ce23367261b67d19c0a6f50f0c` | `03eabe80aa5dd090192e03f66bd285a557df9051e3b74ffc53d6a45745175192` |
| Admin (`admin-candidate.zip`) | `b4f679038458d49ddc727bb06cf993ebe61cd847bff1abcc70f33790f3fcdf60` | `a3176f369bd30a23cbad8c292a3e29dae9fd9fd392e907621786d8e784251bda` |

The package contains full source archives, small overlays, per-file hashes, change manifests,
sanitized verification evidence and candidate-specific SQL. It excludes node_modules, .next,
bin/obj and generated TypeScript caches. Raw Azure snapshots and credentials are not packaged.

### API

The base is the previously verified APNs log-fix source archive corresponding to operating ACR
Run `de9`, archive SHA-256 `648ff0f6410c89596146578f6640e4ac1518417d1f44b96dc8cbc05859e677fb`.
Only workspace/expense runtime dependencies, migrations and tests were added: 47 source/test
changes, including 37 runtime files. Operating `Program.cs`, both Push senders, duplicate-registration
and delivery logic, appsettings, package versions and Dockerfile remain byte-identical.
The existing APNs `RemoveAllLoggers()` registration remains in DI alongside the new services.
Existing authentication, FCM/APNs, Push duplicate defense, security limits and Billing configuration
are preserved. Only the expense upload concurrency policy is added to rate-limit definitions.

Master's expense spreadsheet writer references the export CSV escaping helper. The candidate uses
an equivalent small expense-local helper instead of importing the Data Export feature. Generated
EF metadata removes only the unrelated DataExportLink entity/relationship blocks. No export
migrations or new retention/deletion activation are included; existing operating cleanup behavior
is preserved. No new startup auto-migration path is introduced.

### Admin

The base is the exact operating `31eae63 + 4f4ff1c` source archive. Workspace/expense UI plus required
HTTP client/retry helpers are overlaid (23 source/test changes). Operating `next.config.ts`,
security headers, proxy/auth boundary, package.json and package-lock remain byte-identical.
HTML/callback no-store and versioned JS/CSS immutable caching are preserved. Generic HTTP helpers
add the POST/DELETE/FormData/blob/429 support required by the new ledger screens.

### Candidate-specific local results

| Check | Result |
| --- | --- |
| API build | PASS; zero warnings/errors |
| Full candidate Unit | 2,175/2,175; zero skipped |
| Related candidate Integration | 54/54; zero skipped |
| Admin typecheck / lint / production build | PASS |
| Admin tests | 55/55; zero skipped |
| Production cache/security tests | 4/4 |
| Operating critical source preservation | 11 listed files byte-identical; full change manifest supplied |
| EF model/snapshot | No pending model changes |

Integration includes real local SQL/Azurite, Android v32 registration/rotation/list/disable,
Push delivery/duplicate behavior and FCM SDK dispatch through fake HTTP. No real FCM/APNs send
or real Entra admin session was exercised. Candidate Unit counts differ from master because the
candidate intentionally excludes unrelated unreleased features/tests. Existing test-project
analyzer warnings remain; production API build has none.

## Schema plan and local proof

An isolated local `localhost,14333 / JupleAdminWorkspaceCandidateTests` database was created from
the operating model and its 63 baseline migrations. It includes operating APNs, without Expense
or Export. The candidate identified **exactly three** pending migrations (Expense, Workspace,
WorkspaceQueryIndexes). With features OFF, the real controller/store returned 404 before missing
tables were accessed. All three applied **locally only**; zero pending migrations remained,
the five ledger tables and KST table existed, APNs was retained, and DataExportLinks was absent.

Reviewed scripts are under [infra/sql/admin/workspace-candidate](../infra/sql/admin/workspace-candidate).
They are generated from the selective candidate, not the full master model. They are supplied for
review only, **not approved for PROD execution**:

1. Run the read-only preflight from an already-approved access environment. Confirm history and
   actual objects/columns/indexes; investigate inconsistencies before choosing any DDL.
2. If Expense is genuinely absent, review `01-expense-ledger.idempotent.sql`: five ledger tables,
   constraints and indexes. Its generation range is `AddUserDailyActivities -> AddBusinessExpenses`.
3. Review `02-workspace-and-indexes.idempotent.sql`: four nullable expense fields, expanded status
   CHECK for Provisional, KST activity table/FK/indexes and four narrow query indexes. Its range is
   `AddApnsDeviceSupport -> AddAdminWorkspaceQueryIndexes`.
4. Expense predates APNs in migration IDs. Generating only from APNs would omit a missing Expense
   migration. Local proof verified that EF recognizes this older missing ID correctly.
5. These scripts add no APNs/Export schema or business-row deletion/backfill. They record migration
   history inserts. The status CHECK is replaced and indexes may take locks; review current volume,
   SQL S0 capacity and a maintenance window before separately approving execution.

Do not run `dotnet ef database update` against PROD or infer idempotence makes unknown schema safe.
If actual APNs/base schema differs, stop and amend the plan. Rollback should restore API/Admin
images and turn the new flags OFF while retaining additive schema and company audit/evidence.
Do not run destructive Down migrations on a populated ledger, particularly with Provisional rows.

## Azure cost access

Signed-in Azure CLI user read-only ActualCost queries succeeded for project RGs `rg-juple-prod`
and `rg-juple-dev`, returning two rows each. Only scopes, column names, counts and status were
retained in the report. Subscription-wide cost access was not tested. **This does not prove
runtime managed-identity access.**

The API's actual UAMI principal `5beb68bf-0683-44bb-ad49-9329ca286af3` has observed AcrPull,
Blob Data Contributor, Service Bus Data Sender and Key Vault Secrets User grants at their existing
resource scopes. The filtered role listing demonstrates no Cost Management Reader or Log Analytics
Reader grant. A parent/group/custom grant and successful in-runtime query have not been established.

For approved RG scopes, propose Cost Management Reader on those RGs only, followed by a real
runtime identity query. A DEV scope needs its own explicit inclusion; do not combine a subscription
and its child RGs in imports. Microsoft documents RG-level Cost Management Reader and account-type
billing-policy prerequisites in [Assign access to Cost Management data](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/assign-access-acm-data).
No RBAC or billing-policy change was made. Forecast/resource-detail/Log Analytics adapters are
optional and still require their own permissions, data availability and runtime verification.

## Remaining release gates and order

Status: **LOCAL SOURCE CANDIDATES VERIFIED / PROD DEPLOYMENT BLOCKED**.

1. Obtain real PROD migration history/schema from an approved existing network path (40615).
2. Reconcile the selective SQL with that evidence; separately approve any schema changes.
3. Build Linux images from the candidate archives using the retained Dockerfile/pinned SDK, record
   immutable digests and compare runtime contents. This round did not build/upload container images;
   local .NET tests used installed SDK 10.0.402, while the source Dockerfile pins 10.0.302.
4. Preserve operating image/settings snapshots. Validate the API with Workspace/Expenses still OFF;
   deploy only under a separate approval. Worker/Job do not require these feature additions.
5. After approved schema verification, enable only approved Workspace/Expense flags; configure
   private evidence/scanner before uploads (unset scanner fails closed). Billing/Export/RET stay
   under their independent existing policies; this review enables none of them.
6. Verify actual admin Entra login, Owner/Admin authorization, representative query plans/latency,
   KST collection coverage, and real MI Cost Management access before Azure sync activation.
7. Deploy only the Admin candidate after compatible API endpoints are available. Verify authentication,
   HTML/callback no-store, immutable JS/CSS, CRUD/export/evidence and responsive dashboards.
8. On failure restore the appropriate image/flags, preserve ledger/audit/data and inspect the cause.

No PROD API/Admin/Worker/Job, database, firewall, Key Vault, RBAC, Billing, feature setting or user
data was changed. Protected `unit-test-diag.log` is excluded from commits and remains SHA-256
`A9FEFCC27B8D2C861F950526FFACFAA801D13D6C75311F82C45ADC6220135CFE`.
