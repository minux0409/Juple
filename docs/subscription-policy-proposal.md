# Subscription: current state, policy proposal and what is still open

> **Decided (product owner):** monthly auto-renewing subscription, base price **US$1.99 / month**, no annual product for now, Juple-controlled 30-day free period from account creation, **no store free trial**. See section 3a. This is a policy statement only: no store product exists or was changed, PROD billing is off, and nobody is charged or blocked.

Companion to `docs/subscription-launch-policy.md` (what the code enforces and the activation checklist). This page answers three things: **what already exists** (and what does not), **which free-trial model to use**, and **what must be decided or set up by hand** before the program is switched on. Nothing here activates anything: `Billing:ProgramEnabled` is `false` in PROD, no price is shown anywhere, and the app never blocks a person because a subscription is missing.

## 1. What exists today (verified in the repository)

| Area | State |
|---|---|
| Entitlement model (server) | Built (R39-A). Account-centric `IEntitlementService`, states `trial / active / gracePeriod / expired`, decided from **server time**. `Billing:ProgramEnabled` (default `false`) is the single switch: while off, `status null`, `canWrite true`, no trial starts, nothing is checked. |
| Free trial | Built, **Juple-controlled**: 30 x 24 h from account creation (or from `ProgramStartAtUtc` for accounts that already exist). `billing.TrialLedger` (keyed hash of the Entra identity, no FK to users) stops a delete-and-re-register from earning a second trial. |
| Write gate | Built. `RequireWriteAccess` (403 `subscriptionRequired`), shared Collections need the actor **and** the Collection's owner to have access. Reads, export, account, billing and support are never blocked. |
| Google Play | Built server-side (R39-B1): verification through `subscriptionsv2`, server acknowledgement, RTDN (Pub/Sub OIDC), outbox + reconcile Job + worker, refund/revoke handling, account link by an opaque id, purchase-token sealing. Android client built (`react-native-iap` 16.7.2, Play Billing 9.1). **DEV is configured** (`juple_monthly` / `monthly`, confirmed ACTIVE). **PROD: not configured** - `googleBillingEnabled` is an explicit environment input and `billingProgramEnabled = false`; Play Console product, RTDN, Key Vault secrets are pending (R39-B2). |
| Apple App Store | **Not built.** There is no App Store Server API verification, no App Store Server Notifications V2 endpoint, no StoreKit purchase flow and no App Store product. `billing.StorePurchases` is store-neutral (`Source` column), so Apple can be added without a new model, but the code path does not exist. `react-native-iap` supports StoreKit; the iOS build was never validated on this Windows machine. |
| Web | **Read-only** (`apps/web/app/(app)/me/subscription`): shows the server's status and points to the store to manage it; the Web does not sell. It appears only while the program is live. This is the right default (see 3.4). |
| Mobile UX | Existing: free-period card on Home (`TrialNotice`: once at the start, then at most daily in the last 7 days), "expired" notice, a prompt on a refused write, the subscription screen (Android), `DataRetentionCard`. **Added in this change:** a **멤버십** row in My Page and a Membership screen. They exist only while the Backend says the program is live. On Android with the store catalog the screen is the existing subscription screen; everywhere else (iOS until it has purchases) it is a read-only status page: the one status the server reported, "your membership follows your Juple account on Android, iOS and the web", "we don't delete your saved links or collections", and that subscribing from this device is not available yet. It states no price, no term and no date the server did not send. |
| PROD today | Program off for every user: nobody is asked to pay, nothing is gated, the new menu row and screen are not reachable, and no trial has started. Android is still in closed testing; iOS is in the store without any subscription. |

## 2. Free trial: account-based vs store-based

