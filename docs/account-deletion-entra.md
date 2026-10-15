# Account deletion deletes the Entra sign-in account (v26)

Supersedes the "Entra identity is kept" decision in `docs/auth-session-lifecycle.md` section 1 (kept there only as history of the
v26 round): deleting a Juple account now also deletes the Microsoft Entra External ID customer user, so the old email + password can
no longer sign in, and a returning person must sign up anew (new Entra object id).

## Behaviour

1. `DELETE /api/v1/account` still requires a recent sign-in (`auth_time` <= 5 minutes).
2. Juple data is deleted in one SQL transaction (unchanged) **together with** a durable `users.PendingEntraIdentityDeletions` row
   (tenant id + object id, nothing else) and, when the trial program has given the account a window, a trial-ledger memory (below).
3. After the commit the API calls Microsoft Graph `DELETE /users/{id}` at once. Success removes the pending row.
   `404` counts as success (idempotent). Any other failure keeps the row (only an HTTP status / AADSTS number is recorded).
4. The scheduled blob-cleanup Job (`--run-blob-cleanup-retry`, every 5 min) retries every pending row; it exits non-zero while one is still failing.
   With `EntraAccountDeletion:Enabled=false` the Job skips this step (one info line, "Entra identity deletion retry is disabled; skipping.",
   exit 0) and leaves every pending row untouched; the blob cleanup in the same pass is unaffected.
5. While a row exists for an identity, `POST /users/me/bootstrap` for that identity answers `409 accountDeletionPending` and creates nothing
   (it first tries to finish the deletion, so a cleared transient failure does not block a real sign-up). The old password therefore
   never yields a fresh Juple account, even in the failure window.
6. Account creation still needs a sign-in from the last 5 minutes and a present `auth_time` (fail-closed) - defence in depth.
7. The mobile app clears its tokens and ends the Entra browser session (best effort); the Web uses `logoutRedirect`.

Entra deletion is Microsoft's soft delete: the user moves to the tenant's deleted items for 30 days and cannot sign in. Permanent
removal (`DELETE /directory/deletedItems/{id}`) is not performed.

## Why this order

SQL and Entra cannot share a transaction.
- Entra first, then SQL: if SQL then fails, the person can no longer sign in to retry and their data is stranded. Rejected.
- SQL first with the Entra task in the same transaction (chosen): the worst case is "data gone, Entra user still present for a few minutes",
  which is closed by the retry Job and by the creation guard in step 5.
- A failed deletion (SQL rolls back) leaves no task and never calls Entra.

The Entra user deleted is the stored external identity of the account being deleted, only for the configured tenant
(`EntraAccountDeletion:TenantId`); no id from a request is ever used.

## Graph permission and credential

- Application permission **`User.ReadWrite.All`** on an app registration **in the customer tenant** - the least privilege Microsoft documents
  for "Delete a user" (`User.DeleteRestore.All` is not listed for it). It also allows reading users; the code reads only `id`, `mail`, `identities`
  of the one account being deleted/created. It cannot delete users that hold privileged directory roles.
- The API's managed identity lives in the Azure subscription's tenant, not in the customer tenant, so it cannot hold the role.
  A cross-tenant federated identity credential (managed identity -> app registration) was tried first and **refused by Entra for the DEV
  External ID tenant (`AADSTS700236`)**. The deployed mechanism is the app registration's **client secret** stored as a Container Apps
  secret (`entra-deletion-client-secret`, 90-day expiry, rotate before it ends). The managed-identity path is still in the code
  (`EntraAccountDeletion:ManagedIdentityClientId`) for a tenant where Entra accepts it; Production should use Key Vault for the secret
  (`apiKeysFromKeyVault` + `entraAccountDeletionClientSecretName` in `infra/azure/app/main.bicep`).
