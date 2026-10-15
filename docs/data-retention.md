# Data retention and account deletion

Working policy plus what the code does. It is a product/technical document, not legal advice. Values marked **[REVIEW REQUIRED]** are working values
pending legal/accounting review; all periods live in one place, `RetentionOptions` (`backend/src/Juple.Application/Retention`, config section `Retention`).

## 1. Approved working policy and where it is enforced

| Data | Period | Enforced by |
|---|---|---|
| Trial ledger (keyed hash + trial window) | **24 months after the trial window ended**; a running trial is never deleted | retention Job (`trialLedger`) |
| Store purchase - sealed Google token | removed **180 days after a terminal state** (Expired / Revoked) ended access; never while access is live, on hold, paused, pending or being re-checked | retention Job (`purchaseSealedTokens`) |
| Store purchase - row (token hash + minimal state/dates) | deleted **5 years after a terminal state** ended access **[REVIEW REQUIRED: legal/accounting]** | retention Job (`purchaseRecords`) |
| Processed store notifications (RTDN rows) | **90 days** after processing; unprocessed rows are never touched | retention Job (`processedBillingEvents`) |
| Soft-deleted Collections and merge-undo history | **30 days** after deletion/creation | retention Job (`softDeletedCollections`, `mergeUndoHistory`) |
| In-app notifications | **90 days** after creation | retention Job (`notifications`) |
| Push device tokens | **180 days** since last seen (a device that opens the app re-registers and moves `LastSeenAtUtc`) | retention Job (`stalePushTokens`) |
| Trash (삭제 이력) links | the existing cap of 100 per user **and** anything deleted more than **30 days** ago | cap: `ItemTrashLimits` on delete; age: retention Job (`trashItems`, also removes the link's photos best effort) |
| Server logs | 30 days (Log Analytics workspace) | platform, unchanged |
| Notification outbox events | 7 days after processing | push-dispatch Job (`NotificationPipelineOptions.ProcessedEventRetentionDays`), unchanged |

Everything else (links, memos, Collections, photos, comments, friends, support inquiries ...) is kept until the user deletes it or deletes the account.

## 2. How the cleanup works

- **A dedicated daily Job**, `--run-retention-cleanup` (`infra/azure/retention-cleanup-job`, `caj-juple-retention-{env}`, 03:17 UTC, no retries - the next day continues). Reasons not to extend an existing Job: the billing reconcile Job runs every 15 minutes and is time-critical for access (a long purge must not delay it); the push-dispatch Job runs every minute; the blob-cleanup Job is scoped to account-deletion Blobs. Retention needs a slow, low-priority cadence, its own failure signal and its own time limit (30 min), and the same image and SQL identity are reused so it adds no new secret or runtime.
- **Batched and bounded:** each category runs batches of `BatchSize` (500) rows, at most `MaxBatchesPerCategory` (200) batches per run; each batch is its own short transaction (one set-based statement). A category that fails is reported and the others continue; exit code 1 flags any failure.
- **Idempotent and race-safe:** a batch first picks ids (oldest first), then one statement changes exactly those ids **repeating the selecting condition**, so a row that became live again in between (restored Collection, re-activated purchase, re-registered device) is skipped by the database itself. Trash links are deleted through a tracked delete carrying the row version, so a link restored in between fails the batch instead of being deleted. Live data is excluded by the conditions, never by the caller.
- **Order:** merge-undo history before the Collections it references (FK is NoAction); sealed tokens before purchase rows.
- **Logging:** one structured line per category (`retention.purged Category= Purged= Batches= HitBatchLimit= Error=`) and a total; counts and the exception type only - no ids, tokens or content.
- **Validation:** every period must be >= 1 and the purchase-record period must exceed the token period, or the Job refuses to start.
- **Supporting indexes** (migration `AddDataRetentionSupport`): `IX_StoreEvents_ProcessedAtUtc` (filtered), `IX_Notifications_CreatedAtUtc`, `IX_Items_DeletedAtUtc_Id` (filtered), `IX_Collections_DeletedAtUtc_Id` (filtered) - added for these scans only.

## 3. What remains after account deletion

`DELETE /api/v1/account` hard-deletes the account and everything it owns in one transaction (`AccountDeletionStore`), then cleans Blobs through a durable task. What stays, and why:

| Remaining | Content | Why | Ends |
|---|---|---|---|
| `billing.TrialLedger` | HMAC of tenant+object id **and** (v26, Entra deletion enabled) HMAC of the lower-cased sign-in email, trial window. No email, name, Juple ID. No FK to users | so deleting and re-registering does not restart the trial | 24 months after the trial ended |
| `billing.StorePurchases` (detached: `UserId` null, `DetachedAtUtc`) | token hash, product, state, dates, sealed token | deleting an account does not cancel the Google subscription; needed to stop token reuse, to reconcile while paying and to allow a verified restore | token 180 days / row 5 years after the purchase ended |
| Sign-in identity at Microsoft Entra External ID | email, provider, name (outside Juple) | **deleted with the account** when `EntraAccountDeletion:Enabled` (v26; Microsoft soft delete, 30 days in the tenant's deleted items) - see section 5 and `docs/account-deletion-entra.md` | 30 days after deletion (Microsoft) |
| `users.PendingEntraIdentityDeletions` | tenant id + object id, attempt count, error code | only so a deletion that could not reach Entra at once can be retried | removed as soon as Entra confirms (normally seconds) |
| Logs | internal ids, billing event ids; never tokens | platform | 30 days |

Removed immediately: profile, all links/Collections/memos/comments/friends/notifications/push devices/support data, the Google account-id mapping (`GoogleAccountLinks`). Photos: durable Blob cleanup (confirmed by a second sweep).

## 4. Sealed purchase token: can it be purged without breaking billing?

`VerificationHandleEncrypted` is now nullable (`VerificationHandlePurgedAtUtc` records the purge). Only the 180-day-after-terminal rule clears it; the row, `ExternalKeyHash` and state stay. Checked:

- **Conflict detection** uses `(Source, ExternalKeyHash)` unique - untouched, so a token can never belong to two accounts.
- **Verify / restore** with a token the app presents hash it themselves and `ApplyVerified`/upsert never write the handle for an existing row, so a purged row is simply re-verified (and may reactivate through the normal path). Restore-without-tokens skips purged rows (nothing to ask Google with).
- **RTDN** carries its own token; the event path re-seals when it needs to. A notification for a purged purchase still works.
- **Periodic reconcile** selects only rows with a handle; a purged row is a long-ended purchase with nothing to re-check, and reconcile returns "not taken" if it is ever reached.
- Covered by unit and integration tests (purged restore, re-presented token reuses the same row, another account still gets 409).

## 5. Trial ledger and the Entra identity (updated for v26 - Entra deletion)

- **Deletion:** with `EntraAccountDeletion:Enabled`, deleting a Juple account also deletes the Entra External ID user (Graph `DELETE /users/{id}`, application permission
  `User.ReadWrite.All` on an app registration in the customer tenant; design, ordering, retry and credential in `docs/account-deletion-entra.md`). The old email + password cannot sign in again.
- **Keys:** the existing `HMAC-SHA256(Billing:TrialIdentityHashKey, "juple-trial-v1|tenantId|objectId")` entry is unchanged. Because the object id does not survive a deletion any more,
  the same table also holds `HMAC-SHA256(key, "juple-trial-email-v1|" + lower(trim(email)))` + the window, written at deletion (never overwriting) and applied to a new account of the same
  email at sign-up. Only a keyed hash is stored, never the address; retention is the ledger's (24 months after the trial ended).
- **What is (not) stored for the email memory:** no raw email anywhere - there is no email column in `billing.TrialLedger` (or any other Juple table) and none may be added for this.
  The address is read from Graph only at deletion / sign-up, normalised (`trim` + lower-case, no plus-address or dot folding), turned into the keyed HMAC above and
  discarded. Purpose: one person cannot restart the 30-day free trial by deleting the account and signing up again with the same email. Retention: the ledger's
  existing policy (24 months after the trial window ended; a running window is never deleted).
- **User-facing wording (prepared 2026-10-15, `apps/web/lib/legalContent.ts`, ships with the Production Entra-deletion activation):** "로그인 식별 값과 로그인 이메일
  주소를 정해진 방식으로 정리한 뒤 원래 값으로 되돌릴 수 없게 바꾼 변환값(해시)과 이용 기간을 저장 ... 이메일 주소 자체를 저장하지 않습니다" - no cryptographic jargon.
- **[REVIEW REQUIRED]** unchanged from before: whether a keyed email hash is personal data (the code treats it as possibly personal - it can be recomputed by whoever holds
  the key and a candidate address), whether that wording is sufficient, and the retention period are legal/privacy decisions not made here.
- **Remaining gaps:** a different sign-in method or a different email gives a new trial (the ledger recognises an email, not a person). With Entra deletion off, behaviour is as before
  (object-id ledger only).

## 6. Open items

1. **[REVIEW REQUIRED]** 5-year purchase-record period (legal/accounting; may need to be longer for tax records or shorter for privacy) and whether the 180-day sealed-token period fits Google refund/dispute windows.
2. **[REVIEW REQUIRED]** whether a keyed hash is personal data in the operating jurisdiction (the code treats it as possibly personal) and the 24-month ledger period.
3. The two trial-identity gaps (section 5). The Entra deletion policy is decided (deleted with the account) and the privacy / account-deletion wording is prepared; its legal sufficiency is item 2. Microsoft-side lifecycle after a deletion (e.g. any restore period in the tenant) is deliberately not stated as a number in the user-facing text until confirmed from Microsoft documentation **[REVIEW REQUIRED]**.
4. Telemetry/crash reporting does not exist; if added, its retention must be added here.
5. **Production deployment state:** `caj-juple-retention-prod` and `caj-juple-blob-cleanup-prod` are deployed with `triggerType = Manual` (no schedule): the image is pinned by digest, both use the SQL runtime principal through a Key Vault reference and `id-juple-prod` for Blob access. Each has had one observed manual run (retention: every category `Purged=0`, `Failures=0`; blob cleanup: `Pending=0`). Switching either to the documented cadence (`Schedule`: retention `17 3 * * *`, blob cleanup `*/5 * * * *`) is a deliberate one-line change in its `prod.bicepparam`. Both Jobs share the API identity, which holds Blob Data Contributor on the whole storage account; a dedicated identity scoped to the `item-images` container is a later hardening. Blob soft delete is not enabled on the Production storage account, so a Blob deletion is permanent.