| | **A. 30 days from account creation (Juple-controlled)** - what the code does | **B. Store free trial (App Store introductory offer / Google Play free-trial offer)** |
|---|---|---|
| Who owns the clock | Juple server | Apple / Google |
| Works the same on iOS, Android and Web | Yes - one account, one trial | No - each store grants its own; a person can take one on each platform (**double-free**) and a new Apple ID / Google account can take another |
| Anti-reset | Ledger keyed to the Entra identity (and the sign-in email while Entra deletion is on) | Eligibility is per store account (Apple: once per subscription group per Apple Account; Google: per Google account, configurable), not per Juple account - Juple cannot enforce it |
| Reinstall / new device / platform switch | Unaffected (server state) | Reinstall is fine; switching platforms starts a different store relationship |
| Card needed at start | No | Yes (this is the main commercial advantage: higher trial-to-paid conversion, and the store owns consent for auto-renewal) |
| Disclosure burden | Plain notice in the app | App Store Guideline 3.1.2 / Play subscription policy: trial length, the price after the trial, auto-renewal and how to cancel must be clear before the purchase |
| Complexity | Already built and tested | Needs offer setup per store, eligibility handling, and reconciling a store trial with Juple's own window |

**Recommendation:** keep **A** as the only free period and create the store subscription **without** a store trial. A purchase made during the trial starts billing immediately (the store's price is shown at purchase). This avoids double-free offers, keeps one rule for all three platforms, and keeps the Web consistent. Use **B** only if the business deliberately wants card-up-front conversion - then set Juple's trial to 0 days for new accounts (never run A and B together). This is a **decision for the product owner**; the code path for A is ready and B is not built.

Store rules to re-check at activation (they change): Apple requires a restore-purchases control and clear price/term disclosure before purchase; the subscription must be created in the Paid Apps Agreement context; Google requires the subscription terms in the purchase flow and the data-safety/subscription disclosure in Play Console.

## 3. Proposed policy (for approval - none of it is applied to PROD)

1. **New accounts:** 30-day free period (model A). Starts at account creation; the server states the end date; the app shows it and nothing else about it is computed on the device.
2. **Existing accounts:** the code gives them `ProgramStartAtUtc .. +30 d` (a full 30 days starting when the program starts), so nobody loses access on the day it launches. **Decision needed:** keep 30 days, lengthen it (for example 90) as a thank-you, or grandfather them. Announce at least 14-30 days before `ProgramStartAtUtc` (the Home card appears at the start; an earlier announcement needs an in-app notice or a Notice).
3. **Expired:** read-only. Existing data is never deleted or hidden; reading and account/billing/support stay open; content changes need a subscription. **Decision needed:** keep **data export** available when expired (recommended; it already is today) and how long data is kept for an account that never returns (`docs/data-retention.md`).
4. **Web:** read-only status and a pointer to the store. Selling on the Web would need its own payment processor and legal review (and store rules on steering): not recommended for the first release.
5. **One account, all platforms:** access is decided by the server for the Juple account; a purchase on one store grants access everywhere. A store purchase is tied to a Juple account by an opaque id and a token can never belong to two accounts (409 on conflict).
6. **Price:** see 3a. Only what the store reports for the user's country is ever shown to a person, at purchase time.

## 3a. Confirmed price

| | |
|---|---|
| Product | one **monthly** auto-renewing subscription (billing period `P1M`); **no annual product** in this release |
| Base price | **US$1.99 per month** (United States, USD) |
| Free period | Juple's own 30 days from account creation (model A); **no** store introductory / free-trial offer; a purchase during the trial bills immediately |
| Other countries | Set per store from the store's own supported price points and local currency (a US$1.99 base converted by the store, then reviewed per territory). Juple does not choose, store or convert local prices. |

How the price is represented in the repository - **one place, never shown to a user**:
- `SubscriptionPricingPolicy.MonthlyUsdReferencePrice = 1.99m` (`backend/src/Juple.Application/Billing/SubscriptionPricingPolicy.cs`, with `ReferenceCurrency = "USD"`, `BillingPeriod = "P1M"`, `TrialDays`). It is the *business reference* the Admin workspace uses for planning; it is **not** a checkout price, and the Admin tooling states that revenue is never estimated as 1.99 x users.
- The mobile app and the Backend's public API carry **no** price. The Subscription screen shows the localized price string that Google Play (later the App Store) returns for the product (`localizedPrice` in the store offer) and disables purchasing when the store has no price. No client or API response is changed by this decision.
- The checks that keep it that way are the existing tests (`SubscriptionScreen`, `googleBilling`, `Expenses` reference-price test); this change adds no price literal to the app.

What still has to happen in the stores (not done here - needs separate approval and an authenticated console):
1. **Google Play:** set the US base price of the production base plan to US$1.99 and review the converted prices per country before activating. Play accepts USD prices in cent steps, so US$1.99 is expected to be available; confirm in the console.
2. **App Store Connect:** pick the US$1.99 price point for the monthly subscription (a standard price point) and review the equalized prices per storefront. If a storefront has no matching point, report the nearest available one - **do not** substitute a different price silently.
3. If either console cannot produce exactly US$1.99, stop and report the nearest possible price to the product owner; nothing in the code needs to change because the app reads the store price.
4. Existing-subscriber price protection is not relevant yet (no subscribers); it matters for any later change (store rules require notice/consent for increases).

## 4. Gaps and work for an Apple subscription (not done here)

Not implemented because it cannot be validated without a Mac, App Store Connect access and a sandbox account, and unverified payment code must not ship:

- Backend: App Store Server API client (JWT with the in-app purchase key), signed-transaction (JWS) verification with Apple's certificate chain, `appAccountToken` to bind a purchase to a Juple account (the equivalent of the Google opaque id), App Store Server Notifications V2 endpoint (idempotent, same outbox/reconcile pattern as Google), refund (`REFUND`/`REVOKE`) and billing-retry/grace handling, mapping to the existing normalized states, and the retention/deletion rules for Apple purchases.
- Mobile iOS: StoreKit purchase and restore through `react-native-iap`, `pod install` + a compile on a Mac, "Restore purchases" (required by Apple), the Membership screen's purchase section for iOS.
- Tests that need real services: sandbox purchase, renewal, cancellation, billing retry, refund, restore, reinstall, platform switch.

## 5. What has to be done by hand outside the repository

**App Store Connect / Apple**
1. Accept the Paid Apps Agreement; banking and tax information.
2. Create the subscription group and the monthly auto-renewable product; localizations, price, review screenshot and notes.
3. Create an In-App Purchase key and note the Issuer ID; give the Backend a way to hold it (Key Vault).
4. Set the Server Notifications V2 URL (production and sandbox) once the endpoint exists.
5. Sandbox testers; add the In-App Purchase capability in Xcode; update the privacy disclosures.

**Google Play Console / Cloud**
1. Production subscription product and base plan active at **US$1.99 / month** (DEV already uses `juple_monthly` / `monthly`); no free-trial offer (model A is decided).
2. Service account with Android Publisher access (verify with a read call); license testers for sandbox.
3. Pub/Sub topic and push subscription (OIDC audience = the production RTDN URL) and RTDN enabled in Play Console; send a test notification.
4. Upload a build that contains the billing permission to the closed-testing track before purchases can be tested; Data safety and subscription disclosure.

**Azure / configuration (PROD)**
1. Key Vault secrets: `Billing:TrialIdentityHashKey`, the Google account-hash key, the purchase-token encryption key, the Google credential (three keys must be distinct values).
2. Deploy the retention Job and the billing worker / reconcile Job.
3. `Billing:ProgramStartAtUtc` (a future instant) and, **last**, `Billing:ProgramEnabled=true`; raise `MinimumSupportedBuild` only after the new build is downloadable from the store.

## 6. Decisions still needed from the product owner

1. ~~Free-trial model~~ **decided: A** (30 days from account creation, no store trial).
2. ~~Base price~~ **decided: US$1.99 / month**. Still open: the per-country prices the stores propose (review before activation) and the exact wording of the terms shown at purchase.
3. Existing-user grace period (30 / 90 days / grandfather) and the announcement date.
4. Expired-account scope: confirm read-only, and keep export open; data retention for dormant accounts.
5. Whether iOS launches with purchases or follows Android.
6. Legal review: whether the keyed trial-ledger hash is personal data, the 5-year purchase-record retention, and the privacy-policy text.

## 7. Safe activation (summary)

Program flag default **off**; PROD stays off until products, verification and notifications are proven with sandbox accounts on both stores; no automatic charge can happen before then; a missing or unconfigured subscription never blocks the app. The ordered checklist is in `docs/subscription-launch-policy.md` section 3.
