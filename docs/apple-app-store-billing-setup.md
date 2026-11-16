# Apple App Store billing - setup, testing and activation

Status of the code (this repository): **implemented and unit-tested, not configured anywhere and not activated.** `Billing:Apple:Enabled` is
false, `Billing:ProgramEnabled` is false, no App Store product exists yet, and nothing here has been exercised against the real App Store
(Sandbox included) - that needs the steps below, which need an Apple Developer account and a Mac.

Companion documents: `docs/subscription-launch-policy.md` (what access rules the code enforces and the activation checklist),
`docs/google-play-billing-setup.md` (Android), `docs/architecture.md` ("Subscription foundation", "Google Play billing", "Membership plans and
the App Store").

## 1. The product model

One membership, two auto-renewing plans, **one subscription group** (so a person can hold only one at a time and Apple handles
upgrade/downgrade/crossgrade):

| Plan | Product ID (fixed - the server and app use these exact strings) | Duration | US price | Notes |
|---|---|---|---|---|
| Monthly | `com.juple.app.membership.monthly` | 1 month | US$1.99 | the same Juple access as yearly |
| Yearly | `com.juple.app.membership.yearly` | 1 year | US$19.90 | "about 17% off" - **computed per storefront in the app, never fixed** |

- These IDs are what the code and tests use (`AppleTestKit`, `appleBilling.test.ts`). The product in App Store Connect must have **exactly** these IDs
  (the yearly one is `...yearly`, not `...annual`), and the same strings go into `Billing:Apple:ProductIds` (API, billing worker, reconcile Job). The
  server refuses any other product. The app tells the two plans apart by StoreKit's subscription period, so the durations must be exactly 1 month and 1 year.
- Subscription group name (internal): `Juple Membership`. Both products are in it, yearly above monthly (level 1 = yearly, level 2 = monthly)
  so that monthly -> yearly is an **upgrade** (immediate, prorated by Apple) and yearly -> monthly is a **downgrade** (takes effect at the
  next renewal, Apple's rule). The app never computes either date: the server reads what Apple reports.
- **No App Store free trial / introductory offer.** Juple's own 30-day free period is account based (from sign-up) and is not a store offer. Do
  not configure an introductory offer, or a person could receive two free periods.
- Prices: pick the **US$1.99** and **US$19.90** price points for the United States, then let Apple propose the other storefronts and review them.
  The app shows each storefront's own price and recomputes the yearly discount from that storefront's monthly x 12 against its yearly price
  (`apps/mobile/src/billing/subscriptionPricing.ts`): where the ratio is not 10/12 the badge shows the real local percent, and where there is no
  saving it shows none. So the per-country tiers do not have to reproduce 16.67%.

## 2. What the server needs (configuration)

Never committed. Locally: `dotnet user-secrets` in `backend/src/Juple.Api`. Deployed: Key Vault references through the managed identity
(`infra/azure/app`, `billing-worker`, `billing-reconcile-job` - the Apple parameters are all optional and default **off**).

| Setting | What | Secret |
|---|---|---|
| `Billing:Apple:Enabled` | switch | no |
| `Billing:Apple:BundleId` | `com.juple.app` | no |
| `Billing:Apple:ProductIds:0..n` | the two product IDs above | no |
| `Billing:Apple:AcceptSandbox` | `true` for the first release (App Review and TestFlight buy in the Sandbox even against the production server); revisit after approval | no |
| `Billing:Apple:IssuerId` | App Store Connect > Users and Access > Integrations > In-App Purchase > Issuer ID | no |
| `Billing:Apple:KeyId` | the key id of the In-App Purchase key | no |
| `Billing:Apple:PrivateKeyPem` | the `.p8` file contents (PEM text) - Apple lets you download it **once** | **yes** |
| `Billing:Apple:AccountTokenKey` | Base64, >= 32 random bytes: derives the App Account Token of every account | **yes** |
| `Billing:Apple:HandleEncryptionKey` | Base64, exactly 32 random bytes: seals the stored original-transaction handle | **yes** |
| `Billing:Events:ServiceBusNamespace` | the existing billing-events namespace (worker wake-up) | no |

The two keys must be **distinct from each other and from** `Billing:Google:AccountHashKey`, `Billing:Google:PurchaseTokenEncryptionKey` and
`Billing:TrialIdentityHashKey` - the API refuses to start otherwise, naming the setting (`BillingOptionsValidator.ValidateApple`). Generate like
the other keys:

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
dotnet user-secrets set "Billing:Apple:AccountTokenKey" ([Convert]::ToBase64String($bytes))   # then repeat for HandleEncryptionKey with fresh bytes
Remove-Variable bytes
```

Key Vault secret names the Bicep references (values are created by hand, never in a template): `apple-iap-private-key`,
`apple-account-token-key`, `apple-handle-key` (override with `applePrivateKeySecretName` etc.).

**Rotation:** `AccountTokenKey` can never change once purchases exist (every account's token would change and Apple's notifications could no longer be
tied to accounts). `HandleEncryptionKey` has no keyring yet: changing it makes stored handles unreadable (the daily reconcile of those purchases stops
until each person restores). Treat both as write-once. The `.p8` can be rotated in App Store Connect (create a new key, change `KeyId` and
`PrivateKeyPem`).

### Database

Migration `AddAppleAccountLinks` (additive): table `billing.AppleAccountLinks (UserId unique, AppAccountToken unique)`. Apply it with the normal
migration process **before** enabling Apple billing; nothing existing is touched. Account deletion removes the person's row; a store purchase is
detached (not deleted) exactly like Google's.

## 3. App Store Connect - manual steps (not done)

1. **Agreements, Tax, and Banking**: the *Paid Apps* agreement must be active, with bank and tax information. Without it products cannot be sold.
2. **Subscription group + two auto-renewable subscriptions** (Monetization > Subscriptions): create the group, then the two products with the IDs
   in section 1 (the ID can never be changed or reused afterwards - confirm it before saving). Set the durations (1 month / 1 year) and the
   levels. Add each product's localized display name and description (the app does not show Apple's strings, but Apple requires them) and the
   review screenshot (the app's membership screen).
3. **Pricing**: US$1.99 / US$19.90, then review every storefront.
4. **In-App Purchase key**: Users and Access > Integrations > In-App Purchase > generate. Note the Issuer ID, download the `.p8` once, store it in Key
   Vault as `apple-iap-private-key`.
5. **App Store Server Notifications V2**: App Information > App Store Server Notifications - set **both** URLs to the same endpoint, version 2:
   `https://api.juple.co.kr/api/v1/billing/apple/notifications` (Production and Sandbox). Use the "Request a test notification" button: the server
   records it (event type `TEST`) and answers 200; check `billing.StoreEvents`.
6. **Subscription information on the product page / app**: the first auto-renewable subscription must be submitted **together with a new app version**
   (the subscription cannot be reviewed alone the first time). Attach the products to that version in the "In-App Purchases and Subscriptions" section.
7. **App Privacy / metadata**: the app already collects purchases only through Apple; state "Purchases" in App Privacy if prompted. Privacy policy and terms
   links are `https://<public host>/privacy` and `/terms` (`apps/mobile/src/config/legalLinks.ts`); the membership screen shows them next to Restore.
8. **Review notes**: tell the reviewer the membership is a Juple account subscription; the free 30 days are from sign-up (not a store offer); the paid
   program is switched on **server side** (`Billing:ProgramEnabled`) - until it is, no screen asks for payment. Provide a demo account.

### Required UI (already in the app)
Price, period and total before purchase; automatic renewal wording; how to cancel; **Restore purchases**; **Manage subscription**
(`https://apps.apple.com/account/subscriptions`); links to terms and privacy.

## 3a. Prepared App Store Connect inputs (to be entered by hand - not verified in App Store Connect)

- Group reference name: `Juple Membership` (reuse the group that already holds the monthly product; never create a second group).
- Levels: yearly = level 1, monthly = level 2 (monthly -> yearly is an upgrade, immediate; yearly -> monthly a downgrade, at the next renewal).
- Reference names: `Juple Monthly Membership` (`com.juple.app.membership.monthly`, 1 month) and `Juple Annual Membership`
  (`com.juple.app.membership.yearly`, 1 year).
- Prices: United States US$1.99 and US$19.90. If US$19.90 is not offered as a price point, **stop and report the available neighbours** - do not
  pick one silently. Review the other storefronts Apple proposes; the app computes the yearly discount per storefront.
- Introductory offers, promotional offers, offer codes and win-back offers: **none** on either product (Juple's own free month is the only one).
- Family Sharing: leave as it is until a business decision exists (turning it on cannot be undone for a product).
- Localizations (App Store Connect limits: group display name 75, subscription display name 35, description 55 characters; every entry below fits):

| Locale | Group display name | Monthly name | Monthly description | Yearly name | Yearly description |
|---|---|---|---|---|---|
| Locale | Group display name | Monthly name | Monthly description | Yearly name | Yearly description |
|---|---|---|---|---|---|
| ko | Juple 멤버십 | Juple 월간 멤버십 | Juple 멤버십의 모든 기능을 매월 이용하세요. | Juple 연간 멤버십 | Juple 멤버십의 모든 기능을 1년 동안 이용하세요. |
| en-US | Juple Membership | Juple Monthly Membership | Access all Juple membership features every month. | Juple Annual Membership | Access all Juple membership features for a full year. |
| ja | Juple メンバーシップ | Juple 月額メンバーシップ | Juple メンバーシップのすべての機能を毎月ご利用いただけます。 | Juple 年額メンバーシップ | Juple メンバーシップのすべての機能を1年間ご利用いただけます。 |
| zh-Hans | Juple 会员 | Juple 月度会员 | 按月使用 Juple 会员的全部功能。 | Juple 年度会员 | 一年内使用 Juple 会员的全部功能。 |
| zh-Hant | Juple 會員 | Juple 月費會員 | 按月使用 Juple 會員的所有功能。 | Juple 年費會員 | 一年內使用 Juple 會員的所有功能。 |
| es-ES | Juple Membership | Juple Membresía mensual | Todas las funciones de Juple, cada mes. | Juple Membresía anual | Todas las funciones de Juple durante un año. |
| es-MX | Juple Membership | Juple Membresía mensual | Todas las funciones de Juple, cada mes. | Juple Membresía anual | Todas las funciones de Juple durante un año. |
| fr-FR | Juple Membership | Juple Abonnement mensuel | Toutes les fonctions Juple avec un abonnement mensuel. | Juple Abonnement annuel | Toutes les fonctions Juple avec un abonnement annuel. |
| de-DE | Juple Membership | Juple Monatsmitgliedschaft | Alle Juple-Funktionen mit einem Monatsabo. | Juple Jahresmitgliedschaft | Alle Juple-Funktionen mit einem Jahresabo. |
| it | Juple Membership | Juple Abbonamento mensile | Tutte le funzioni di Juple con un abbonamento mensile. | Juple Abbonamento annuale | Tutte le funzioni di Juple con un abbonamento annuale. |
| pt-BR | Juple Membership | Juple Assinatura mensal | Todos os recursos do Juple com uma assinatura mensal. | Juple Assinatura anual | Todos os recursos do Juple com uma assinatura anual. |
| vi | Juple Membership | Juple Gói thành viên tháng | Dùng mọi tính năng của Juple theo tháng. | Juple Gói thành viên năm | Dùng mọi tính năng của Juple trong một năm. |
| th | Juple Membership | Juple สมาชิกรายเดือน | ใช้ฟีเจอร์ทั้งหมดของ Juple ด้วยการสมัครรายเดือน | Juple สมาชิกรายปี | ใช้ฟีเจอร์ทั้งหมดของ Juple ด้วยการสมัครรายปี |
| id | Juple Membership | Juple Keanggotaan bulanan | Semua fitur Juple dengan langganan bulanan. | Juple Keanggotaan tahunan | Semua fitur Juple dengan langganan tahunan. |
| ru | Juple Membership | Juple — месячная подписка | Все функции Juple с ежемесячной подпиской. | Juple — годовая подписка | Все функции Juple с годовой подпиской. |
| tr | Juple Membership | Juple Aylık Üyelik | Aylık abonelikle Juple’ın tüm özelliklerini kullanın. | Juple Yıllık Üyelik | Yıllık abonelikle Juple’ın tüm özelliklerini kullanın. |
| ar-SA | عضوية Juple | عضوية Juple الشهرية | استخدم كل ميزات Juple باشتراك شهري. | عضوية Juple السنوية | استخدم كل ميزات Juple باشتراك سنوي. |
| hi | Juple Membership | Juple मासिक सदस्यता | हर महीने Juple की सभी सुविधाएँ इस्तेमाल करें। | Juple वार्षिक सदस्यता | पूरे साल Juple की सभी सुविधाएँ इस्तेमाल करें। |

## 3b. App Review access before the launch (purchase preview)

`Billing:ProgramEnabled` used to decide three different things at once. They are now separate:

| Policy | Decided by | Effect of an App Review preview |
|---|---|---|
| Offering the purchase (My Page 멤버십 row, Membership screen, store catalogs) | `MembershipOffer`: `ProgramEnabled` **or** the account is in `Billing:PurchasePreviewUserIds` | the preview account is offered it |
| Existing members' free 30 days | `ProgramEnabled` + `ProgramStartAtUtc` | none - nobody's clock starts |
| Read-only after access ended (write gate) | `ProgramEnabled` | none - nobody is restricted |

- `Billing:PurchasePreviewUserIds:0..n` (Bicep `billingPurchasePreviewUserIds`, default empty) holds **internal Juple user ids** - the App Review demo
  account and internal testers. For them the bootstrap answers `membershipOffered: true` and `GET .../billing/{apple,google}/catalog` answers enabled
  (the store's own `Enabled` switch must be on too). Everyone else gets a disabled catalog and an app that shows nothing about membership, exactly as
  before. Verify and restore are never gated by it (a purchase Apple already charged is always recognised).
- Nothing is faked or bypassed: the demo account signs in normally, the products come from StoreKit, the receipt is Apple-signed and re-read from
  the App Store Server API. App Review buys in the Sandbox, so `Billing:Apple:AcceptSandbox=true` is required for the review.
- While the program is off a preview purchase records the subscription (the Membership screen shows 구독 중 / Manage) but grants nothing extra -
  everything is still free for everyone. Review note: say so plainly, and that the membership becomes required when the program launches.
- Older apps ignore `membershipOffered` and keep showing membership only once the program is launched.
- It is not a temporary bypass: after the launch it is simply redundant (everyone is offered), and it stays useful for internal testers of a future
  store change. Remove the review account from the list after approval if it should not keep the preview.
- Risk to state in the review notes: Apple may ask why the subscription unlocks nothing yet for other users (Guideline 3.1.2 "ongoing value",
  2.3.1 hidden features). The alternative is to launch the program on approval day; that is a product decision.

### PROD deployment this needs (not done - approval required)

PROD API revision `ca-juple-api-prod--0000035` runs image `collection-images-c852995-prod-20261102` (2026-11-02). It does **not** contain App
Store billing (`8919db8c`, 2026-11-07), the read-only policy, the new-account welcome flag or the purchase preview. In order:

1. Record the current revision and image digest (rollback target) and confirm the Azure SQL point-in-time backup window.
2. Apply migration `20261107083718_AddAppleAccountLinks` (additive: one new table, two unique indexes; nothing existing changes). It is the only
   migration since the deployed commit; `has-pending-model-changes` reports none.
3. Deploy the API, notification worker, billing worker and reconcile Job from the same commit, **keeping `billingProgramEnabled=false`**. Older apps
   keep working: every new response field is additive.
4. Apple settings (API + billing worker + reconcile Job): `appleBillingEnabled=true`, `appleProductIds` = the two ids, Issuer ID / Key ID, Key Vault
   secrets `apple-iap-private-key`, `apple-account-token-key`, `apple-handle-key` (two fresh, distinct 32-byte keys), `AcceptSandbox=true`.
5. `billingPurchasePreviewUserIds` = the demo account's internal user id (and internal testers).
6. App Store Connect: Server Notifications V2 URL (section 3 step 5) - the test notification then answers 200.
7. Rollback: previous revision (traffic switch). The new table can stay (unused by the old image).

## 4. Testing - what must be done and has NOT been done

Nothing below could be run on the Windows machine this was written on.

1. **Sandbox**: App Store Connect > Users and Access > Sandbox > create a sandbox Apple Account. On the iPhone sign in under Settings > Developer / App Store
   > Sandbox Account. Sandbox renews monthly plans every **5 minutes** (yearly every 1 hour) and renews at most 6 times - useful for renewal and expiry.
2. Matrix to run on a real device with a TestFlight / development build against a server with `Billing:Apple:Enabled=true`, `AcceptSandbox=true`
   (and `Billing:ProgramEnabled=true` on a throw-away environment only):
   - monthly purchase, yearly purchase (server shows `active`, mobile entitlement refreshes)
   - upgrade monthly -> yearly, downgrade yearly -> monthly (check `AccessEndsAtUtc` follows Apple's reported dates)
   - cancel auto-renew in Settings > Subscriptions (state `canceled`, access to the paid end), let it expire (state `expired`, writes blocked)
   - refund request (Xcode StoreKit transaction manager or Sandbox) -> `REFUND` notification -> state `revoked`
   - billing retry / grace (Sandbox: Settings > Developer > Subscription billing problems)
   - Ask to Buy (`pending`: nothing granted)
   - delete and reinstall the app -> sign in -> **Restore purchases** -> access returns; sign in on Android -> same access (server-side entitlement)
   - a second Juple account tries to use the first account's transaction -> 409 `purchaseBelongsToAnotherAccount`
   - redelivered and out-of-order notifications (replay a payload twice; the second answers 200 and creates no second event)
3. For local development without Apple, StoreKit configuration files in Xcode work for the purchase sheet but do **not** produce Apple-signed JWS the
   server will accept; use the Sandbox for end-to-end checks.

## 5. Mac steps for the new iOS build (not done)

The shipped iOS app (marketing version 1.0, build 8) already contains `react-native-iap`/`NitroIap` (see `Podfile.lock`): **no native change and no
new entitlement is needed for StoreKit** - the In-App Purchase capability needs no entitlement entry. A new build is needed only because the JavaScript
(the membership screen with the two plans) changed.

```bash
git pull                                  # the branch containing this work
cd apps/mobile && npm ci
cd ios && bundle exec pod install         # or: pod install
open JupleMobile.xcworkspace              # Xcode
```
1. Select the app target > Signing & Capabilities: confirm **In-App Purchase** is listed (add it with "+ Capability" if not; no entitlements file change).
2. Raise the build number (`CURRENT_PROJECT_VERSION`, currently 8) - and the marketing version if the release needs one. Both Debug and Release.
3. Production configuration: the Release build reads `JUPLE_API_BASE_URL=https://api.juple.co.kr`, `JUPLE_PUBLIC_WEB_HOST=juple.co.kr`, the production Entra
   values (`docs/auth-session-lifecycle.md`) exactly like the Android release (`apps/mobile/metro.release.config.js`); export them in the shell used for the
   Xcode build (or the build phase) - do not invent values.
4. Product > Archive > Distribute App > App Store Connect > Upload. In App Store Connect select the build for the new version, attach the two
   subscriptions to it and **submit the version together with the subscriptions** (section 3, step 6).
5. TestFlight first: install the build and run the Sandbox matrix above before submitting.
6. iOS Universal Links / Associated Domains are separate (`README.md`, "iOS Universal Links") and are not part of this work.

## 6. Activation order (do not skip)

1. Migration applied; secrets in Key Vault; Apple settings deployed (API, worker, reconcile Job) with `Enabled=true` **and `Billing:ProgramEnabled=false`**.
2. App Store Connect configured (section 3); a Sandbox notification test shows `TEST` in `billing.StoreEvents`.
3. Sandbox matrix passes on TestFlight (section 4).
4. New iOS version approved **with** the subscriptions; Android build with yearly available (`docs/google-play-billing-setup.md`).
5. Only then follow the activation checklist in `docs/subscription-launch-policy.md` (`ProgramStartAtUtc`, `MinimumSupportedBuild` for older apps,
   `ProgramEnabled=true` last). Rollback is `ProgramEnabled=false` (no checks resume, nothing is deleted).

## 7. How it works (for review)

- **Purchase**: app -> `GET /api/v1/billing/apple/catalog` (product ids + this account's App Account Token, a keyed-hash UUID) -> StoreKit products
  (localized prices come from StoreKit) -> `requestPurchase(sku, appAccountToken)` -> StoreKit update (signed transaction JWS) -> `POST .../verify` -> server
  verifies Apple's signature (chain to the pinned Apple Root CA - G3, ES256), reads the **original transaction id** only, calls the App Store Server API
  `GET /inApps/v1/subscriptions/{originalTransactionId}` (Sandbox or Production host from the transaction's own environment), checks bundle id, product
  allowlist and that the transaction's App Account Token is the caller's, normalizes the status and stores the purchase -> app `finish()`es the transaction
  and re-reads the entitlement. Nothing is granted from the StoreKit callback.
- **Notifications**: `POST /api/v1/billing/apple/notifications` (anonymous; the JWS signature is the authentication). Stored durably and idempotently (the
  notification UUID), the billing worker is woken, processing re-reads the authoritative status. A notification type is never applied.
- **Status mapping**: Active -> active; auto-renew off -> canceled (access to the paid end); billing grace -> gracePeriod (to Apple's reported grace end);
  billing retry -> onHold (no access); expired -> expired (reason from Apple's expiration intent); revoked or any revocation date -> revoked (refunded).
- **Cross-platform**: purchases live in the same `billing.StorePurchases` as Google's (`Source` = `AppStore`); the entitlement is the best of the trial and
  every verified purchase of any source, so a person paying on iPhone is entitled on Android and the web and is never asked to pay twice.
- **Duplicate subscriptions** (monthly on Google and yearly on Apple, say): access is the **latest** end of any live purchase, never a sum of periods; the
  person is told to cancel one in its store, the app does not cancel anything.
