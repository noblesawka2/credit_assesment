# Git publication secret review - 23 September 2026

## Result

No `.env` or `.env.migrate` was found in the published tree or either commit reachable from published `main` at `8a5612c87efa92965c37e826efe47f993e089fbe`. GitHub branch/tag enumeration returned only `main`. The published `.env.example` and `.env.migrate.example` contain no populated secret fields.

The audit inspected both reachable commits and 95 historical blobs. It compared their contents with locally configured credential values without printing them, and checked for common GitHub/Supabase token, JWT and private-key signatures. No matching secret or credential signature was found. This is an audit of the currently published reachable repository history, not a guarantee about unrelated repositories, deleted remote references, logs or other disclosure channels.

## Cause and remediation

The working-copy `.gitignore` contained a trailing `!.env.migrate`, which overrode its earlier ignore rules and made the local file appear as untracked. That unsafe exception was not in the published commit. An untracked file is not automatically included in a push.

Removed the unsafe exception, retained an explicit `.env.migrate` ignore entry, and ignored local `certs/`. Only the two empty environment templates remain exempt from the environment-file ignore pattern. Added `test/gitignore.test.ts` to exercise Git's actual matching behavior for runtime/admin environment files, backup variants, nested environment files, certificates and allowed templates.

No credential file was deleted locally or staged. No history rewrite was necessary because no exposure was found in the inspected history. If a credential is separately discovered in any published location, revoke/rotate it first; deleting the current file alone does not remove historical copies or revoke access.

## Readiness retry

The latest non-destructive retry still fails `DATABASE_USERNAME_TARGET_MISMATCH` and `AUTHENTICATION_NOT_ENABLED`. The database connection now fails `ENOTFOUND` (hostname resolution), replacing the previous `28P01` observation. No successful connection or TLS authorization is claimed for this failed attempt. Full CA/hostname verification remains enabled, and no production SQL writes or migrations were performed.
