# Admin V2 - information architecture and redesign (2026-10-28)

Admin V2 rebuilds the operator tool (`apps/admin`, `https://admin.juple.co.kr`) around six screens, as a dark glass dashboard.
Key information is shown first; details open on click. Every number comes from the API; nothing is estimated in the browser.
The API's JupleAdmin policy (active grant on every request) and every older endpoint are unchanged.

## Menu

| Sidebar | Route | What it shows |
| --- | --- | --- |
| 대시보드 | `/` | Three KPIs (전체 사용자 / 전체 저장 링크 / 오늘 신규 가입자) and ONE chart for the selected KPI |
| 사용자 | `/users` | Top half: account table. Bottom half: the selected person's saving history |
| 공지사항 | `/notices`, `/notices/new`, `/notices/{id}` | Notice list; editor with the Korean original and 16 translations |
| 문의 관리 | `/inquiries`, `/inquiries/{id}` | 미답변 first; original and Korean translation side by side; Korean answer and its translation |
| 비용 및 수익 | `/costs` | This month's server (Azure) cost, monthly history, per-service detail; revenue (not connected) |
| 앱 버전 관리 | `/app-version` (= `/operations/app-version`) | Android/iOS latest and minimum build, Owner-only editing (unchanged rules) |
| bottom: 관리자 계정 | `/settings` | Role, integration status, translation status, and the older tools |
| bottom: 시스템 상태 | `/operations/system` | API health and builds |

Older screens are no longer in the sidebar but keep their URLs (bookmarks work) and are listed under 관리자 계정 > 기존 운영 도구:
`/workspace` (the former `/` overview), `/workspace/users`, `/links`, `/analytics/*`, `/operations`, `/expenses` (the full expense
ledger, evidence, CSV/XLSX), `/revenue`. Nothing was removed from the API or the database.

## Metric definitions (all KST calendar days; instants stay UTC)

- **전체 사용자 수** = accounts that exist now. **Trend** = for each day, accounts created by 23:59 KST that still exist. Account
  deletion removes the row, so deleted accounts are absent from every past day as well (there is no deletion history to restore
  them from). The last point equals the KPI.
- **전체 저장 링크 수** = saved links not in the trash, all accounts. **Trend** = for each day, links saved by 23:59 KST and not in the
  trash at that moment, reconstructed from `SavedAtUtc` and `DeletedAtUtc` (the trash time). Permanently deleted links and links
  of deleted accounts are gone from the past too; a link restored from the trash counts as if it had never left. The last point
  equals the KPI.
- **오늘 신규 가입자** = accounts created since 00:00 KST today (re-read when the Seoul date changes). **Trend** = per KST day.
- Internal/test accounts: there is no flag that marks an account as internal, so they are included everywhere (nothing is
  guessed). Each account and each link row is counted once; Collection memberships never multiply link counts.
- **사용자 표** link count = that person's links not in the trash (same definition as the KPI). "언어" = the primary language of
  the device locale the account was created with (`Users.PreferredLocale`, never updated later) - not a current app setting.
- **사용자 저장 추이** = links saved per KST day (or month) from the sign-up day to today, including links later moved to the
  trash and excluding permanently deleted ones; nothing before the sign-up day. "현재 저장 링크" (not in the trash) is a different
  number from "가입 후 저장" (the sum of the chart). Daily buckets up to two years, monthly beyond that (or on request).
- Past values that cannot be reconstructed are not invented. A daily snapshot table would make the user/link trends exact
  (including deletions); it is **not built** in this round - see "Not done".

## APIs (all under `/api/v1/admin`, JupleAdmin, `no-store`)

New, read-only:

- `GET dashboard/kpis` - the three KPIs (30 s per-replica cache).
- `GET dashboard/series?metric=users|links|signups&range=7d|30d|90d` or `&from=&through=` (max 366 days; 1 min cache; at most one
  uncached aggregate per replica, otherwise 429 + Retry-After).
- `GET users/directory?search=&searchField=jupleId|nickname&language=&sort=createdDesc|createdAsc|linksDesc|linksAsc&page=&pageSize=`
  - page numbers (offset), total and the language list.
- `GET users/{id}/link-history?granularity=day|month`.
- `GET costs/history?months=6|12|all` - imported Azure usage cost per billing month and currency (configured scope only; SQL only,
  no Azure call). A month without a successful import is "not synced" (unknown), never zero.
- `GET notices/translation-status` - provider name and whether machine translation is configured.

New, write/workflow:

- `POST notices/translations {title, body, languages?}` - machine-translates the Korean draft; saves nothing.
- `POST support/inquiries/{id}/content-translation` - Korean translation of the person's text (stored beside it; the original
  never changes).
