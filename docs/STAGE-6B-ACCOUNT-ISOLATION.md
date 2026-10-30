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


## Stage 6B2 — Backup-gated encrypted preview in Settings (implemented; owner Chrome test pending)

A new optional Stage 6B panel is available only on localhost in Settings under the existing authenticated Test User account. This is NOT full private workout mode: the original plaintext browser history is intentionally preserved and remains visible after sign-out. The app's normal save, import and manual sync paths are unchanged.

**Browser test, one step at a time (fictional data only):**
1. Download a fresh ZIP of the feature/lift-journal-2-auth-preview branch; extract to a new folder containing index.html and stage6b-vault-preview.mjs. Stop the previous Python server and restart from the new inner folder on the SAME port 8006. Use the same Chrome profile. Check History and Movements still show two workouts and two favorites.
2. Sign in as the original Test User in Settings. Confirm the existing device-owner link is active. The Stage 6B encrypted copy preview appears below Manual Workout Sync. Do NOT click the creation button until the owner has reviewed the panel.
3. In Stage 6B, choose Download full safety backup (.json). Check the file exists in Downloads, then tick the acknowledgement. Keep Stage 6A backups too.
4. Create a separate, memorable encryption passphrase of at least 12 characters, distinct from the Supabase account password. Repeat it. Do not share the passphrase or store it in this chat. No passphrase recovery exists for the encrypted preview.
5. Click Create encrypted test copy. Read the dialog carefully: original unencrypted data WILL remain visible to other browser users. Confirm only the verified Test User email and expected two workout records. The preview checks current Supabase ID, exact legacy workout bytes, owner marker and account vault availability before, during and after encryption; writes a new encrypted copy only after successfully decrypting it for verification.
6. Use Test unlocking encrypted copy and enter the new passphrase. Expected: two workouts and two favorite movements; no normal workouts are changed. A wrong passphrase must be rejected with no changes. Download an encrypted backup and keep its passphrase separately.
7. Sign out and into the Admin test account. Stage 6B should be locked for this browser's linked history. The normal workouts may still be visible — that is the known Stage 6B2 limitation. Return to Test User; the encrypted copy should remain available. Check legacy History/Movements again.

**Code:** stage6b-vault-preview.mjs is the Settings UI; stage6b-vault-preview-guard.mjs implements owner, snapshot and stale-state checks. Tests are in tests/stage6b-vault-preview-guard.test.mjs (nine guards and one static integration check). Nine pure guard cases passed in an isolated V8 harness, and the original nine encrypted-vault core tests passed under Node. The complete Stage 6B2 browser integration still requires owner testing.

**Still required before full account privacy:** authenticated startup gating before reading the legacy key, complete encrypted write-through for all app sections, logout memory lock and cross-tab isolation, no plaintext fallback, backup/restore and lost-password plan, stable offline persistence and multi-device sync integration. Keep PR #11 draft and unmerged, production unchanged, registration and automatic sync disabled, and use fictional data only.
