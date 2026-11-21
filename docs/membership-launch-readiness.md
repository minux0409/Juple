# Membership launch policy and operational gate

Status: source implementation / operational application pending. No launch date or revised terms effective date is approved.

## Confirmed policy

- Exactly 720 hours, once per person under the existing Entra identity / normalized email HMAC policy.
- Existing accounts (`CreatedAtUtc < ProgramStartAtUtc`): start at the official program start. New accounts: start at account creation.
- Old tests, expired purchases and past complimentary grants do not consume this official trial. Paid / complimentary entitlement precedence is unchanged. They do not pause or extend the 720-hour clock.
- A canceled, still-paid subscription remains usable to its verified end, subject to store refund/revocation results. After expiry, any remaining valid trial or complimentary grant applies.
- Existing links and collections remain readable under normal ownership/access rules. Without live access, main writes are restricted; account/subscription management, restore and deletion remain available. Individual exempt actions still enforce their own feature flags and authorization.
- Store purchase during the Juple trial charges immediately under the selected offer. The Juple trial does not automatically become a paid store subscription.

## Approved treatment of historical trials

The owner approved a separate official launch trial, preserving historical records.

- `billing.TrialLedger` and `users.Users.TrialStartedAtUtc/TrialEndsAtUtc` stay intact.
- New `billing.MembershipTrialLedger` is keyed by the same HMAC identity/email scheme, with a unique identity hash and no user FK, so it survives account deletion.
- Nullable `MembershipTrialStartedAtUtc/EndsAtUtc` on Users project the official window. Entitlement reads these instead of historical test fields.
- First enabled evaluation records the fixed official window, not evaluation time. A late login does not move the end.
- Account deletion retains the official window under the existing normalized email HMAC; re-registration inherits it. Identity-key races converge through the SQL unique constraint.
- Program start is NOT a ledger namespace. Changing the configured start cannot issue another official trial to a settled identity. Hash-key rotation must not be used to reset trials.
- Existing deleted accounts with only historical records can receive their first official trial; subsequent official-trial deletion/re-registration must reuse the official window.
- The official ledger follows the existing `TrialLedgerMonthsAfterTrialEnd` retention cutoff (currently 24 months), within the same bounded cleanup budget. No RET setting/job is enabled. After memory is legally purged and an account is recreated, the existing identity policy cannot guarantee lifetime recognition; reconcile this retention limit with any lifetime-once promise during legal review. Do not silently extend retention or enable cleanup.
- Email directory lookup remains the existing best-effort path. Directory failure or an entirely different identity/email cannot be claimed to provide stronger anti-abuse guarantees than the existing policy. Audit this recovery path before launch.

## Read-only PROD audit (not completed)

Previous authorized SQL access was blocked by authentication/firewall. No bypass or new credentials/firewall changes are authorized. Google/RTDN evidence does not establish SQL-wide consistency.

Before any application, an approved read-only route must audit: migrations, user creation dates, historical trial/ledger counts and durations, identity/email inheritance, official trial rows (initially none), paid and complimentary cohorts, detached purchases, purchase/token uniqueness. Do not export raw email, HMAC, tokens or credentials. Return aggregate counts and redacted exception categories only.

No backfill or corrective UPDATE is included. The migration adds an empty official ledger and nullable projection columns. Normal enabled requests will later populate them; that is a future PROD write and needs separate operational approval.

## Legal release gate

`docs/legal/terms.draft.md` contains the Korean and English membership amendment. It is NOT a published/effective agreement. Current copy only clarifies pre-program free access and that launch/effective dates will be announced. Existing effective dates and `Terms:CurrentVersion` remain unchanged.

Approve legal review (including refund/withdrawal, notice timing, consent/version transition, privacy/overseas transfer and trial-hash retention) and the revised effective date before publication. Do not silently associate materially new paid clauses with old acceptance records. Korean/English are updated; the other 15 supported translations need review before a global activation.

## Supported app gate

Do not change current minima (Android 24 / iOS 1) in this work. Recommend a membership-launch minimum of Android **42**, iOS **11**, as the current complete membership clients, subject to actual store availability and final device regression. These are proposed floors, not proof that every intervening build is broken. Earlier builds must be tested before choosing a lower floor.

Require public store availability and compatible Play App Signing before making an update mandatory. Closed-track-only access must never block non-testers. Existing mandatory-update flow must be reachable on the older client even when subscription writes are denied. Test Android 24 and iOS 1 update/restore/payment-entry behavior; source inspection of current code cannot certify those historical binaries.

## Operational order (separate approval required)

1. Finish read-only PROD audit and review SQL migration / backup / rollback plan.
2. Approve legal text, effective date, consent/version handling and all release languages. Publish via a separately approved release.
3. Confirm both stores' supported clients are available; verify login, update, purchase/restore and expired read-only UX on each platform.
4. Apply additive migration BEFORE deploying the new API. Even with ProgramEnabled=false, state reads select the new nullable columns. Do not deploy against the old schema.
5. Deploy compatible API/worker/reconcile clients with ProgramEnabled=false. Verify old ledger/purchase rows unchanged and new schema readiness.
6. Separately approve one stable UTC launch instant and stable secret hash key; do not use the example date as configuration. Back up the key through the existing secret system without logging it.
7. Activate only at the approved instant, not early with a future start. Check old/new/test-history/paid/complimentary/recreated cohorts and write/read gates.
8. Roll back ProgramEnabled=false if necessary. Do not delete official rows or move the start/key to give repeated trials. Keep the additive schema for application rollback; dropping it would discard official trial history.

