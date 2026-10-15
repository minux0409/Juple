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

## 2. Password change -> sign in again elsewhere

Password reset/change happens entirely inside Entra's hosted page (SSPR from the `prompt=login` sign-in). The Juple backend never learns of it, and
Juple never handles a password.

**Measured on DEV (2026-10-14, External ID tenant `jupledev`):** after a password reset Entra itself moves the user's
`signInSessionsValidFromDateTime` to the reset instant (observed `lastPasswordChangeDateTime` = `signInSessionsValidFromDateTime` =
2026-10-14T23:40:27Z). Every refresh token and Entra sign-in session issued before that is rejected: a forced silent refresh in an
already-open Web tab failed, and the next sign-in asked for the (new) password after the account was chosen. An access token that was already
issued kept working until its own expiry (60-90 min) - there is no Continuous Access Evaluation for a custom API.

**Decision:** Entra already revokes, so Graph `revokeSignInSessions` is **not** added (no Graph permission, no revoke endpoint). It stays a
possible future enhancement (e.g. an explicit "sign out all devices" action), not a launch requirement.

**What the apps do (v26 security session reauthentication round):** the apps notice the revocation at the moments they check the session
and then ask the person to sign in again with one dialog - "다시 로그인이 필요합니다" / "계정 정보가 변경되었거나 로그인 세션이 만료되어 다시
로그인이 필요합니다." / 로그인하기 (17 languages; it never claims the password changed - a session can also end for other reasons).

- **Web** (`lib/sessionValidation.ts`, `lib/msalClient.ts` `checkSession`, `app/(app)/AppRoot.tsx`, `app/(app)/ReauthDialog.tsx`): a forced
  silent refresh (`acquireTokenSilent({ forceRefresh: true })`) right after the app is ready (a reload included), when the tab becomes visible or
  focused (at most once a minute) and every 5 minutes while visible. Only for these checks - API calls keep using the cached token and refresh
  only after a 401. The last check time is memory only. `InteractionRequiredAuthError` or an `invalid_grant`-type code -> the dialog; anything else
  (offline, timeout, Entra unreachable) keeps the session (an API call then reports a network failure, not a lost session). The dialog is
  rendered once for the whole app, has no close button and ignores Escape; every page's `onSessionLost` opens the same one. 로그인하기 clears
  this tab's MSAL cache locally and starts `loginRedirect` back to the same page; nothing the page held is kept.
- **Mobile** (`src/auth/session/sessionValidator.ts`, `src/auth/AuthContext.tsx`): a forced refresh (`getValidAccessToken({ forceRefresh: true })`,
  react-native-app-auth) when the app returns to the foreground (at most once a minute) and every 5 minutes while active; a cold start already
  refreshes. Only a genuine Entra rejection (`isEntraSessionInvalidError`, via `onSessionInvalidated`) clears the stored session and opens the
  dialog (`ConfirmDialog`, not dismissable, one button, shown once); network failures change nothing. 로그인하기 clears the local session and
  shows the sign-in screen; the Entra browser session is not ended first.

**Accurate limit (for support / privacy answers):** the apps detect an Entra session revocation **when they check the session** (foreground /
tab return, periodic check while in use, the next token refresh) and then require a new sign-in. It is not an instant server-side cut-off: a
device that is not used keeps its already-issued access token until that token expires (at most its 60-90 minute lifetime), and the API accepts
it until then.

**Follow-up round (not a v26 launch blocker): "Immediate server-side session revocation".** Candidate design, to be decided separately: keep Entra
access tokens; review a Juple server-side session cutoff / SecurityVersion layer; if needed, read Graph `signInSessionsValidFromDateTime` through a
cache so an already-issued access token can be refused early; design the Graph dependency, permission, cache and outage policy together. No Graph
permission, revoke call or per-request Graph lookup is added in v26.

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
