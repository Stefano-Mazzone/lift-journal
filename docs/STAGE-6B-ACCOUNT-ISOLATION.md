# Lift Journal 2.0 — Stage 6B1: encrypted vault foundation (DRAFT)

**Status:** Foundational code implemented and nine automated Node tests passed locally; **not integrated, not owner-browser tested, not safe for shared-device use.**

## What changed

- `stage6b-vault-core.mjs` is a dormant, browser-compatible helper for encrypting a complete native Lift Journal data object in an account-bound vault envelope.
- Uses Web Crypto AES-256-GCM with a unique random 12-byte IV and random PBKDF2 salt for each seal; PBKDF2-HMAC-SHA256 (310,000 iterations), with the verified user ID bound as authenticated additional data. A separate passphrase (not an account login password) must be provided to open the vault.
- Uses an account-specific key `lift-journal-private-v1:<verified-user-id>` rather than `lift-journal-v1`. Write helper refuses to overwrite an existing vault. Incorrect account, passphrase, tampered ciphertext, invalid metadata or storage failures fail closed.
- `tests/stage6b-vault-core.test.mjs`: nine tests (round-trip preservation, cross-account rejection, incorrect passphrase, corruption, invalid KDF, weak passphrase, distinct storage keys, non-destructive add-only storage, cross-account write rejection). Run `node --test tests/stage6b-vault-core.test.mjs`.
- **No modifications** to `index.html`, `stage5-account-panel.mjs`, `stage5-manual-sync.mjs`, `service-worker.js`, cloud schema, registration or production app.
- The test module is **not imported by the app**. Nobody should enter a passphrase or migrate their data yet.

## Stage 6B integration and release gates (still pending)

1. Design explicit opt-in migration of *fictional* legacy local data. Require a verified account, complete downloaded safety backup, checked owner consent and verification before migration.
2. Implement app startup account/guest compartment selection **before reading legacy history**, with authenticated unlock and hard lock on sign-out / account changes; ensure program, favorites, nutrition, running, history, calendar, and other fields cannot leak.
3. Implement complete per-account save semantics and safe failure paths with no stale in-memory writes, backups and recoverable interrupted migrations. Avoid storing an unencrypted working copy under the legacy key.
4. Refactor both cloud-sync entry points and backup import/export to operate on the correct unlocked account vault only. Maintain strict RLS checks and no automatic sync.
5. Validate cross-tab, offline, wrong account, wrong password, crash/reload, bad ciphertext, insufficient quota, guest-to-account, new-device restore, lost-passphrase and cloud/local conflict cases in Chrome with fictional data.
6. Review threat model: local XSS, shared origin, browser extensions, unlocked device, credential loss, recovery mechanism, and Supabase policies. A user-held passphrase cannot be magically recovered; encrypted vaults do not protect data while an unlocked browser session is in use.
7. Obtain explicit owner approval before merging/deploying. Keep PR #11 draft and existing production data untouched.

**Stage 6A browser checks:** owner confirmed two fictional workouts and two favorites survived sign-out and account changes; wrong Admin test account showed SYNC LOCKED and original Test User account regained Compare. Optional backup-import suspension test remains pending.
