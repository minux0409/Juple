# UGC safety and moderation (Google Play User Generated Content policy)

Status: implemented in the API, Mobile, Web and Admin; **not deployed to PROD**; not a release-readiness statement.

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

## Shared Collection policy

Reporting and blocking belong to **shared Collections** (the personal library and personal Collections have no report entry). Content is reported, people are blocked: a report asks operators to review, a block is an immediate personal protection. They are independent.

| What | After a block |
| --- | --- |
| Friendship, pending friend request | Ended; unblocking does not restore them |
| New friend request, invitation, join request, comment, reaction, notification | Limited in both directions, enforced on the server (`BlockGuard`, `NotificationEventStore`) |
| The blocked person's comments | Hidden on the blocker's screen |
| Shared Collections the blocked person owns | Out of the blocker's lists (`AccessibleCollections`), but the membership stays: they still open directly and appear under 차단한 사용자, so reading and leaving stay possible; they return on unblock |
| Links in an existing shared Collection (either person's) | Kept and visible to both; membership and approval state unchanged |
| The blocked person | Not told; a refusal looks like `interactionNotAllowed` / not found |
| Anonymous access to a public URL | **Not stopped by a block**: a public link stays public. To stop sharing, use remove member, leave or revoke the link |

Reports: Collection (`컬렉션 신고하기`, members and signed-in visitors of a public link via `POST /api/v1/public-shares/{publicId}/reports`) and link (`링크 신고하기`, someone else's link). Reasons offered: Spam, SexualOrInappropriate (부적절한 콘텐츠), Harassment, IntellectualProperty, Other; the server keeps accepting the older reasons for installed apps. One's own content is refused (`cannotReportOwnContent`); one open report (Pending or InReview) per person and target; the reporter is never shown to the target. A report deletes and hides nothing and stores a minimal snapshot (title or words, address).

## Operating the queue (Admin > 문의 관리 > 신고 관리)

`GET /api/v1/admin/reports`, `GET .../{id}`, `PUT .../{id}/status` (InReview = 검토 중, Dismissed = 조치 없음, Actioned = 처리 완료), `POST .../{id}/restriction` (공유 제한), `POST .../{id}/restriction/lift` (해제). JupleAdmin policy; each change is saved with an `AdminAuditLogs` record in one transaction, and the audit detail never holds the content or the note.

**공유 제한 (`safety.ShareRestrictions`) deletes nothing.** One row per decision, so the history stays.

* A restricted Collection: `CollectionAccessStore` answers "no access" to everyone but the Owner, so app and Web members get the same 404; the public link and its membership resolver answer like a link that does not exist; invitations and join requests are refused. Memberships are kept and come back when it is lifted. The Owner keeps managing it and sees a notice (`isShareRestricted`).
* A restricted link: gone for other members and the public page; the Collection's Owner and whoever added it keep it. Its comment thread and hearts are closed for everyone while the restriction lasts.
* A person or a comment cannot be restricted (409 `reportNotRestrictable`); act on those by hand as before. 조치 없음 is refused while a restriction is in force (409 `reportRestrictionActive`).

## Automatic check (limits)

`SharedContentFilter` is rule-based and runs after a comment, a link added to a shared Collection or a rename of a shared Collection succeeded: three or more addresses in a text, 20+ repeated characters, an address with credentials, a numeric host or a punycode host. A match only creates a report with `Source = AutoFilter` and no reporter; nothing is blocked, hidden or deleted, and a failure of the check never fails the write. An external link is not suspicious for being external. It uses no word list and no paid or AI service, so **it has false positives and misses plenty of abuse**: it does not make shared content safe, and it does not check Collection descriptions (the Collection has none) or a proposal before it is approved.

## Account deletion

* `UserBlocks` rows of either account are deleted.
* `ContentReports`: `ReporterUserId`, `TargetUserId` and `ReviewedByAdminUserId` are **cleared** (set to NULL), the report stays as anonymous moderation evidence. The snapshot of a report about the deleted person (their words, title or address) is cleared with them.
* `ShareRestrictions` keep the admin's number and the Collection's: an operator's record that holds no content.

## Data export

Reports and blocks are not part of the personal data export (reviewed, unchanged): the export contains a person's own library data. Whether a person's own reports and blocked list must be added is a **legal review item** below.
* Terms acceptance lives on the user row and goes with it.

## REVIEW REQUIRED (legal / privacy owner, before PROD)

1. Retention period of `ContentReports` (and `Details`) after a report is closed - none is set in code or in `docs/data-retention.md`; the privacy policy says "kept as far as safety and policy enforcement need".
2. Whether the report `Details` and the reporter / target identifiers need a retention limit or a privacy-policy disclosure beyond the current text.
3. Whether the data export must include a person's own reports and blocked list, and the retention of report snapshots and `ShareRestrictions`.
4. The wording of the user-facing Terms section "5-1 신고와 차단" and the enforcement actions listed in section 8.
4. Response-time commitments (none are made in the product).

## Play Console

The app now has in-app reporting, blocking and a Terms agreement at onboarding. Still to do outside this repository: the Play Console content-rating / UGC declaration, a published contact for reports, and a documented review process (this file is the starting point).
