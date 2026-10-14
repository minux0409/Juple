# Auth session lifecycle (v26 launch-candidate round)

Facts below marked **verified** were read from code or from the live DEV/PROD tenants (read-only Graph queries) in this round.
Anything marked **to verify** has not been observed and must be measured on DEV before it is relied on.

## 1. Account deletion and re-creation

> **Superseded (same round):** the Entra user is now deleted together with the Juple account - see `docs/account-deletion-entra.md`. The text
> below records the analysis that led there; the "Entra identity is kept" choice and the open design decision at its end no longer apply.

### What happens today

| Question | Answer |
| --- | --- |
| Juple `User` deleted? | Yes - `DELETE /api/v1/account` (recent sign-in required, 5 min `auth_time`) removes all Juple-owned data in one SQL transaction; Blobs follow through the durable cleanup task. |
| Entra External ID user object deleted? | **No** (by design; `docs/architecture.md` trial ledger relies on the Entra object id staying the same, otherwise a new Entra identity would get a new 30-day trial). |
| Mobile tokens / cache | Mobile uses `react-native-app-auth` (AppAuth), **not MSAL**: there is no MSAL cache. `signOut` clears the local secure session and in-memory token only. |
| Entra browser session | **Not ended on mobile** (before this round): the Custom Tab keeps the Entra SSO cookie, so `prompt=select_account` lists the deleted account as signed in. Web uses MSAL `logoutRedirect`, which does end it. |
| Why a new account appears at once | Selecting that account signs in without credentials (SSO). The identity still exists in Entra, so the token is valid; `POST /users/me/bootstrap` found no Juple user and **created one** (first-use provisioning). Same for any other device/tab still holding a refresh token. |

The picker entry itself lives in the Microsoft-hosted page and the browser's cookie jar: the app cannot edit it. It can only end the session (below).

### What this round changed (controllable part)

1. **Server: account creation needs a recent sign-in.** `CurrentUserBootstrapService` requires the access token's `auth_time` to be within
   `RecentAuthentication.MaxAge` (5 min, same rule as account deletion) *only when no Juple account exists*. Existing accounts are never gated.
   Missing `auth_time` claim = not gated (today's behavior; PROD and DEV API registrations both emit `auth_time` - **verified**).
   Refusal = `403 recentAuthenticationRequired`.
2. **Mobile:** a refused restore signs out and drops the stale session (no silent re-provisioning); a refused sign-in re-asks for credentials
   (`prompt=login`, `max_age=0`) once and then creates the account - the explicit re-sign-up; cancel leaves no session.
3. **Web:** same, once per tab (marker in session storage), then local sign-out; no redirect loop.
4. **Mobile deletion ends the Entra browser session** (`logout` with `id_token_hint`, post-logout redirect = the already-registered
   `com.juple.app.auth://oauthredirect`), best effort, only after the account is deleted and the app is signed out. Ordinary sign-out is unchanged
   (keeps the account picker on purpose).

Not done on purpose: any permanent "this identity was deleted" tombstone (conflicts with the privacy policy); deleting the Entra user
(see the trial ledger above - needs a product decision, below).

### Open design decision (needs the owner)

Deleting the Entra user via Graph (`User.DeleteRestore.All` / `User.ReadWrite.All`, managed identity) would remove the account from the picker for good
and is the stricter privacy reading of "delete my account". Cost: the same email gets a new Entra object id, so the trial ledger (keyed by object id)
no longer recognises a returning person and a deleted-and-re-created account gets a fresh 30-day trial. Options: (a) keep as is (current);
(b) delete the Entra user and accept trial reset; (c) delete the Entra user and key the ledger by verified email hash (privacy review needed).
Not implemented.

## 2. Password change -> sign out everywhere

Current state: password reset/change happens entirely inside Entra's hosted page (SSPR from the `prompt=login` sign-in). The Juple backend never
learns of it. Client behavior already in place: a rejected refresh (`invalid_grant`) clears the mobile session (`isEntraSessionInvalidError`);
MSAL `acquireTokenSilent` failure signs the web app out.

What can and cannot be guaranteed:

- Refresh tokens: invalidated if Entra updates the user's `signInSessionsValidFromDateTime` - either by itself on password reset (**to verify** on
  External ID) or through Graph `user: revokeSignInSessions`.