- DEV (configured 2026-10-14): app registration `Juple Account Deletion (Dev)` (appId `0006055e-a22e-43da-b6c4-28995e2ae5f5`) in the
  DEV tenant; settings `EntraAccountDeletion__Enabled/TenantId/ClientId/ClientSecret` on `ca-juple-api-dev` and `caj-juple-blob-cleanup-dev`.
  The same keys are modelled in `infra/azure/app/main.bicep` and `blob-cleanup-job/main.bicep` (default off). The DEV API still takes the
  secret as a value (`JUPLE_APP_ENTRA_DELETION_CLIENT_SECRET` with `app/dev.bicepparam`); since 2026-10-15 the DEV Job reads it from
  `kv-juple-dev-lg4zigc62h2` / `entra-account-deletion-client-secret` (Key Vault reference through `id-juple-dev`,
  `blob-cleanup-job/dev.bicepparam`) - the structure Production uses. Secret expiry: 2027-01-12T11:52:50Z (vault `exp` set to the same instant).
- Both templates support the Key Vault reference: the API with `apiKeysFromKeyVault` + `entraAccountDeletionClientSecretName`, the Job with
  `entraAccountDeletionClientSecretFromKeyVault` + `entraAccountDeletionClientSecretName` (+ `keyVaultUri`). A fail-closed guard
  (`app/entra-deletion-secret-source-guard.bicep`) refuses a Job deployment whose source is incomplete or ambiguous.
- Migration `AddPendingEntraIdentityDeletions`: one new table, additive; the previous API revision is unaffected. Applied to DEV 2026-10-14.

## Trial-abuse protection without the Entra object id

The existing `billing.TrialLedger` was keyed by `HMAC(key, tenant|objectId)`; that id no longer survives a deletion. Added (same table,
same key `Billing:TrialIdentityHashKey`, distinct domain prefix `juple-trial-email-v1`):

- at deletion, if the account has a trial window: `HMAC(key, lower(trim(email)))` + the window is written to the ledger (never overwriting an
  existing entry for that hash);
- at sign-up of a new account: the email is read from Graph, hashed, and a ledger hit gives the new account the ORIGINAL window instead of a fresh 30 days.
- Only a keyed hash and the window are stored - no email. No plus-address / dot folding: an address is what the person typed.
- Everything here is best effort and never blocks a deletion or a sign-up (no key configured = program off = nothing to protect; Graph unreachable = skipped).

**Retention / privacy (not a legal conclusion):** the extra data is one more ledger row per deleted account with a trial window: a 32-byte keyed
hash + the trial start/end + created time. It follows the existing documented ledger retention (deleted 24 months after the trial window ended,
`docs/data-retention.md`). The pending-deletion row holds two directory ids and an error code only until Entra confirms (normally seconds).
Whether a keyed email hash is personal data, and the privacy-policy wording, remain the open review item already recorded for the trial ledger.

## Verified on DEV (2026-10-14, Android emulator + real Entra DEV tenant)

- Delete from the app: Juple data removed; first Graph attempt failed (`AADSTS700236`, then `AADSTS7000215` right after the secret was created),
  the pending row survived, the retry Job deleted the Entra user (`1ff5a358-...` moved to deleted items) and cleared the row.
- Old email + old password: Entra answers "We couldn't find an account with this email address." Sign-in impossible.
- Same email, new sign-up: new Entra object id `cfe2659a-...`, new Juple user, no pending deletions left.
- Not verifiable on DEV: trial memory (the subscription program is off, so no account has a trial window) - covered by SQL integration tests only.

## Account picker

The Microsoft-hosted picker may still list the deleted email as a remembered tile (browser/CIAM cache). Selecting it cannot authenticate (above).
Making the tile disappear is not under Juple's control; follow-up UX: nothing in the app can edit that page.

## What `Enabled=false` means (rollback semantics)

- **API:** a new account deletion removes Juple data only - no pending row, no Graph call (as before v26). The bootstrap guard
  (`409 accountDeletionPending`) is skipped, so an identity that still has a pending row could create a new account again (still only with a
  sign-in from the last 5 minutes).
- **Job:** the Entra retry step is skipped; pending rows are kept, never counted as failures, never deleted.
- **Therefore:** rows written while the feature was on are NOT finished while it is off - those Entra users keep working until the feature
  is on again.

