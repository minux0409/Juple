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

- **Writes** that need access: saving links, editing/deleting links, Collections (create/edit/delete), sharing, invitations (send/accept), collaborators, comments, reactions, friends (create/accept), image uploads, copy/move, public-link writes. The server answers `403 subscriptionRequired`.
- **Always allowed (any state):** account, sign-in/session, bootstrap, billing verify/restore, support, push registration, settings (profile, language, lock password, notification preferences, notifications, recently opened, URL metadata lookup) and exit/safety actions (leave a Collection, decline, cancel my own request, stop sharing, unlock/reveal, my own lock, remove friend/cancel request).
- **Shared Collections:** a write needs **both** the acting person **and** the Collection's owner to have live access (otherwise `403 collectionOwnerSubscriptionRequired`). Reading is never blocked, so an expired owner's Collection is simply frozen for everyone. Public-link writes are gated the same way against the link's owner. There is no separate time-based "frozen snapshot".
- **Billing/restore:** always available. A restore of an already expired purchase does not reactivate access.
- **Mobile:** one subscription prompt for a refused write (owner-expired variant has no buy button), an "expired" notice on Home and Collections, the Subscription screen reachable in every build. The My Page *entry* to the screen is still limited to internal-test builds.

- **Stores:** Google Play and the App Store feed the same account entitlement (`billing.StorePurchases`, `Source`); the best live purchase or trial wins, so a payer on one store is entitled on every platform. Two live subscriptions never add up: access follows the latest end, and the person is told to cancel one in its store.
- **Plans:** monthly US$1.99 and yearly US$19.90 (about 17% off in the US). The discount is computed per storefront in the app from the stores' own prices, never fixed. Details: `google-play-billing-setup.md`, `apple-app-store-billing-setup.md`.
- **Existing users:** their grace period is not decided. Nothing restricts anyone until `Billing:ProgramEnabled=true`; expiry never deletes data (read-only).

## 2. Differences between the code and older documents
- `docs/architecture.md` now matches the code: the gate is applied, and the first release deliberately uses "writes are blocked for expired actors or owners, reads stay open" instead of a time-based freeze. `VisibleSinceUtc`/the compatibility default remain in the schema, unused by queries.
- `docs/google-play-billing-setup.md` lists the Play product as proposed; DEV uses `juple_monthly` / `monthly` (confirmed ACTIVE).
- The My Page subscription entry is internal-test only; a production entry (or a reachable alternative) is part of activation.

## 3. Activation checklist (do in this order, only when approved)
1. **Decisions:** the price is **decided** - US$1.99/month and US$19.90/year, Juple's 30-day trial, no store trial (`docs/subscription-policy-proposal.md` section 3a); still open: legal text, existing-user grace period, per-country prices the stores propose. Retention has a working policy (trial ledger 24 months after trial end; purchase token 180 days / record 5 years after the purchase ended) enforced by the daily retention Job (`data-retention.md`); the 5-year value and the ledger's personal-data status still need legal/accounting review before launch, and the retention Job must be deployed first.
2. **Store readiness:** production Play subscription with both base plans active at the intended prices, App Store Connect group with both products approved together with an app version (`apple-app-store-billing-setup.md`), RTDN topic/subscription and credentials for production, tested refund/revoke path.
3. **Config (production):** `Billing:TrialIdentityHashKey` (Base64 >= 32 bytes, distinct from the other billing keys), `Billing:ProgramStartAtUtc` (a future instant), `Billing:TrialDurationDays=30`, `Billing:ProgramEnabled=true` last. The API refuses to start on an invalid combination.
4. **Client minimum:** the enforcement UI ships in the app build that contains this work. Older builds show only generic errors on a refused write, so raise `MinimumSupportedBuild` (or accept that) **before** the program starts, and confirm the new build is downloadable first.
5. **Visible entry:** make the Subscription screen reachable for normal users (My Page row or equivalent).
6. **Disclosure:** subscription terms and the privacy policy published; Play Console subscription disclosure filled in.
7. **Smoke test on production:** new account -> trial status; expiry via an account created in the past; purchase; restore; refund.
8. **Apple/Google flags:** `Billing:Apple:Enabled` and `Billing:Google:Enabled` are independent of `ProgramEnabled`; enable the store integrations first (purchases can then be verified while nobody is restricted), `ProgramEnabled` last. Required Apple secrets/settings: see `apple-app-store-billing-setup.md` section 2. Deploy order: apply migration `AddAppleAccountLinks` (additive), deploy API + billing worker + reconcile Job, keep both flags false, then configure and test.
9. **Old clients:** iOS build 8 has no membership flow and Android build 39 knows only the monthly plan; the catalog response only gained fields (`basePlanIds`), so both keep working. Raise `MinimumSupportedBuild` only for a reason in the release compatibility rule.
10. **Rollback:** setting `ProgramEnabled=false` returns to "no checks"; stored trial windows and the ledger are kept.
