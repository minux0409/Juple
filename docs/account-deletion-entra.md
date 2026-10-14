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
  The same keys are modelled in `infra/azure/app/main.bicep` and `blob-cleanup-job/main.bicep` (default off), so a Bicep redeploy keeps them
  when `dev.bicepparam` is used with `JUPLE_APP_ENTRA_DELETION_CLIENT_SECRET` set.
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

## Production checklist (not done)

1. Create the deletion app registration in the PROD tenant, grant `User.ReadWrite.All`, store its secret in Key Vault (`entra-account-deletion-client-secret`).
2. Set `entraAccountDeletionEnabled`/tenant/client id for `ca-juple-api-prod` and the blob-cleanup Job; apply the migration to PROD SQL first.
3. Set `Billing__TrialIdentityHashKey` before the subscription program is enabled (needed for the email-hash trial memory).
4. Privacy policy / account-deletion page: say that the sign-in account is deleted too.
