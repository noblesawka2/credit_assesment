# Nobles Cooperative Credit Diagnostic Engine

**Status: tested implementation foundation, not a completed credit engine or production service.**

This new workspace contained only a package manifest. There was no Minerva application, approved identity service, database connection, design system or existing member table to extend. This is a separate TypeScript/Node 24 application with a PostgreSQL migration and explicit integration boundaries. No production service has been contacted. Nobles Vault is not modified.

## Run locally

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run dev
```

Open `http://127.0.0.1:3100`. No database or credentials are needed to view the non-sensitive shell. The UI clearly labels itself as an implementation preview and disables personal-data entry without authenticated, configured services. There are no demo users, fake member records or backdoor role headers.

Node 24 runs the TypeScript source directly. The build type-checks the application and copies static assets to `dist/public`; it does not bundle a standalone production server. The development server serves the source `public` directory.

## Implemented

- Integer-kobo reference calculations, validation, cash flow, DSCR, stress, demonstrated need, repayment inversion, ceilings and exact-kobo schedule allocation.
- Separate reported/verified contracts and evidence/reason-required verification functions.
- Role and assignment checks, formal transition guards, independent recommendation/check/approval controls and event objects.
- Draft/publication policy functions, explainable score calculation and separate Unity group checks. Product seeds are source requirements only, not active policies.
- Mobile-responsive assessment **preview**, thirteen question routes, progress navigation, readiness gates and draft autosave client.
- Same-origin HTTP controls, private API responses, explicit static-file allowlist and a default-deny identity adapter.
- Encrypted PostgreSQL draft repository with transaction-scoped RLS context, revision checks, idempotency-key payload binding and transactional draft audit entries.
- Non-destructive migration with immutable audit/verified/snapshot/outcome records and original-answer protection after submission.
- AES-GCM offline vault library, encrypted IndexedDB adapter, local-state guards, acknowledgement checks and attachment checksum assembly.
- A service worker that caches only the non-sensitive shell. API responses, query URLs and request bodies are excluded.

**Library functionality is not the same as an integrated workflow.** See `docs/IMPLEMENTATION_STATUS.md` for unfinished work and unverified controls.

## Routes

- `/credit/apply/start`, `/credit/apply/request`, `/credit/apply/income-route`
- `/credit/apply/business`, `/credit/apply/sales`, `/credit/apply/business-costs`
- `/credit/apply/household`, `/credit/apply/debts`, `/credit/apply/use-of-funds`
- `/credit/apply/salary`, `/credit/apply/unity-group`, `/credit/apply/evidence`, `/credit/apply/review`
- `/credit/staff`: locked explanatory shell, **not an implemented staff workspace**.
- `GET /api/health`: readiness metadata only; `productionReady` is always false in this release.
- `GET /api/session`, `GET /api/drafts`, `POST /api/drafts`: require an injected approved identity adapter. Default startup has none and returns 401.

No submission, decision, override, disbursement, evidence-upload, report or server-sync endpoints are exposed.

## Data and integration

Copy `.env.example` to `.env` only when preparing an approved development database. Never commit credentials. `DATA_ENCRYPTION_KEY` must be a secret, random 32-byte key represented by 64 hexadecimal characters. The local payload cipher is a foundation; production key management and rotation are unfinished.

Use `src/server/identity.ts` for an approved identity integration and `src/integration/core-contract.ts` for the Minerva boundary. Do not replace these with client-provided roles or fabricated verification. The default core implementation returns `PENDING_MANUAL_VERIFICATION` for every check. An approved mapping from external identities to internal actor UUIDs is required.

See `docs/OPERATIONS.md` for migration and rollback procedures. Production activation is prohibited until the remaining requirements and security review are complete.
