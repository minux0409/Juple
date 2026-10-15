# UGC safety and moderation (Google Play User Generated Content policy)

Status: implemented in the API, Mobile and Web; **not deployed to PROD**; not a release-readiness statement.

## What exists

| Area | Behaviour | Where |
| --- | --- | --- |
| Terms of Service acceptance | The server stores `Users.AcceptedTermsVersion` / `TermsAcceptedAtUtc` (one acceptance per account and version, covering the Terms of Service and the personal-information collection and use agreed together on the Agreement screen). The current version is configuration `Terms:CurrentVersion`. The Agreement is shown by mobile and web **right after sign-in, before the tutorial and Home**; there is no skip, X signs out. While `Terms:EnforceAcceptance=true`, every authenticated endpoint answers **403 `termsAcceptanceRequired`** without the current version except the pinned allowlist (bootstrap, terms status / acceptance, session check, push-device lifecycle, account deletion - `TheEndpointsThatWorkBeforeAcceptance_*` test). A new device or a later sign-in does not ask again; a newer version does. `Terms:EnforceAcceptance=false` remains the rollout switch. | `Juple.Api/Safety/TermsAcceptance.cs`, `SafetyController`, `apps/mobile/src/safety`, `apps/web/app/(app)/TermsAgreement.tsx` |
| Reports | `POST /api/v1/reports` (`targetType` User / Collection / Item / Comment, `targetId`, `collectionId` for an Item, `reason`, `details` <= 1000). 201 new, 200 already open, 404 not visible / unknown, 400 own content. One OPEN report per reporter + target (filtered unique index). | `Juple.Application/Safety`, `safety.ContentReports` |
| Blocks | `POST` / `DELETE /api/v1/users/{jupleId}/block`, `GET /api/v1/users/me/blocked-users`. Idempotent. Ends a friendship / pending request between the two. | `safety.UserBlocks` |
| Enforcement | `IUserBlockPolicy` / `BlockGuard`: friend request, collaboration invite and accept, join request / public save / approve, comment, reply, heart, reaction, Juple ID lookup, notification materialization (also for events queued before the block). Blocker's comment listing hides the blocked person's comments. | see code |

## Rollout order (important)

Every existing account starts WITHOUT an accepted Terms version. Clients that predate the Agreement screen (Android v25 and earlier) cannot show it, so the PROD switch `Terms__EnforceAcceptance` stays `false` until the build with the Agreement is the minimum supported build; activate in this order: backend deployed, web deployed, the new mobile build downloadable from Play, `MinimumSupportedBuild` raised to it, then turn enforcement on. With enforcement off the Agreement is still shown by the new clients and the acceptance is recorded.

## Block semantics (decision)

* A block restricts **interaction in both directions** but deletes nothing and **removes nobody from a shared Collection**: the Owner keeps the Collection and its links; a member keeps membership. Interaction (comments, hearts, reactions, invitations, requests) is what stops. Rationale: automatic removal would let a block destroy another person's access / data.
* The blocked person is never told: when the OTHER person blocked the caller the API answers `interactionNotAllowed` (or "Juple ID not found"), not "you are blocked". Only the blocker gets `userBlocked`.
* The blocker no longer sees the blocked person's comments (others still do).
* A public share link is a public URL and is not affected by a block.
* Unblocking never restores a friendship.

## Operating the queue (no admin API yet)

Juple has **no operator authorization**. A public or "any signed-in user" admin endpoint would let anyone read or change reports, so none was created. Until a real admin mechanism exists, reports are handled with SQL against the DEV / PROD database by an authorized operator:

```sql
-- pending reports, oldest first
SELECT r.Id, r.CreatedAtUtc, r.TargetType, r.TargetId, r.TargetUserId, r.CollectionId, r.Reason, r.Details
FROM safety.ContentReports r WHERE r.Status = 'Pending' ORDER BY r.Id;

-- who/what a target is
SELECT PublicCode, DisplayName FROM users.Users WHERE Id = @TargetUserId;
SELECT Id, Name, UserId, DeletedAtUtc FROM collections.Collections WHERE Id = @CollectionId;
SELECT Id, UserId, Body, DeletedAtUtc FROM collections.CollectionItemComments WHERE Id = @CommentId;

-- close a report (Reviewed | Dismissed | Actioned) - ReviewedAtUtc is required by a CHECK constraint
UPDATE safety.ContentReports SET Status = 'Actioned', ReviewedAtUtc = SYSUTCDATETIME(), Resolution = N'Removed the comment' WHERE Id = @Id AND Status = 'Pending';
```

Actions on content / users are also manual (delete the comment or Collection, restrict the account at the identity provider). Rules for the operator: read-only first; never copy `Details` or personal data out of the database; record what was done in `Resolution`; one person, two-step for account actions; a report is evidence - do not delete it.

### Future admin API (TODO, needs operator authorization first)

`GET /api/v1/admin/reports?status=Pending`, `GET .../{id}` (with the target resolved), `POST .../{id}/resolve`; an `Operator` role in the identity provider + a dedicated authorization policy; an audit table of who changed what; SLA and notification of the reporter are product decisions.

## Account deletion

* `UserBlocks` rows of either account are deleted.
* `ContentReports`: `ReporterUserId` and `TargetUserId` are **cleared** (set to NULL), the report stays as anonymous moderation evidence.
* Terms acceptance lives on the user row and goes with it.

## REVIEW REQUIRED (legal / privacy owner, before PROD)

1. Retention period of `ContentReports` (and `Details`) after a report is closed - none is set in code or in `docs/data-retention.md`; the privacy policy says "kept as far as safety and policy enforcement need".
2. Whether the report `Details` and the reporter / target identifiers need a retention limit or a privacy-policy disclosure beyond the current text.
3. The wording of the user-facing Terms section "5-1 신고와 차단" and the enforcement actions listed in section 8.
4. Response-time commitments (none are made in the product).

## Play Console

The app now has in-app reporting, blocking and a Terms agreement at onboarding. Still to do outside this repository: the Play Console content-rating / UGC declaration, a published contact for reports, and a documented review process (this file is the starting point).