## Platform parity

The server computes the same official trial and entitlement for Android/iOS/Web by Juple UserId, combining verified Google and Apple purchases. Official native store checkout remains platform-specific. Cancellation/restore belongs to the purchasing store; a valid Apple purchase can grant Android access to the same Juple account and vice versa. Actual cross-store device checks remain a release gate.

## Validation history (initial preparation)

These initial results and the initial 35-file list below are preserved as history, not the latest checkpoint. Later SQL/device-independent regression results and the additional returning-account concurrency blocker are recorded in `membership-commit-review.md`. A passing original suite must not be read as coverage of every re-registration interleaving.

- Backend complete unit suite: 2,629 passed. After retention wiring, Billing/Retention/Entra/Bootstrap subset: 550 passed.
- Mobile complete Jest suite: 267 suites / 3,564 tests passed. Final subscription/copy/locale parity subset: 115 passed.
- Web complete suite: 960 passed. After privacy wording updates, legal/parity related subset: 87 passed.
- Mobile/Web TypeScript passed. Web ESLint: zero errors, two pre-existing warnings. Mobile current source ESLint: zero errors; `npm run lint` scans preserved archived Web sources under android/app/build and fails with 18 unrelated errors. Archives were not edited/deleted and lint rules were not weakened.
- API build and IntegrationTests compilation passed. SQL Integration tests were NOT executed: no approved isolated PROD-equivalent SQL test target in this task. New preservation, concurrency, email re-registration and retention SQL coverage needs execution against an approved isolated database before operational rollout.
- EF migration SQL reviewed: nullable columns + empty table + unique hash index + migration-history entry only; no user/legacy-ledger/purchase updates. EF reports no pending model changes.
- No Android/iOS native build, new purchase, PROD DB write, migration application, activation or deployment performed. Current schema/version/backup audit and actual cross-platform device checks remain pending.

## Changed files (uncommitted)

- `apps/mobile/src/billing/__tests__/membershipPolicyCopy.test.ts`
- `apps/mobile/src/i18n/locales/en.json`
- `apps/mobile/src/i18n/locales/ko.json`
- `apps/mobile/src/screens/SubscriptionScreen.tsx`
- `apps/mobile/src/screens/__tests__/SubscriptionPlans.test.tsx`
- `apps/mobile/src/screens/__tests__/SubscriptionScreen.test.tsx`
- `apps/web/lib/appI18nMobile.generated.ts`
- `apps/web/lib/legalContent.ts`
- `apps/web/tests/legalPages.test.ts`
- `apps/web/tests/publicLaunch.test.ts`
- `backend/src/Juple.Api/DesignTimeJupleDbContextFactory.cs`
- `backend/src/Juple.Application/Billing/EntitlementService.cs`
- `backend/src/Juple.Domain/Billing/MembershipTrialLedgerEntry.cs`
- `backend/src/Juple.Domain/Billing/TrialLedgerEntry.cs`
- `backend/src/Juple.Domain/Users/User.cs`
- `backend/src/Juple.Infrastructure/Billing/EntitlementStore.cs`
- `backend/src/Juple.Infrastructure/Billing/MembershipGrantStore.cs`
- `backend/src/Juple.Infrastructure/Persistence/Configurations/Billing/MembershipTrialLedgerEntryConfiguration.cs`
- `backend/src/Juple.Infrastructure/Persistence/Configurations/Users/UserConfiguration.cs`
- `backend/src/Juple.Infrastructure/Persistence/Migrations/20261121082950_AddOfficialMembershipTrials.Designer.cs`
- `backend/src/Juple.Infrastructure/Persistence/Migrations/20261121082950_AddOfficialMembershipTrials.cs`
- `backend/src/Juple.Infrastructure/Persistence/Migrations/JupleDbContextModelSnapshot.cs`
- `backend/src/Juple.Infrastructure/Retention/RetentionStore.cs`
- `backend/src/Juple.Infrastructure/Users/DeleteAccount/AccountDeletionStore.cs`
- `backend/src/Juple.Infrastructure/Users/DeleteAccount/EntraIdentityDeletionStore.cs`
- `backend/tests/Juple.IntegrationTests/Billing/TrialFoundationIntegrationTests.cs`
- `backend/tests/Juple.IntegrationTests/Retention/RetentionStoreIntegrationTests.cs`
- `backend/tests/Juple.UnitTests/Billing/GooglePlay/GoogleBillingControllerTests.cs`
- `backend/tests/Juple.UnitTests/Billing/TrialAndEntitlementTests.cs`
- `backend/tests/Juple.UnitTests/Billing/TrialIdentityHasherAndServiceTests.cs`
- `docs/architecture.md`
- `docs/data-retention.md`
- `docs/legal/privacy-policy.draft.md`
- `docs/legal/terms.draft.md`
- `docs/membership-launch-readiness.md`
