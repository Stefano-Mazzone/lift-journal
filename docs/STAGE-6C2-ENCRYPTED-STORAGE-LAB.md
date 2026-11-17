# Lift Journal 2.0 — Stage 6C2A: encrypted account-storage prototype

**Status:** Implemented in DRAFT PR #11, not deployed. 13/13 mocked storage-state-machine regression checks passed in an isolated JavaScript runner. Browser test and actual Node test-suite run are not yet confirmed. This is **NOT full private mode**.

## Purpose

Prove a second-generation account-scoped encrypted storage protocol can create, save, reload, and fail closed **without changing the original Lift Journal app at all**. The Stage 6C1 read-only viewer already passed owner Chrome encryption, signout, and tab-lock tests. Stage 6C2A now adds **encrypted writes** for a disposable copy.

### What changes

- New `stage6c2-private-storage.mjs`: per-account two-slot encrypted compartment with explicit head pointer, monotonically increasing revision, current-owner check, server identity re-verification callback, Web Locks exclusive per-account writes and exact post-write readback.
- Uses the existing Stage 6B3 encrypted copy for initial data; decrypts with its existing working passphrase, then re-encrypts for an entirely new Stage 6C2 private compartment. An invalid passphrase does not create any new record.
- Creation is **add-only**: the original Stage 6B3 copy and the `lift-journal-v1` plaintext record remain untouched. Initial creation is blocked by an incomplete/orphan or existing compartment rather than overwriting it.
- Before saving, the passphrase must successfully decrypt the CURRENT committed revision and its decrypted contents must match the caller's previously unlocked snapshot. This prevents a mistyped save passphrase from silently replacing a readable copy. Normal commits write the inactive slot first, verify it, then update the authoritative head. If interrupted before head update, the previous committed slot remains active. Two slots preserve the previous committed revision; it is never auto-restored if active data is corrupt. Damaged/cross-account/stale state fails closed.
- New `private-storage-lab.html` and `stage6c2-storage-lab.mjs`: localhost-only separate UI for confirmed FULL legacy and encrypted source backups, verified owner, new v2 encrypted copy, read-only counts, and one fictional 'TEST - Stage 6C2 Encrypted Favorite' write to v2 only. Reloading then unlocking should show revision 2 and three favorites; normal Lift Journal still has two favorites.
- Added a link from `private-preview.html` (the Stage 6C1 private viewer) to the new storage lab. No changes to the normal `index.html` workout save/load code.
- Add `tests/stage6c2-private-storage.test.mjs`: 13 mocked state-machine checks. AES-GCM/PBKDF2 algorithms are provided by previously implemented Stage 6B vault module; mock tests do **not** replace a full real crypto/Chrome test.

### What DOES NOT change

- Regular `index.html` still reads/writes plaintext `lift-journal-v1` **before account gating**. Another user of the same Chrome profile can still see that data.
- No automated/offline background writes, new exercise recording through the private compartment, data deletion, legacy migration, automatic cloud syncing, restored v2 backup importer or full-application encryption.
- No real-workout data, public registrations, production release, service worker changes or merge. The feature branch must remain a DRAFT PR.

## Owner Chrome test — FICTIONAL DATA ONLY

1. **Preserve** all Stage 6A/6B/6C1 folders and existing JSON backups, including the working Stage 6B3 encrypted copy and full safety JSON. Do not clear browser data or use real personal data.
2. Download a new ZIP from `feature/lift-journal-2-auth-preview` to a NEW folder named `Lift Journal 2.0 - Stage 6C2A Storage Lab`. Stop old Python server with Ctrl+C and restart from the extracted inner source folder on port 8006 with `python -m http.server 8006 --bind 127.0.0.1`. Reuse the SAME Chrome profile and exact `http://127.0.0.1:8006` origin.
3. Open `http://127.0.0.1:8006/index.html`. Confirm **2 original fictional workouts and 2 favorites** and signed-in, linked Test User. Do not sync.
4. Open `http://127.0.0.1:8006/private-storage-lab.html` and force refresh Ctrl+Shift+R. Check the explicit warning, verified Test User, and new copy section. If storage is locked or any mismatch, STOP, do not reset anything.
5. Click **Download fresh full fictional-device safety backup** and **Download latest Stage 6B encrypted source**. Verify **both** JSONs appear in Downloads. Check the acknowledgement.
6. Enter the **new working Stage 6B3 encryption passphrase**, not account password and not old failed passphrase; click **Create standalone encrypted TEST compartment (keep all originals)**, confirm. Expected success: revision 1, **2 workouts, 2 favorites**. No originals modified.
7. Unlock with the same separate passphrase. Expected **2 workouts, 2 favorites, 1 saved meal, revision 1**.
8. Enter passphrase in Save box, click **Save a TEST favorite to encrypted private copy**, confirm. Expected: encrypted revision **2**, **2 workouts, 3 favorites** in lab. Do not edit normal workouts.
9. Refresh storage lab, unlock again. Expect **revision 2 and 3 favorites**, including `TEST - Stage 6C2 Encrypted Favorite`. This verifies persistence across reload.
10. Open normal Lift Journal History/Movements in a separate tab. Expect unchanged **2 workouts and 2 original favorites**. Check existing Stage 6C1 encrypted viewer still opens its old copy with **2 workouts and 2 favorites**, proving originals were not overwritten.
11. Test switching tabs and sign out from Stage 6C1 private viewer. Stage 6C2A should hide data and refuse the Admin account. Do not attempt to transfer data across accounts.
12. Download current encrypted v2 backup from the lab when unlocked, keep it safe; note v2 restore is **not** implemented. Stop at any error, preserve all files, do not clear storage.

