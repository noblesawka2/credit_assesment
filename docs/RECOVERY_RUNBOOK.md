# Backup, recovery and rollback — deployment gate

No backup location, retention, tested restore point or named recovery operator was supplied. This is a controlled procedure, NOT evidence that a backup exists. No backup, restore or migration command was executed.

## Ownership and targets requiring approval

Management must name the existing operations/database custodian who executes recovery and the independent compliance/checker witness who reconciles results. These are operational responsibilities, not new application roles or implied credit authority. Keep emergency contacts and dual-controlled provider access in the private operations inventory.

Record the exact Supabase project, backup/PITR entitlement and retention, off-account encrypted backup location, private evidence-object backup location, credential/key-vault recovery location and last verified restoration time. Backups of database rows alone do not recover externally stored evidence objects or encryption keys. Verify provider coverage rather than assuming a plan includes PITR or all services.

Management must approve maximum data loss (RPO) and service outage (RTO) before launch. Proposed planning targets, NOT approved guarantees: RPO at most 24 hours with daily verified independent backup, or a tighter measured PITR objective if enabled; RTO at most four hours only after a timed drill demonstrates it. Until an approved target and backup schedule exist, recovered-data age is unknown and launch is blocked.

## Recovery sequence

1. Incident lead declares recovery; stop application writes, sync and outbound integration dispatch. Preserve immutable audit, logs, failure timeline and deployment/migration checksums. Revoke compromised sessions and credentials if relevant without destroying decryption keys needed for recovery.
2. Custodian and witness select a known-good backup/point-in-time before corruption; verify timestamp, checksum, encryption-key version, retention and incident scope. Take a protected snapshot of current state before repair if safe. Never overwrite the only surviving data copy.
3. Restore into an isolated new approved database/project with restricted networking and full TLS verification. Restore schema/data, required extensions/roles/RLS/triggers and external evidence objects using provider-supported procedures for the actual plan; recover keys from the separate approved vault. Keep authentication redirects, email delivery, background jobs, sync and Minerva writes disabled in the recovery environment.
4. Verify migration ledger/checksums and exact schema, row counts, foreign keys, references, idempotency records, submitted-original and audit immutability, policy/snapshot/outcome linkage, forced RLS and non-BYPASSRLS runtime privileges. Decrypt representative authorized records and attachments using the correct key versions without logging values. Run application checks/tests against isolated synthetic accounts and compare document checksums and financial totals to approved pre-incident evidence.
5. Reconcile audit/event sequence and every in-flight sync/outbox/core reference. A restored idempotency ledger can lag external successful operations: query authoritative systems before replay, never blindly repeat financial writes. Quarantine unknown outcomes. Determine and record precise lost-data interval against RPO; notify management of any breach.
6. Independently approve the restored instance, rotate runtime credentials as required, invalidate old application sessions, update hosting secrets and DNS/cutover target, smoke-test authorized and denied access. Resume read traffic, then controlled writes/sync, then separately approved integrations. Monitor errors and preserve the previous instance for investigation under retention policy.
7. Record who restored, backup identifier/time, data-loss interval, duration, verification evidence and sign-off in the incident record. Rehearse periodically and before launch.

## Encryption key loss

AES-GCM ciphertext cannot be recovered without its original key. Restoring the database or replacing DATA_ENCRYPTION_KEY with a new random value does not decrypt it. Keep dual-controlled, separately backed-up versioned keys and tested recovery access. Loss of all key copies means permanent loss of encrypted records; contain the incident and notify management/compliance. Rotation needs key IDs and a reviewed re-encryption/recovery process; the current single-key cipher is not a completed rotation system.

## Failed deployment

Keep an immutable previous application artifact and reviewed configuration. If new deployment health/auth/read-only checks fail, stop new writes and restore the previous compatible artifact without modifying credit records or disabling TLS/RLS/audit. Reset/revoke sessions if encryption/session compatibility changed. If old code cannot safely use the schema, keep maintenance mode and fix forward; do not declare health by bypassing security checks.

## Bad migration

No migration is authorized now. Before any future migration: review exact SQL/checksum/destructiveness, prove backup/restore, rehearse on isolated staging and obtain explicit production approval. A failed transaction rolls back; inspect catalog/ledger to verify no partial external effects. After commit, preserve data/audit and prefer a reviewed additive forward repair. Roll back the application only when backward compatible. For destructive/corrupting changes restore to a separate instance using the above procedure and reconcile post-backup writes. There is no safe generic DROP/down migration; never delete submitted cases/audit to undo deployment.
