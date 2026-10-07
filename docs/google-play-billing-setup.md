# Google Play billing - external setup checklist (R39-B2)

R39-B1 built the Android billing client, the server-side verification, the Real-time Developer Notification (RTDN) webhook, the billing
worker / reconcile Job and the Azure definitions - and **configured nothing outside this repository**. Everything below is done by a person
in Google Cloud, Google Play Console and Azure during R39-B2, in this order. No Google project id, account, service account, product id or
secret value is written anywhere in the repo: placeholders in `<angle brackets>` are filled in at that time.

## 1. Google Cloud (one project, shared by Dev/Staging/Prod only if you accept shared quotas - separate projects per environment is cleaner)

1. Enable the **Google Play Android Developer API** (`androidpublisher.googleapis.com`).
2. Create a **service account** for the Juple backend (`<juple-play-api>`). Create a JSON key only if no stronger option is chosen (see "Credential"
   below); store it **directly in Azure Key Vault** as the secret `google-play-service-account` - never in a file in the repo, a parameter file
   or a chat.
3. Create a **Pub/Sub topic** for RTDN (`<juple-play-rtdn>`).
4. Grant **`google-play-developer-notifications@system.gserviceaccount.com`** the **Pub/Sub Publisher** role on that topic (this is what lets
   Google Play publish notifications).
5. Create a second service account for the **push subscription's OIDC identity** (`<juple-rtdn-push>`); it needs no roles except being allowed to
   be used by the subscription (Pub/Sub's service agent needs `iam.serviceAccountTokenCreator` on it).
6. Create a **push subscription** on the topic whose endpoint is the API's webhook `https://<api-host>/api/v1/billing/google/rtdn`, with:
   - authentication enabled, service account `<juple-rtdn-push>`, and **audience = exactly the webhook URL** (this becomes
     `Billing:Google:PubSub:Audience`; the service account email becomes `Billing:Google:PubSub:PushServiceAccountEmail`);
   - a **dead-letter topic** and a finite retry policy (so one permanently-bad message cannot be redelivered forever), and an acknowledgement
     deadline of at least 30 s.

## 2. Google Play Console

1. **Setup > API access**: link the Google Cloud project and grant the backend service account the minimum Play permissions for subscriptions
   (view financial data / manage orders and subscriptions as required for `subscriptionsv2.get` and `subscriptions.acknowledge`).
2. **Monetization setup > Real-time developer notifications**: enter the Pub/Sub topic name `<projects/.../topics/juple-play-rtdn>`, choose
   subscription notifications (and voided-purchase notifications), and use **Send test notification** - it must arrive at the webhook and
   appear as a `test` event in `billing.StoreEvents`.
3. **Create the subscription product** (proposed id: `juple_monthly`) with **one monthly auto-renewing base plan** (proposed id: `monthly`).
   Set the **US base price to the USD 0.99 target**; let Play convert the other countries and review the proposed local prices.
   The proposed ids are **proposals until Play Console confirms they are free and acceptable**. Do **not** add a free-trial or introductory offer:
   the 30-day trial is Juple-controlled, not a store offer.
4. Activate the base plan, and add a **grace period** and **account hold** for payment failures (the backend maps both).
5. Upload a build to **Internal testing**, add **license testers** and tester accounts, and install from the Play track (a sideloaded APK cannot
   buy). Test purchases are fast-renewing and cancel themselves - use them to exercise renewal, cancel, hold and refund.
6. Set `Billing:Google:ProductId` / `BasePlanId` to the confirmed ids in the environment (never in source).

## 3. Azure (DEV first)

1. Deploy `infra/azure/foundation/billing.bicep` (Key Vault, the `billing-events` queue, the billing identity and roles) into the existing Foundation
   resource group.
2. Create the Key Vault secrets (values are generated at that moment, never written to a file that is kept):
   `google-play-service-account` (the JSON), `google-purchase-token-key` (32 random bytes, Base64), `google-account-hash-key` (>= 32 random bytes, Base64) and,
   later, `trial-identity-hash-key`. The three keys must be different values.
3. Redeploy the API with `googleBillingEnabled=true` plus the product, base plan, audience and push service account (`infra/azure/app/main.bicep`); then deploy
   `infra/azure/billing-worker` and `infra/azure/billing-reconcile-job` with the same image tag.
4. Verify the API starts (a bad billing configuration stops it with a message naming the setting), the webhook rejects an unauthenticated POST (401),
   and Play's test notification is processed.

## 4. Sandbox purchase E2E (acceptance for R39-B2)

New purchase -> `verify` -> acknowledged -> entitlement `active`; renewal; cancel (access until the period ends, reason `cancelled`); payment failure ->
grace (`gracePeriod`) -> hold (`expired` + `billingIssue`); refund / revoke (`expired` + `refunded` - confirm it really arrives and is detected; this is the one
lifecycle the repo could not verify without a real refund); restore on a new install; the same purchase on a second Juple account (409); account deletion
with a live subscription, then restore from a re-created account.

## Credential - a stronger option to consider

The first release authenticates to Google with a service-account key held in Key Vault. If Google's workload-identity federation from the Azure managed identity is
practical, it removes the long-lived key entirely; the code is ready for it (`IGoogleCredentialSource` is the only thing that would change). It is deliberately not
part of R39-B1.

## Product ids (proposals only)

| | Proposed | Confirmed in Play Console |
|---|---|---|
| Subscription product | `juple_monthly` | _R39-B2_ |
| Base plan | `monthly` | _R39-B2_ |

Neither is hardcoded in the app or the backend: both come from configuration, which stays empty (billing disabled) until then.