### Runbook: turning it off because Graph fails

1. Record why (the `account.entra-deletion.failed Code=...` codes - an HTTP status / AADSTS number only).
2. Set `entraAccountDeletionEnabled = false` for the API (and the Job) and deploy. Account deletion keeps working for Juple data.
3. Count what is waiting (read-only): `SELECT COUNT(*), MIN(CreatedAtUtc), MAX(AttemptCount) FROM users.PendingEntraIdentityDeletions`.
4. Fix the cause (expired / wrong secret, consent removed, permission, Graph outage).
5. Turn it on again (API + Job). The next Job run (5 min) finishes every waiting row; confirm the count reaches 0.
6. **Never delete pending rows by hand as a "rollback"**: a deleted row means that person's old email + password keeps signing in to Entra
   and nothing will ever retry. A row is removed only by the service when Entra confirms (deleted or already gone).

## Credential rotation runbook (manual - automatic rotation is out of scope for the launch)

Production: one client secret on the PROD deletion app registration, **180-day lifetime**, stored ONLY in `kv-juple-prod-*` as
`entra-account-deletion-client-secret` with the vault `exp` attribute set to the credential's end. Rotate at least 30 days before it ends:

1. Entra admin center (PROD tenant) -> the deletion app -> Certificates & secrets -> new client secret (180 days). Copy it once.
2. `az keyvault secret set --vault-name <prod vault> -n entra-account-deletion-client-secret --file <temp file> --expires <end>` (from a file
   that is deleted right after - never on the command line, never in a log or chat).
3. New API revision and a Job run pick up the new version (Container Apps Key Vault references refresh on a new revision / execution;
   `az containerapp update` with no change, or the next deployment). Confirm a Job run logs `Entra identity deletion retry complete` and no
   `account.entra-deletion.failed`.
4. Delete the old secret from the app registration.
- Expiry signal: the vault `exp` attribute plus the operator reminder; a missed rotation shows as `account.entra-deletion.failed`
  (`AADSTS7000222` = expired secret) and repeated blob-cleanup Job failures, which the scheduled-Job-failure alert
  (`infra/azure/monitoring`, `containerAppAlertsEnabled`) reports to `ag-juple-<env>`. A dedicated Key Vault near-expiry alert (Event Grid
  `SecretNearExpiry`) is a follow-up, not part of the launch.

## Production checklist (prepared 2026-10-15, not executed)

IaC already prepared: `app/prod.bicepparam` (`termsEnforceAcceptance = false`, `termsCurrentVersion = '2026-10-14'`,
`entraAccountDeletionEnabled = false`), `blob-cleanup-job/prod.bicepparam` (`entraAccountDeletionEnabled = false`,
`entraAccountDeletionClientSecretFromKeyVault = true`), `monitoring/prod.bicepparam` (`containerAppAlertsEnabled = true`).

1. Record the current PROD revisions / image digests and a database restore point.
2. Read `__EFMigrationsHistory`; apply `AddPendingEntraIdentityDeletions` and `AddUgcSafety` (both additive) with an idempotent script.
3. Deploy the current backend image to the API and every Job / worker with Entra deletion OFF and Terms enforcement OFF; smoke test.
4. PROD tenant (`30b18993-...`, CIAM): create the deletion app registration, Graph `User.ReadWrite.All` + admin consent, client secret (180 days)
   -> Key Vault only, with `exp`.
5. Set the client id / tenant id and `entraAccountDeletionEnabled = true` in both PROD parameter files; deploy the Job first (a run must
   succeed), then the API.
6. Deploy the Web legal pages together with step 5 (the prepared wording says the sign-in account is deleted too).
7. E2E with a test account; pending count 0; old password refused; same-email sign-up gets a new object id.
8. Deploy monitoring with `containerAppAlertsEnabled = true`.
9. `Billing__TrialIdentityHashKey` (already in the PROD vault as `trial-identity-hash-key`) is wired only when the subscription program is enabled.