## Stage 6C2A fix after the first owner Chrome creation attempt (2026-11-17)

The owner saved both safety backups and clicked Create/OK, but no success or error appeared. A read-only **Re-check account and storage** showed the Test User still verified and **no compartment created**. The symptom does not prove a passphrase problem.

The lab's UI previously called `lock()` on every `window.blur` and `onAuthStateChange`, even when its **own native confirmation dialog** produced a blur or the **same account** refreshed its Supabase token. Both incremented the operation sequence, potentially canceling asynchronous encryption while silently discarding the resulting error.

Patch: `confirmWithoutFalseLock` now ignores only the browser blur generated by the lab's own active confirmation dialog, while actual tab-hide/sign-out/account-switch and external storage mutation still lock. Same-account `TOKEN_REFRESHED` no longer cancels a valid encrypted write; the storage engine retains independent server `getUser()` and owner checks before any commit. The account-status recheck no longer invalidates a busy write. The original vault, legacy data and backup JSON files were not modified by this code update.

**Testing:** 13/13 isolated storage state-machine checks still passed before this UI patch. Mocked UI event simulation passed for confirmation blur + same-user token refresh, with a distinct real-blur test showing the private display still locks. Added `tests/stage6c2-storage-lab-ui.test.mjs` with three regression cases. **Owner must download a fresh ZIP and retest; no successful real Chrome Stage 6C2 compartment creation has been verified yet.**

## Second owner Chrome attempt and final inline-confirmation revision (2026-11-17)

On the first patched attempt, the owner again verified the existing Test User and backup acknowledgement, pressed the old Create flow and reported only a generic **Private compartment locked when browser lost focus** message, with no creation success shown. No successful compartment creation has been verified. Do not attribute this to an incorrect passphrase without a specific error.

To remove the trigger completely, the lab now has an **inline two-step review and confirmation**, not a browser `confirm()` modal. Clicking **Review encrypted TEST compartment creation** performs NO writes; clicking **Confirm and create encrypted TEST compartment** starts encryption. An inline Cancel option stops safely. The fictional favorite save uses the same two-step inline process.

The `window.blur` handler continues to lock and hide on-screen decrypted private data, but does not erase the creation success/error status when no private history is displayed. If passphrase input is present but no history is displayed, it clears the passphrase and pending review instead of erasing the status. Actual tab hiding, true sign-out, account switches, cross-tab sensitive storage changes and expired/unverified identity still fail closed. The encrypted storage engine retains its owner + server `getUser()` checks, version comparison and exclusive Web Locks before writes.

Added five UI regression cases covering review-before-write, cancellation, success during same-user auth refresh, persistence of success status after window blur and lock on real blur/sign-out. **5/5 simulated UI checks passed**. Owner Chrome retest is still pending. Preserve all existing Stage 6B/6C1 and Stage 6C2 backups. A fresh ZIP is required.

### Updated first browser steps

1. Download a fresh branch ZIP to a new folder, restart the Python localhost server on the same origin `http://127.0.0.1:8006`, and hard-refresh `private-storage-lab.html`. Do not clear browser data.
2. Use **Re-check account and storage** to confirm that Stage 6C2 compartment is absent. If the compartment exists, STOP: do not overwrite.
3. Download and verify new legacy safety and encrypted source JSON files; acknowledge ownership.
4. Enter the **new working Stage 6B3 encryption passphrase**. Click **Review encrypted TEST compartment creation**. An inline review must appear. This step does NOT create storage.
5. Check that the account and backups on the review are correct, then click **Confirm and create encrypted TEST compartment**. Expect an explicit success with revision 1 and two workouts/two favorites, OR an error that stays on the page.
6. If the status is anything else, STOP and send the status screenshot (hide passphrase). Do not retry and do not clear storage.
## Owner Chrome results — November 17, 2026

