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

## Remaining Stage 6C2B / 6C3 release blockers

- Gate the **normal** Lift Journal UI BEFORE any private data is loaded; never initialize sensitive history while signed out or another account is active.
- Replace synchronous legacy `save()` with a reliable queued encrypted write-through commit path, acknowledge saves only when durable, block/flush safely before exit, and expose error/unsaved status.
- Migrate or restructure all private fields together: workouts and sets, calendar/programs, favorites, nutrition and scanned foods, running, video links, coach settings, device backup/import.
- Explicit full safety-backup confirmation, migration preview, testing of full restoration on a separate origin, and only then an independently approved plaintext-removal plan. Stage 6C2A intentionally retains plaintext data.
- Redesign embedded and standalone cloud sync to use verified unlocked per-account data, no cross-account attribution, and RLS. Add multi-tab, offline, quota, crash, corrupted records, passphrase recovery and mobile-browser tests.
- The storage lab's v2 exports are NOT restorable through the app yet; don't rely on them as sole backups.

**IMPORTANT:** Stage 6C2A is a storage-engine test; it is NOT evidence of full privacy in the regular Lift Journal app.