- Access tokens already issued stay valid until they expire (default 60-90 min); there is no Continuous Access Evaluation for a custom API. The
  backend cannot shorten that without its own state, and no local "fake" session state is introduced.

Plan (nothing applied to PROD, no code written yet):

1. **DEV measurement first** (cheap, decides everything): two devices signed in (mobile A, mobile B or web). On A run the password reset flow.
   Then on B force a refresh (`forceRefresh` / wait for access token expiry or clear the access token). Record whether B's refresh gets `invalid_grant`.
   If yes -> Entra already revokes; only the access-token tail (<= token lifetime) remains - accept and document.
2. If no: add `POST /api/v1/account/sessions/revoke` - requires recent `auth_time` (5 min), calls Graph `revokeSignInSessions` for the caller's own
   object id, using the API's managed identity with the **application** permission `User.RevokeSessions.All` in the External ID tenant (least
   privilege: it cannot read or edit users). The mobile app calls it right after the password reset flow completes and then signs the current
   device out; the other devices fail at their next refresh and show the sign-in screen. Weakness: client-initiated (app killed mid-flow = not
   revoked) - acceptable for a first version, decide before PROD.
3. Permission grant and endpoint stay DEV-only until the DEV E2E below passes.

DEV E2E: (a) reset on A; (b) B refresh rejected; (c) web tab refresh rejected -> landing page; (d) old refresh token replay returns `invalid_grant`;
(e) A is signed out and can sign in with the new password; (f) the unchanged API access token keeps working until expiry (documented limit).

## 3. PROD user-visible branding

Read-only Graph queries (PROD tenant `30b18993-...`, DEV tenant `d2e79a05-...`):

| What the user sees | Source | PROD now | DEV now |
| --- | --- | --- | --- |
| Banner text "JUPLE PRODUCTION" on the sign-in page | Tenant display name (`organization.displayName`), shown as text because **no company branding / banner logo** exists | `Juple Production`, branding absent | `Juple Development` + banner logo uploaded |
| "Juple Production에 액세스" / account picker "Production" | Tenant display name (header text) | same | n/a |
| Consent / app names | App registration display names | `Juple Mobile (Production)`, `Juple API (Production)` | `Juple Mobile`, `Juple API` |
| User-flow strings | `JupleSignUpSignIn` (description "Juple Production - ..." is internal only) | internal | internal |

Portal changes to make on PROD (**not applied**; exact values):

1. Entra admin center (tenant `jupleprod`) -> Identity -> Overview -> Properties -> **Name**: `Juple Production` -> `Juple`.
2. Entra admin center -> User experiences -> Company branding -> Default sign-in experience -> **Edit**: upload the same **Banner logo** used in DEV (Juple wordmark),
   leave "Sign-in page text" empty, Save. (Without a banner logo the page falls back to the tenant name as text.)
3. App registrations: rename `Juple Mobile (Production)` -> `Juple` and `Juple API (Production)` -> `Juple` (display name only; client ids, scopes and redirect URIs do not change).
   Internal names (Azure resources `*-prod`, environment identifiers) stay.
4. Re-check the sign-in page and account picker in a private browser window; the tenant domain `jupleprod.onmicrosoft.com` can still appear in some
   Microsoft-owned screens - that value is not renamable.

## 4. PROD launch checklist items found in this round

- `auth_time` optional claim is present on the PROD API registration (**verified**) - required by account deletion, lock reset and the new account-creation gate.
- Old installed clients (v25 and earlier) that hit a refused creation show their generic bootstrap error instead of re-prompting; only affects an identity
  that has no Juple account *and* a stale sign-in (a returning, previously deleted user on an old build).
- Security audit follow-ups: see the round report (P2 list).
