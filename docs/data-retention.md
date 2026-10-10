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
| `billing.TrialLedger` | HMAC of tenant+object id, trial window. No email, name, Juple ID. No FK to users | so deleting and re-registering does not restart the trial | 24 months after the trial ended |
| `billing.StorePurchases` (detached: `UserId` null, `DetachedAtUtc`) | token hash, product, state, dates, sealed token | deleting an account does not cancel the Google subscription; needed to stop token reuse, to reconcile while paying and to allow a verified restore | token 180 days / row 5 years after the purchase ended |
| Sign-in identity at Microsoft Entra External ID | email, provider, name (outside Juple) | **not deleted** - see section 5 | until removed at the identity provider |
| Logs | internal ids, billing event ids; never tokens | platform | 30 days |

Removed immediately: profile, all links/Collections/memos/comments/friends/notifications/push devices/support data, the Google account-id mapping (`GoogleAccountLinks`). Photos: durable Blob cleanup (confirmed by a second sweep).

## 4. Sealed purchase token: can it be purged without breaking billing?

`VerificationHandleEncrypted` is now nullable (`VerificationHandlePurgedAtUtc` records the purge). Only the 180-day-after-terminal rule clears it; the row, `ExternalKeyHash` and state stay. Checked:

- **Conflict detection** uses `(Source, ExternalKeyHash)` unique - untouched, so a token can never belong to two accounts.
- **Verify / restore** with a token the app presents hash it themselves and `ApplyVerified`/upsert never write the handle for an existing row, so a purged row is simply re-verified (and may reactivate through the normal path). Restore-without-tokens skips purged rows (nothing to ask Google with).
- **RTDN** carries its own token; the event path re-seals when it needs to. A notification for a purged purchase still works.
- **Periodic reconcile** selects only rows with a handle; a purged row is a long-ended purchase with nothing to re-check, and reconcile returns "not taken" if it is ever reached.
- Covered by unit and integration tests (purged restore, re-presented token reuses the same row, another account still gets 409).

## 5. Trial ledger and the Entra identity

- **Key:** `HMAC-SHA256(Billing:TrialIdentityHashKey, "juple-trial-v1|tenantId|objectId")`, tenant/object read from the access token (`HttpContextExternalIdentityAccessor`). Not email-based.
- **Dependency on Entra:** re-signup protection works only while the same person signs in with the **same Entra object id**. Deleting the Entra user would give a new object id on the next sign-in -> a new hash -> a fresh trial. So keeping the Entra object is what makes the ledger meaningful today.
- **Entra deletion by the backend:** there is **no Microsoft Graph client, no Graph permission and no app/managed-identity grant to Entra anywhere** in the backend or `infra/`. The Juple API only validates tokens (`Microsoft.Identity.Web`). Deleting an External ID user would need a Graph call with `User.ReadWrite.All` (application permission, or `User.DeleteRestore.All`) granted to a service principal or workload identity in the External ID tenant, admin-consented. That is a tenant-wide power (read/write/delete every user), so it would be a high-impact credential in the API's trust boundary; a narrower design would be a separate, tightly scoped Job/function. **Nothing was changed or requested in Azure/Entra.**
- **Re-signup semantics, Email vs Google:** a deleted-then-recreated Entra user gets a new object id regardless of method. With the Entra user kept, signing in again with the same method returns the same object id (so a new Juple account, the original trial window). A different method (e.g. Google instead of email) is a different Entra user unless linked, so it is a different identity and a new trial; that gap exists today and is not specific to deletion.
- **Known trial-identity gaps (open, deliberately not solved in the retention round; a separate "trial identity" round owns them):**
  1. **Entra identity deleted, then re-registered -> a new object id -> a new hash -> a fresh 30-day trial is possible.** For this reason no Entra deletion code, Graph permission or Azure/Entra change has been added.
  2. **A different sign-in identity/provider that yields a separate object id (for example Google instead of email, or a second Entra user) -> a new trial is possible.** The ledger identifies an Entra object, not a person.
- **If the Entra user must be deleted (full erasure):** keep the ledger working first by migrating the key to something that survives the object id (for example an HMAC of a verified, normalized email), which stores more personal data, **[REVIEW REQUIRED]**; or accept that trial reuse becomes possible after full erasure. Not implemented; first release keeps option A (keep identity, disclose, offer deletion on request through support).

## 6. Open items

1. **[REVIEW REQUIRED]** 5-year purchase-record period (legal/accounting; may need to be longer for tax records or shorter for privacy) and whether the 180-day sealed-token period fits Google refund/dispute windows.
2. **[REVIEW REQUIRED]** whether a keyed hash is personal data in the operating jurisdiction (the code treats it as possibly personal) and the 24-month ledger period.
3. Entra identity deletion policy and the two trial-identity gaps (section 5), plus the privacy-policy wording about them - owned by the future trial-identity round.
4. Telemetry/crash reporting does not exist; if added, its retention must be added here.
5. Not deployed: the retention Job exists in `infra/azure/retention-cleanup-job` but is not deployed to any environment.
