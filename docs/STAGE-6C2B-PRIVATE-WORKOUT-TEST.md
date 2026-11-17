# Lift Journal 2.0 — Stage 6C2B private workout-entry test

**Status (November 17, 2026):** Draft PR #11 implementation completed, **owner Chrome test pending**. Eight isolated pure-schema/static checks and five mocked UI checks passed. Full Node suite not executed in this environment. Stage 6C2A read/write/lock/reload/account-switch tests already passed in the owner's Chrome session. Production unchanged.

## Why this is separate instead of modifying the main app

The existing regular `index.html` (about 350 KB with ~4,200 lines) immediately loads plaintext `lift-journal-v1` at startup and writes synchronously via `save()` to localStorage. This makes it unsafe to introduce asynchronous encryption by simply editing one save call. Full migration requires a gate BEFORE app startup, an unlocked in-memory state, serial encrypted write acknowledgments, cross-account protections, safe reload and an audited migration/restore path.

Stage 6C2B therefore introduces a **standalone encrypted workout-entry page** which can add exactly one disposable completed workout to the **existing Stage 6C2A v2 encrypted compartment**. It is a narrow implementation rehearsal, not full private mode or a replacement main app.

## Files and guarantees

- `stage6c2b-workout-core.mjs` — pure, no-I/O workout-session creator compatible with the current saved session schema: month, day, cycleIndex, programNumber, scheduledDate, started/finished, unit, name, exercises and sets. Strictly validates date, prescribed test movement, weight, reps, set count and unique `test-6c2b-*` UUID. Adds only a NEW session; original in-memory data object is not mutated.
- `private-workout-test.html` — localhost-only encrypted workout entry UI with an explicit warning. Requires verified linked account, v2 passphrase and a two-step inline review/confirmation.
- `stage6c2b-workout-ui.mjs` — server `getUser` + device-owner checks, encrypted-only `openCompartment` / `commitCompartment` / independent readback, current revision verification, source state comparison, and temporary DOM summary. Uses textContent for workout names. Browser tab switching/blur, sign-out, owner or encrypted storage changes lock the viewer. No native `confirm()` modal.
- `tests/stage6c2b-workout-core.test.mjs` — eight pure schema, safety and static tests.
- `tests/stage6c2b-workout-ui.test.mjs` — five isolated UI mocks for locked-before-passphrase, two-step review/no writes, confirmed encrypted append/readback, focus loss, blocked Admin and sign-out. **These mocks do not prove browser or network behavior.**
- Stage 6C2A `private-storage-lab.html` has a link to the new Stage 6C2B page. Regular `index.html` is NOT changed.

## Expected test data before starting

Stage 6C2A encrypted Test User compartment: **2 workouts, 3 favorites, 1 meal, encrypted revision 2**, with `TEST - Stage 6C2 Encrypted Favorite` in favorites. Regular original Lift Journal remains **2 workouts and 2 favorites**. Keep all JSON backups, including Stage 6C2A encrypted export. Test User account is the original linked account.

## Owner Chrome testing, one step at a time (fictional only)

1. Download fresh ZIP from `feature/lift-journal-2-auth-preview` to new `Lift Journal 2.0 - Stage 6C2B Private Workout Test` folder. Keep prior ZIP folders and all JSON backups. Restart Python local server on exact SAME `http://127.0.0.1:8006` origin and Chrome profile.
2. In browser, hard reload `http://127.0.0.1:8006/private-workout-test.html`. Check verified Test User / device owner and **no workout details visible before passphrase**. If signed out or a different account, private area must remain hidden.
3. Enter the existing *working* Stage 6B3/6C2 encryption passphrase. Unlock. Expect **2 workouts, 3 favorites, 1 meal, revision 2**. Do not send the passphrase.
4. In the single-movement entry form, use the default fictional data: current date, Goblet Squat, weight 20 (saved account unit), 10 reps, one set. Repeat passphrase and click **Review fictional encrypted workout save**. Check inline description. No write should happen yet.
5. Click **Confirm encrypted TEST workout save**, and stay on the tab. Expect new encrypted revision **3**, **3 workouts**, **3 favorites**, **1 saved meal**, and a new `TEST - Stage 6C2B Private Workout`. On any error or missing result, STOP; do not retry.
6. Hard reload, re-verify and unlock. Expect same **revision 3 / 3 workouts / 3 favorites** and new fictional workout entry. Confirm no duplicate records.
7. Open normal `index.html` in a separate tab and confirm unchanged **2 workouts / 2 favorites**; do not import/sync any data. Return to Stage 6C2A lab and confirm v2 compartment now has revision 3 / 3 workouts / 3 favorites.
8. Lock Stage 6C2B and optionally verify Admin can't see private area. Keep originals and export another encrypted v2 backup from lab if desired. v2 export does **not** yet have a verified restore workflow.

## Release blockers — not done

- Regular `index.html` still loads plaintext `lift-journal-v1` before authentication; user switching accounts in the original app can see that data. Full privacy NOT achieved.
- The new page is intentionally a reduced workout-entry test, not the real Coach/Plan/Train/History/calendar workflow. Existing completed workout edits, draft auto-save, programs, food scans and running still use legacy app.
- Need safe architecture: startup authentication gate, encrypted data adapter inside the main app, serial async durable writes and error-state UI, source-of-truth and cross-tab design, offline and quota handling, migration and restore rehearsals.
- Owner Chrome tests, multi-tab and failure tests, migration/recovery, v2 import/restore, mobile installation testing and cloud sync must all pass before any merge. Automatic sync and public signup remain OFF.

**Release gate:** Draft PR #11 must remain unmerged. Use only fictional test data.