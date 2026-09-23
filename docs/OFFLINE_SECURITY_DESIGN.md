# Approved-device offline security design — capture remains disabled

Source: specification section 3. Browser refresh/reopen is not a new authentication attempt budget. Current HTTP/UI still reports offlineCaptureEnabled=false and disables offline data entry. Library tests are not evidence of deployed hardware assurance.

## Enrollment and access

1. First sign-in, MFA/OTP if required, device enrollment and approval occur online. Use existing roles only; field-officer duties map to the approved credit-officer role rather than inventing a new role. Grant OFFLINE_CAPTURE separately, require certified-agent level where applicable, prohibit MEMBER/shared/unregistered accounts.
2. Server registry binds staff UUID, approved device public credential/key identifier, grant ID, issued/server time, expiry, policy versions, revocation version and approved capability. Sign the grant; browser-supplied booleans/roles never constitute approval. Default lifetime 24 hours; changes require approved policy.
3. Approved platform key storage supplies a non-extractable AES-256-GCM key bound to device/user. A PIN is a local unlocking factor, not the encryption key; no plaintext PIN or stored authentication token. Browser non-extractability alone does not prove hardware binding. Choose an approved native wrapper/platform if the PWA cannot meet this assurance.

## Five-attempt rule

`OfflineVault.unlock` now requires an UnlockAttemptStore and reserves a durable attempt before calling the device-key provider. Failed/cancelled/crashed attempts remain consumed; successful unlock removes only its own reservation, not other failures. Five consumed attempts block a sixth provider call. The budget lasts for that issued grant; only successful online reauthentication and a genuinely new signed grant may reset it. A crash can conservatively consume a successful attempt if completion was not persisted.

`IndexedUnlockAttempts` serializes changes through IndexedDB readwrite transactions in schema version 2. Recreating the vault, refreshing the UI, reopening the browser or concurrent tabs does not reset the stored budget. Existing sealed data is retained during upgrade; blocked upgrades fail closed. Do not reset counters on component construction, sign-out, local lock or storage errors.

Limit of assurance: an attacker who can delete/restore all browser storage can remove or roll back an IndexedDB counter. Therefore an approved production key provider must also enforce device-bound, rollback-resistant attempts/grant validity and refuse copied/recreated state. Grant verification, platform provider and persistent trusted-time watermark are not implemented. Offline capture stays disabled until these controls and real restart/multiple-tab/storage-rollback tests pass. The unit tests recreate vault instances over shared test storage; they do not pretend to be browser disk/reboot or hardware tests.

## At-rest and session controls

Encrypt questionnaire, documents, photographs and queued audit payloads before disk. AES-GCM binds version/device/user/local ID as additional data; fresh random IV per write. Keep only minimum identity claims, never the full member list. Cache only the public shell. No localStorage/URL/analytics/console storage of sensitive information. Lock after five minutes inactivity; expired/revoked grants preserve ciphertext but deny decrypt/capture until online reauthentication. Revalidate expiry after a slow unlock prompt; reject clock rollback. Persist server-time high-water mark using the approved platform to prevent restart clock rollback.

## Synchronization and cleanup

Required sequence: fresh server identity and device/capability/revocation checks; server time; active policy versions; definitive member resolution; KYC/savings/exposure/duplicate checks; idempotent create keyed by device/local UUID with payload hash; structured answers; resumable encrypted attachments with chunk/full checksums; client audit times plus server-received times; authoritative server recalculation; material-variance warning; member re-consent for changed request/terms; complete durable acknowledgement.

Require matching server revision; retain both versions on conflict, never silent overwrite. Submitted originals are immutable, verification becomes a new reason/evidence-bound revision, duplicate attachments reuse the checksum receipt, ambiguous member matching stops only that record. Retry the same operation key after timeout. The server must bind receipts to actor/device/local ID, input revision/digest, expected attachments/audit events and recalculation/policy version. Client receipt booleans alone are not proof of committed sync.

After all fields, attachments and audit events are durably acknowledged and reconciliation/consent complete, keep encrypted payload for the default 24-hour recovery window or remove immediately on authorized request. Retain only a nonsensitive reference/receipt. Remove per-record wrapped key and every payload/chunk/thumbnail after confirmed sync; never remove server audit/copy. IndexedDB delete cannot guarantee physical erasure from device backups; key destruction and device management are required. Warn on sign-out/clear/close when unsynced work exists.

## Missing implementation / enablement evidence

Server device registry and signed grants; approved key provider; tamper-resistant attempt/time state; device revocation; private evidence storage and scanning; encrypted attachments/audit queue; sync inbox/idempotency/conflict ledger and resumable upload; server recalculation/consent; receipt binding and crypto-erasure; real supported-device online/offline/restart/retry testing. Existing `src/offline/sync.ts` is a client contract, not a server synchronizer. None of these gaps is bypassed by this design.
