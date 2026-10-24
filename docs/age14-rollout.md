# Minimum age rollout

The service owner chose a minimum account age of 14 on 2026-10-25. Age confirmation is a self-declaration, not identity verification. Existing Terms acceptance does not prove a member's age.

## Compatible deployment

- Keep Production `Terms__CurrentVersion=2026-10-14` and `Terms__EnforceAcceptance=false` while Android v33 and iOS 1.0 (1) remain supported. Do not raise the minimum supported build as part of this deployment.
- The API accepts the old `{ version }` request for the old policy. An explicit `isAtLeast14: true` is required when accepting `2026-10-25`. Missing or false declarations must not create acceptance of that policy.
- Age self-declaration is requested in the Terms agreement screen. Sign-in entry points do not show a separate age popup. Existing authenticated sessions are preserved. The old clients do not gain age confirmation through an API deployment.
- Web and mobile Terms screens require all three confirmations. A later policy activation requires existing members to reconfirm; a successful current acceptance is reused across restarts and devices.
- Changing the published text or shipping the new binary alone does not mark legacy accounts age-confirmed. No underage account is inferred or automatically deleted.

## Activation is separate

Only activate the new current version and enforcement after age-aware Android and iOS clients are available and the supported-client transition has been reviewed. Android v33 and iOS 1.0 (1) cannot accept the new policy; do not activate it while those clients must continue without forced updates. Agree on handling of unconfirmed existing accounts before activation.

The existing acceptance version and timestamp record acceptance of the new age policy without a database migration. No date of birth, identity document, or guardian information is introduced. Do not run a migration for this change.

The Entra-hosted direct signup entry point is not an age-verification service. Regional child-privacy requirements and the actual overseas-processing notice still require operational/legal confirmation. Do not describe this staged deployment as completed age verification of all accounts.

## Release controls

Keep subscriptions disabled. Preserve APNs, Associated Domains, App Group and Share Extension. Retain TestFlight 1.0 (1). A new build needs a distinct build number. Deploy API first, verify health and legacy contract, then deploy Web. App Store review submission and public release remain separately authorized actions. Physical iPhone testing is deferred by the owner.
