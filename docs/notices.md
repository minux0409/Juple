# Notices

Notices use the existing separate Admin application, authenticated user APIs,
`JupleAdmin` authorization and Admin audit log. They never contribute to the
existing notification count and never trigger push delivery.

## API and visibility

User routes under `/api/v1/notices`:

- `GET /` with `platform`, `language`, `cursor`, `limit`.
- `GET /unread` with `platform`, returning `hasUnread`.
- `GET /{id}` with `platform`, `language`.
- `PUT /{id}/read` with `platform` and `{readVersion}`.

Admin routes under `/api/v1/admin/notices` provide list/search/status filtering,
detail, POST creation, PUT editing and DELETE soft deletion with a version token.
Publishing and stopping publication use the same version-checked update.

Only published, nondeleted notices with `StartsAtUtc <= now` and no expired end
are visible. Platform masks are Web=1, Android=2, iOS=4, all=7. Ordering is pinned
first, then publication start and ID descending. Important and pinned are independent.
Translations support the existing 17 languages with required Korean fallback.

## Read state and safe content

`notices.NoticeReads` has a composite user/notice primary key. The authenticated
user is resolved on the server. An atomic upsert revalidates visibility and the
detail's read version. Normal edits preserve reads; explicit `resetRead` increments
the notice version used for reads. Account deletion removes only that user's reads.
The user foreign key cascades, so an older API revision can still delete an account
after an application rollback without needing to know about the new read table.
Deleting a user does not delete notices or another user's reads.

Clients mark a notice read after detail rendering while visible/active. Read
failures preserve the unread indicator and offer retry. Focus, foreground and
periodic refresh use uncached server state. Authoritative missing/forbidden detail
responses remove stale content. HTML is rendered as text; only validated HTTPS
links are interactive. There is no raw HTML renderer or external translation API.

## Migration and rollout

`20261024121612_AddNotices` creates Notices, NoticeTranslations and NoticeReads
in schema `notices`, with visibility/read indexes and concurrency tokens. It does
not alter billing or export policy.

`20261024132839_PreserveNoticeReadAccountDeletionCompatibility` changes only the
NoticeReads-to-Users foreign key to ON DELETE CASCADE. It is a separate migration
because AddNotices was already applied; applied migration files are immutable.
Generate and review its SQL separately from AddNotices, and retain both migrations
when rolling back application images. Do not execute either Down migration during
an application rollback.

Production migration and rollout require separate authorization. Review a SQL
script for this migration alone, from `20261024054446_AddCollectionMemberLocks`
to `20261024121612_AddNotices`; do not apply unrelated pending migrations using
a blanket database update. SQL Server requires QUOTED_IDENTIFIER ON for the
filtered index. Apply the reviewed schema before rolling out the API, then Admin
and Web; distribute the mobile release separately. Verify real Admin authentication,
publishing, read synchronization and visibility on each supported platform.

Local verification uses only `localhost,14333/JupleRetTests`. Existing data is not
reset; integration fixtures remove only their own created records. Production and
JupleDev databases are outside this verification scope.