- `PUT support/inquiries/{id}/answer-draft {sourceKo, translated, language}` - 임시 저장 (never visible to the person).
- `POST support/inquiries/{id}/answer-translation {sourceKo, language}` - the answer's translation; saves nothing.
- `PUT support/inquiries/{id}/answer` gains optional `sourceKo`, `language`, `expectedUpdatedAtUtc` (the detail's `changeToken`).
  With `language`, `answer` is exactly what the person reads; a non-Korean answer requires its Korean original; a changed
  inquiry is refused (409 `inquiryChanged`, the row is locked during the check); sending the same answer again writes nothing.
  Without `language` the original Korean-only behaviour is unchanged.

Extended (additive fields only): inquiry list (`?status=Open` = 접수+처리중; `locale`, `contentLanguage`), inquiry detail
(translation, draft, `suggestedLanguage`, `translation` state, `changeToken`), notice translations (`origin`,
`sourceFingerprint`, `translatedAtUtc`), notice detail (`sourceFingerprint`), notice list (`languageCount`).

Reused unchanged: `expenses/configuration`, `expenses/azure-report` (this month and per-service detail), `workspace/revenue`,
`operations/app-version` (+ PUT), notices CRUD, inquiry status, `me`.

## Translation (Azure AI Translator, OFF by default)

- `Translation:Provider` = `None` (default: nothing is sent anywhere; every translate request answers
  `translationNotConfigured` and the UI says so) or `AzureAITranslator` with `Translation:AzureTranslator:Key` (secret - Key Vault
  reference / Container Apps secret, never source), `:Region`, optional `:Endpoint`. A contradictory configuration stops startup.
- **Inquiries need a second switch**, `Translation:AllowInquiryTranslation=true`, because user-written text is personal data sent
  to a processor (Microsoft). Turn it on only after the privacy notice names the translation processor. Notices (operator text)
  need only the provider.
- Text API v3, plain text, one call per target language (four at a time), 25,000 characters per call at most, 20 s timeout.
  Neither the key nor any text is logged; failures are classified (providerRejected, throttled, unavailable, timeout, ...).
- Languages: the 17 the apps ship (`ko en ja zh-Hans zh-Hant es fr de it pt-BR vi th id ru tr ar hi`; `pt-BR` is `pt` for the
  provider). Users see their language, else Korean (the existing notice fallback; no other fallback language is defined).
- Manual edits are protected: each translation records `Origin` (Source / Machine / Manual) and, for machine translations, the
  fingerprint (SHA-256 of the Korean title + body) it was made from. "번역 갱신" re-translates only missing, failed and
  out-of-date machine translations; a hand-written one changes only through an explicit, confirmed "이 언어 재번역". Older rows
  without an origin are treated as Manual.
- Setup (not done): create an Azure AI Translator resource (S1 or F0) in the project, store the key in Key Vault, add the three
  values to the API Container App, review the privacy notice before `AllowInquiryTranslation`.

## Database

Migration `20261028024718_AddAdminTranslationWorkflow` - additive, all columns nullable:

- `notices.NoticeTranslations`: `Origin varchar(16)` (check: Source/Machine/Manual), `SourceFingerprint varchar(64)`,
  `TranslatedAtUtc`.
- `support.SupportInquiries`: `ContentLanguage`, `ContentTranslationKo`, `ContentTranslatedAtUtc`, `AnswerSourceKo`,
  `AnswerLanguage`, `AnswerDraftSourceKo`, `AnswerDraftTranslated`, `AnswerDraftLanguage`, `AnswerDraftSavedAtUtc`.

Older API revisions ignore the columns. An older revision that answers an inquiry writes `Answer` only (the Korean source of a
later translated answer may then be out of date - the delivered `Answer` is always right). Do not run `Down` once data exists.
No new index: the new queries filter on existing keys/indexes (`Users`, `Items.UserId`, `Items.SavedAtUtc`, expense scope/date).

## Deployment order (not executed)

1. Review the generated SQL (`dotnet ef migrations script 20261026015229_AddMobileVersionPolicies 20261028024718_AddAdminTranslationWorkflow --idempotent`)
   and apply it to PROD with the existing reviewed procedure (temporary firewall rule, `jupleadmin` in memory, `__EFMigrationsHistory` check first).
2. Deploy the API (image built from the release commit; translation stays `None`).
3. Deploy the Admin image. The Admin needs the new API for the dashboard/users/costs screens; the older endpoints keep working.
4. Optional, separately approved: translation provider (and later the inquiry switch).

Rollback: Admin image and API image independently; keep the additive columns.

## Not done / not connected

- Machine translation is not configured anywhere (provider None) - the UI shows it and manual translation works.
- Revenue: no store transaction/settlement import exists; the screen says "데이터 미연동", never 0.
- Exact historical user/link totals (with deletions) need a daily snapshot table and a writer (e.g. the daily retention Job);
  designed here, not built.
- Answer notifications: answering an inquiry still sends no push (unchanged); the person sees the answer in 고객센터.
- No "internal account" flag exists, so test accounts cannot be excluded.
