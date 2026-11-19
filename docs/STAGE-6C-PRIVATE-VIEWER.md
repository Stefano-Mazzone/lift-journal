# Lift Journal 2.0 — Stage 6C1: gated encrypted private viewer (DRAFT)

**Status:** Implemented in Draft PR #11. Pure-function and static checks passed in an isolated JS harness. OWNER CHROME TESTS PASSED for the scoped read-only viewer, including browser auto-lock retest and return-to-owner unlock. Final manual relock confirmed by owner screenshot; private viewer locked and no workout information visible. Production unchanged; public signup and automatic sync stay disabled.

## Scope and privacy limitations

Stage 6C1 adds **private-preview.html**, a standalone, localhost-only, **read-only** view of the owner's encrypted Stage 6B3 recovery copy. This is NOT yet full account isolation. The normal index.html still reads/writes unencrypted lift-journal-v1 on the same origin. Other browser users can still see the legacy data through that original app. No original data was migrated, deleted, imported or overwritten.

Requires an existing server-verified Supabase Test User, Stage 6A linked owner marker on the same browser origin, a matching encrypted owner ID, and a separate encryption passphrase. Stored authentication tokens alone are never treated as verified identity. Wrong/Admin accounts are refused.

Only a temporary read-only DOM view is shown: workout counts, up to 40 workout names/dates/exercises, favorite count and up to 40 favorite names, meal and running-log counts. All user strings render via textContent. No decrypted data is saved to browser storage or uploaded. Manual lock, signout, switching accounts, leaving the tab, losing browser-window focus, navigation/pagehide, any auth/owner/vault storage change, and failed periodic identity checks clear the display. **2026-11-09:** Added window-blur locking after owner screenshot still showed an unlocked page during tab-switch testing. Simulated blur/visibility events now both clear all displayed rows; subsequent owner Chrome retest confirmed data hidden on tab return.

This does NOT protect an unlocked screen, compromised browser extensions/scripts, browser memory inspection, lost passphrases, or the original plaintext app. Full account isolation requires a separate migration and encrypted write-through redesign.

## Files

- private-preview.html — standalone localhost private-viewer test UI.
- stage6c-private-viewer.mjs — verified auth, owner lock, encrypted unlock and lock lifecycle.
- stage6c-private-core.mjs — read-only private summary and account match checks.
- stage5-account-panel.mjs + draft index.html — Settings link shown only to authenticated linked owner (destination also independently checks).
- tests/stage6c-private-viewer.test.mjs — 7 Node checks; pure-function and static checks also inspected with isolated JS harness.

## Browser testing with fictional data only (one step at a time)

1. Keep all earlier JSON backups, especially the working new encrypted and unencrypted recovery files. DO NOT CLEAR CHROME DATA.
2. Download latest ZIP from feature/lift-journal-2-auth-preview; extract new **Lift Journal 2.0 - Stage 6C1 Testing** folder. Stop previous Python server with Ctrl+C and restart from the new inner source folder on port **8006** using: python -m http.server 8006 --bind 127.0.0.1. Use same Chrome profile and exact origin.
3. Open http://127.0.0.1:8006/index.html and confirm 2 workouts, 2 favorites, signed-in original Test User and active Stage 6A owner link.
4. In Settings click **Open Stage 6C private viewer (read-only test)** or open http://127.0.0.1:8006/private-preview.html. Confirm workout and favorite names are hidden before passphrase.
5. Enter the NEW successfully working Stage 6B3 encryption passphrase (not the old failed passphrase or Supabase account password). Do not share it. Unlock; expect 2 workouts and 2 favorite names. Read only.
6. Click **Lock encrypted history**. Verify counts and names disappear and a new unlock requires the passphrase again. Switch tabs and return: expected locked.
7. Click **Sign out and lock private viewer**; verify names disappear. Sign in as Admin test account; expect private viewing LOCKED and no decrypt access to original Test User copy. Do not sync or import.
8. Sign out Admin and back in as Test User. Viewer should need the separate encryption passphrase again. Original legacy index.html still visibly shows plaintext workouts after signout — known limitation, not a passed full privacy test.
9. Verify original History and Movements unchanged. Keep PR draft, do not merge/deploy or use real data.

## Owner Chrome test results — 2026-11-09 (fictional data)

- Existing Test User verified and legacy Stage 6A device link recognized; two fictional workouts and two favorites still present in regular app.
- Viewer showed no workout/favorite names before separate vault passphrase.
- Encrypted read-only unlock returned **2 workouts, 2 favorites, 1 meal, 0 runs**, with expected names.
- Manual **Lock encrypted history** hid names and statistics; needed passphrase to reopen.
- Initial screenshot after purported tab switch still displayed unlocked content, so auto-lock was NOT accepted; window blur lock was added and regression simulated.
- On updated ZIP/port 8006, owner supplied before/after screenshots: two workouts and favorites visible while unlocked, then hidden upon returning after tab switch. Auto-lock **PASS**.
- Sign out returned to account sign-in form, with history and passphrase unlock hidden. **PASS**.
- Different existing Admin account correctly showed **PRIVATE VIEW LOCKED**; no encrypted unlock form. **PASS**.
- Returning to original Test User restored only the passphrase prompt, not data. **PASS**.
- Unlock after account switch again showed **2 workouts, 2 favorites, 1 meal, 0 runs**. **PASS**.
- Owner subsequently supplied screenshot confirming final manual relock: account remains verified, passphrase required and no workout history shown. **PASS**.
- These results verify this limited viewer, NOT encrypted storage behavior of the original app. Legacy plaintext storage remains a release blocker.
## Next Stage 6C2 release gates

- Account gate before legacy app reads any personal history; enforce encrypted account compartments for entire app, not only viewer.
- Reliable encrypted write-through for workouts, schedule, programs, favorites, nutrition, running and all other user fields; no fire-and-forget data-loss risk.
- Explicit, recoverable legacy migration with full backup and informed consent before any plaintext removal.
- Rewrite embedded/standalone manual sync for verified unlocked per-account data while preserving RLS, duplicate safeguards and manual approvals.
- Test browser reload, cross-tab races, offline failure, storage quota, corrupted data, password loss/recovery, and account switches.

**Release gate:** PR #11 stays draft and unmerged; production, public registration and automatic sync remain unchanged.