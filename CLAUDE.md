# Juple - Claude Development Instructions

Juple is a production application intended for real Android, iOS, and Web service.
Treat changes as production code, not disposable prototype code.

## Project context

Before making architectural or domain changes, use these as the source of truth:

@README.md
@docs/product-overview.md
@docs/architecture.md
@docs/development-principles.md
@docs/database-conventions.md

Do not duplicate or reinvent documented decisions without a concrete reason.

## Working principles

- Inspect the existing implementation before changing it.
- Prefer the smallest change that fits the existing architecture.
- Do not introduce a new framework, package, service, abstraction, or architectural pattern unless the task requires it.
- Do not create temporary implementations that are expected to require a rewrite for production.
- Do not refactor unrelated code while implementing a requested feature.
- Preserve existing API contracts unless the task explicitly changes them.
- Preserve existing database data when creating migrations.
- Never modify generated/build files as a source fix.
- If an issue is environment-specific, distinguish it from a source-code issue before changing code.

## Data and product trust

User-entered data is the source of truth.

Do not:
- guess product prices, variants, quantities, names, or purchase information;
- store unverified AI/metadata output as fact;
- implement scraping or bot-protection bypasses;
- infer external purchases.

Metadata or AI may only assist when explicitly requested and must remain user-confirmed.

## Backend

Backend:
- .NET 10 / ASP.NET Core / EF Core
- Modular Monolith
- Azure SQL production
- SQL Server local development

Rules:
- User-owned data must always enforce ownership server-side.
- External identity IDs are not Juple domain UserIds.
- Use UTC/DateTimeOffset according to existing conventions.
- Follow existing EF configurations and migration conventions.
- Avoid unnecessary indexes; add them for demonstrated query patterns.
- Azure SDK types should stay in Infrastructure unless there is a strong reason otherwise.
- Do not put binary image data or base64 data in SQL.
- Keep the existing `/api/v1/...` convention and a versionable structure when changing Backend APIs.

## Mobile

Mobile:
- React Native CLI
- TypeScript
- Android and iOS
- No Expo

Rules:
- Do not add Expo packages.
- Do not add native/package dependencies unless required.
- Keep Android and iOS implications in mind when modifying Mobile code.
- Do not hardcode locale, timezone, currency, or date assumptions.

## Security

- Never commit secrets, tokens, passwords, connection strings, signing keys, or credentials.
- Never print or request raw bearer/access/refresh tokens for debugging.
- Do not weaken authentication or ownership checks to make a test pass.
- Treat all client input as untrusted.

## Git safety

At the beginning of a task that changes files:
1. Check `git status`.
2. If unexpected local changes exist, stop and report them before overwriting anything.

Do not:
- commit,
- push,
- reset,
- force-push,
- discard user changes,
- delete important files,
- install, update, or remove packages/dependencies

unless the user's current task explicitly requires or authorizes it.

If a task says to implement but says nothing about commit/push, leave the changes uncommitted and report them.

## Validation

Validate the scope that actually changed.

Typical checks:

Backend:
- `dotnet build`
- relevant tests, then full `dotnet test` when appropriate

Mobile:
- `npx tsc --noEmit`
- `npm run lint`
- Android build when native/runtime behavior is affected

Database changes:
- review migration SQL
- verify `dotnet ef migrations has-pending-model-changes`
- protect existing data

Do not repeatedly run expensive or unrelated validation without a reason.

Never claim a runtime scenario was tested unless it was actually exercised.

If part of the result failed, is uncertain, or was not verified, report the cause and remaining risk clearly instead of hiding it.

## Decision making

When multiple implementations are possible:
1. Prefer correctness and data integrity.
2. Prefer existing Juple patterns.
3. Prefer lower operational complexity.
4. Prefer production extensibility.
5. Avoid speculative abstraction and premature optimization.

If the requested approach creates a meaningful correctness, security,
data-loss, scalability, or maintenance problem, stop and explain the issue
instead of blindly implementing it.

## Communication

Keep progress and final reports concise.

For completed implementation work, normally report only:
- what changed;
- important design decisions;
- tests/build results;
- files changed;
- migration/package changes, if any;
- git status / commit hash when relevant.

Do not produce long explanations of unchanged project background.