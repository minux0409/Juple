# Subscription launch policy and activation checklist

Describes what the code does at `d20b102` and what has to happen before `Billing:ProgramEnabled` is turned on. `ProgramEnabled` is **false** (`appsettings.json`);
turning it on is not part of any current task.

## 1. Access rules the code implements

| Account state | Entitlement status | Read | Write | Notes |
|---|---|---|---|---|
| Within the free trial (30 x 24 h from account creation, or from `ProgramStartAtUtc` for earlier accounts) | `trial` | yes | yes | Juple-controlled, not a store offer. Anti-reset through the trial ledger |
| Valid subscription (Google ACTIVE) | `active` | yes | yes | |
| Billing problem, grace period (IN_GRACE_PERIOD) | `gracePeriod` | yes | yes | re-verified at least daily; never open-ended |
| Cancelled but paid period not over (CANCELED) | `active`, reason `cancelled`, `AutoRenews=false` | yes | yes | access ends at the store expiry |
| Account hold (ON_HOLD), paused, expired, refunded/revoked | `expired` | yes | **no** | reasons billingIssue / paused / cancelled / refunded are copy only |
| Pending purchase | no access granted | yes | per trial/other purchases | never acknowledged until active |
| `ProgramEnabled=false` (today) | `status null`, `canWrite true` | yes | yes | nothing is checked or started; no trial starts |

- **Writes** that need access: saving links, editing/deleting links, Collections (create/edit/delete), sharing, invitations (send/accept), collaborators, comments, reactions, friends (create/accept), image uploads, copy/move/merge, public-link writes. The server answers `403 subscriptionRequired`.
- **Always allowed (any state):** account, sign-in/session, bootstrap, billing verify/restore, support, push registration, settings (profile, language, lock password, notification preferences, notifications, recently opened, URL metadata lookup) and exit/safety actions (leave a Collection, decline, cancel my own request, stop sharing, unlock/reveal, my own lock, remove friend/cancel request).
- **Shared Collections:** a write needs **both** the acting person **and** the Collection's owner to have live access (otherwise `403 collectionOwnerSubscriptionRequired`). Reading is never blocked, so an expired owner's Collection is simply frozen for everyone. Public-link writes are gated the same way against the link's owner. There is no separate time-based "frozen snapshot".
- **Billing/restore:** always available. A restore of an already expired purchase does not reactivate access.
- **Mobile:** one subscription prompt for a refused write (owner-expired variant has no buy button), an "expired" notice on Home and Collections, the Subscription screen reachable in every build. The My Page *entry* to the screen is still limited to internal-test builds.

## 2. Differences between the code and older documents
- `docs/architecture.md` now matches the code: the gate is applied, and the first release deliberately uses "writes are blocked for expired actors or owners, reads stay open" instead of a time-based freeze. `VisibleSinceUtc`/the compatibility default remain in the schema, unused by queries.
- `docs/google-play-billing-setup.md` lists the Play product as proposed; DEV uses `juple_monthly` / `monthly` (confirmed ACTIVE).
- The My Page subscription entry is internal-test only; a production entry (or a reachable alternative) is part of activation.

## 3. Activation checklist (do in this order, only when approved)
1. **Decisions:** trial/pricing statement, legal text. Retention has a working policy (trial ledger 24 months after trial end; purchase token 180 days / record 5 years after the purchase ended) enforced by the daily retention Job (`data-retention.md`); the 5-year value and the ledger's personal-data status still need legal/accounting review before launch, and the retention Job must be deployed first.
2. **Store readiness:** production Play subscription active at the intended price, RTDN topic/subscription and credentials for production, tested refund/revoke path.
3. **Config (production):** `Billing:TrialIdentityHashKey` (Base64 >= 32 bytes, distinct from the other billing keys), `Billing:ProgramStartAtUtc` (a future instant), `Billing:TrialDurationDays=30`, `Billing:ProgramEnabled=true` last. The API refuses to start on an invalid combination.
4. **Client minimum:** the enforcement UI ships in the app build that contains this work. Older builds show only generic errors on a refused write, so raise `MinimumSupportedBuild` (or accept that) **before** the program starts, and confirm the new build is downloadable first.
5. **Visible entry:** make the Subscription screen reachable for normal users (My Page row or equivalent).
6. **Disclosure:** subscription terms and the privacy policy published; Play Console subscription disclosure filled in.
7. **Smoke test on production:** new account -> trial status; expiry via an account created in the past; purchase; restore; refund.
8. **Rollback:** setting `ProgramEnabled=false` returns to "no checks"; stored trial windows and the ledger are kept.
