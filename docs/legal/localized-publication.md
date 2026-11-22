# Public legal documents: per-language publication gate

Implementation only; no publication, consent-version change, effective-date change or PROD setting change is authorized by this document.

## Current publication inventory

Supported UI language choices: ko, en, ja, zh-Hans, zh-Hant, es, fr, de, it, pt-BR, vi, th, id, ru, tr, ar, hi.

Only Korean legal bodies are currently registered as published. All other 16 languages display the Korean original with a localized notice. These notices are UI translations, not reviewed translations of legal obligations.

| Document | Existing source/version | Publication |
| --- | --- | --- |
| Historical consent | Backend `LegacyPublishedTerms.json`, 2026-10-14 | Preserved Korean original and legacy request compatibility |
| Public terms | Backend `PublishedTerms.json`, 2026-10-25 | Preserved Korean original; does not replace the configured consent version |
| Privacy | Web `legalContent.ts`, 2026-10-25 | Existing Korean text and retention policy |
| Account deletion | Web `legalContent.ts`, 2026-10-14 | Existing Korean text; deletion/subscription policies unchanged |

Membership amendment drafts (including the 15 files in `membership-drafts` and existing Korean/English proposals) are not runtime imports. Their approval metadata, effective dates and consent versions remain unchanged. No draft is automatically promoted to a public document.

## Approving a translation later

Obtain independent legal and language review for each document/version/language. Confirm retention, billing, cancellation, refunds and deletion meanings against the corresponding Korean source. Code/hash checks cannot establish semantic equivalence or legal validity.

Terms translations belong in `approvedTranslations` on the corresponding authoritative Backend JSON, not a duplicate Web legal source. Privacy/deletion translations belong in `apps/web/lib/legalTranslations.json`. Each entry includes `language`, `version`, `sourceContentHash`, `contentHash`, `document`, and `approval: { status: "approved", legalReview: "actual review reference", languageReview: "actual review reference" }`. Do not use dummy references. The document must retain its slug/version and the existing plain-text section/block schema.

The canonical SHA-256 joins title, intro, section titles and paragraph/list items with LF, exactly as the existing terms contract. Approval is bound to both this Korean source hash and the translated body's hash. Editing the source invalidates the translation gate until re-reviewed. Duplicate candidates fail closed to Korean. Regenerate Web contracts with `node apps/web/scripts/generateConsentDocuments.mjs`, then run its `--check` mode and related tests. Generated files must not be edited manually.

The locale in a reading link is a requested UI language, not consent evidence. A Korean fallback never creates another language's consent. Modern acceptance submits the displayed document's version/language/hash, and the server verifies them. Historical requests without hash/language remain limited to 2026-10-14 and still require authentication/age confirmation. Existing acceptance records and timestamps remain intact. No DB migration is needed.

## Validation and release gates

Test all 17 reading choices; source/translated hash mismatch; draft/missing review; wrong version; duplicate candidates; Korean fallback; old mobile requests; existing acceptance history; Korean/English/Arabic and 320px layouts. Arabic UI is RTL while the fallback Korean article stays LTR.

No non-Korean legal body is approved by this implementation. Legal/native-language review and separate PROD deployment approval remain required. Android/iOS need a future application release to pick up localized external links and inline notices. Until then Web can resolve a browser's language, but cannot know an older app's language when its link does not send one.