These results are from owner-reported Chrome screenshots and confirmations using a fictional Test User on the localhost test origin, **not** a security audit or production release:

- The first and second native-browser-confirmation attempts failed to display success and a subsequent account/storage recheck reported no private compartment. These early attempts were NOT marked successful.
- In the revised inline-confirmation build, Test User account and Stage 6A device owner verified; fresh legacy and Stage 6B encrypted backups downloaded and acknowledged.
- Inline **Review encrypted TEST compartment creation** appeared without a native dialog. After final confirmation, green success message reported **Stage 6C2 encrypted compartment created and verified (revision 1), 2 workouts, 2 favorites, originals preserved**.
- New Stage 6C2 private compartment unlocked with the working separate encryption passphrase. Screenshot confirmed **2 workouts, 2 favorites, 1 saved meal, revision 1**, and expected favorite names.
- The inline favorite-save review opened. Final confirmation saved fictional `TEST - Stage 6C2 Encrypted Favorite` in v2 only. Screenshot confirmed **2 workouts, 3 favorites, 1 saved meal, revision 2**.
- Owner hard-reloaded the page and unlocked the v2 compartment again. Screenshot confirmed revision **2** and all **3** favorites persisted, including the fictional test favorite.
- Owner downloaded the new `lift-journal-STAGE-6C2-ENCRYPTED-*.json` archive and confirmed the download succeeded. This archive format does not have a tested restore workflow.
- Owner clicked **Lock and hide test data**. Screenshot showed private section hidden and passphrase needed to unlock again.
- Owner then checked the original `index.html` and replied **passed** after verifying it still had **2 fictional workouts and 2 saved favorites**, unlike the v2 compartment with 3 favorites.
- **Not yet verified for Stage 6C2A:** wrong-user/Admin restriction in this new lab, wrong-passphrase save refusal in real Chrome, concurrent-tab race, interrupted real write, corrupted-record recovery, and a full v2 backup restore. Earlier Stage 6C1 viewer account-switch tests do not substitute for Stage 6C2A lab testing.

Result: **Stage 6C2A create/unlock/save/reload/original-unchanged path passed owner Chrome tests**. All original plaintext storage persists, so full shared-browser privacy remains **NOT IMPLEMENTED**.
- **Final account-switch browser results (2026-11-17):** User signed out of the linked Test User and signed into the existing Admin test account. Stage 6C1 private viewer reported `PRIVATE VIEW LOCKED` and Stage 6C2A storage lab reported `PRIVATE STORAGE LOCKED: this browser belongs to another linked test account` with no unlock section, workouts, or favorites displayed. This verifies UI-level owner restriction for this scenario.
- User signed Admin out, signed the original Test User back in, and saw that the encryption unlock section was restored but data remained hidden pending the separate passphrase.
- User then unlocked Stage 6C2A again: screenshot verified **2 workouts, 3 favorites, 1 saved meal, revision 2**, including `TEST - Stage 6C2 Encrypted Favorite`. These persisted after account switching.
- **Owner Chrome scoped Stage 6C2A happy-path test sequence COMPLETE.** This does not establish full app privacy, security audit, off-origin isolation, v2 restore, interrupted-write browser resilience, offline sync, or migration readiness. Keep Draft PR #11 unmerged and production unchanged.

## Remaining Stage 6C2B / 6C3 release blockers

- Gate the **normal** Lift Journal UI BEFORE any private data is loaded; never initialize sensitive history while signed out or another account is active.
- Replace synchronous legacy `save()` with a reliable queued encrypted write-through commit path, acknowledge saves only when durable, block/flush safely before exit, and expose error/unsaved status.
- Migrate or restructure all private fields together: workouts and sets, calendar/programs, favorites, nutrition and scanned foods, running, video links, coach settings, device backup/import.
- Explicit full safety-backup confirmation, migration preview, testing of full restoration on a separate origin, and only then an independently approved plaintext-removal plan. Stage 6C2A intentionally retains plaintext data.
- Redesign embedded and standalone cloud sync to use verified unlocked per-account data, no cross-account attribution, and RLS. Add multi-tab, offline, quota, crash, corrupted records, passphrase recovery and mobile-browser tests.
- The storage lab's v2 exports are NOT restorable through the app yet; don't rely on them as sole backups.

**IMPORTANT:** Stage 6C2A is a storage-engine test; it is NOT evidence of full privacy in the regular Lift Journal app.