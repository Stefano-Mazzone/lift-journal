# Lift Journal 2.0 — Stage 6C3A read-only private app preview

**Status (2026-11-18):** Implemented in Draft PR #11. **Owner Chrome acceptance test PENDING**. The browser-independent Stage 6C3A test harness passed 8/8 pure-model tests and 9/9 mocked UI tests in a JavaScript runtime; this does not substitute for live browser tests or a security audit. The regular \`index.html\` is unchanged, production deployment is unchanged, public signup/automatic sync remain off, and the PR must remain DRAFT.

## Scope

**This is a new, separate encrypted-only screen**, not yet the normal full workout application. Open \`http://127.0.0.1:8006/private-app-preview.html\` only on the same origin and Chrome profile used for Stage 6C2. The page is localhost-only.

- Gate on Supabase signed-in user verification, linked device owner marker, existing encrypted v2 compartment and the user's **separate** encryption passphrase. The Admin or any other account should see \`PRIVATE APP LOCKED\` and no passphrase/History controls.
- Decrypt through the existing Stage 6C2A \`openCompartment\` method (server re-verifies the account before and after decryption), then derive a **read-only** summary model with workout dates, exercise names, weights, reps, set completion, saved favorites and workout counts.
- Show two responsive tabs: **History** (exercise-by-exercise workout records with sets and weight units) and **Movements** (favorites plus names seen in the 100 most recent private workouts), with search/filter fields. These fields filter the read-only local view only and are never stored.
- Hide and clear decrypted DOM elements on explicit lock, window blur, tab hidden, navigation, sign-out, account change, or encrypted storage changes in a different tab. As a conservative prototype this still locks when switching away to ChatGPT/screenshots, which the owner previously identified as inconvenient; better normal-app lock UX needs its own design/testing before release.
- No workout editing, program generation, calendar mutations, food editing, import, save, destructive action, cloud sync, or data migration. No new writes to the encrypted compartment, the legacy plaintext \`lift-journal-v1\` key, or the older Stage 6B recovery copy. The Supabase authentication library may refresh its own session token; that is separate from workout storage.
- Use DOM \`textContent\`, not \`innerHTML\`, for dynamic private workout names; do not place private data into URLs, console logs, markup on a locked page or localStorage. The pure model freezes derived read-only objects and caps displayed workouts at 100 (total count remains accurate). Private data exists in runtime memory while unlocked and cannot be guaranteed to be wiped from JavaScript heap by code.

## New files

- \`private-app-preview.html\`: read-only History + Movements prototype, clear privacy warning and mobile-responsive visual styling.
- \`stage6c3a-readonly-model.mjs\`: pure data transformation; supports saved sessions, exercises, sets, favorites, and meal summary; refuses malformed structures; no storage or network access.
- \`stage6c3a-readonly-ui.mjs\`: owner gate and encryption unlock, no write path; safe DOM renderer; account changes and visibility lockouts.
- \`tests/stage6c3a-readonly-model.test.mjs\`: 8 cases.
- \`tests/stage6c3a-readonly-ui.test.mjs\`: 9 isolated/mock cases.
- Added navigation from the earlier \`private-workout-test.html\` to the new read-only screen. Normal \`index.html\` remains unchanged.

## Existing encrypted reference data

From completed owner Stage 6C2B testing: the linked original Test User's **v2 encrypted** compartment contains **3 fictional workouts, 3 favorites, 1 saved meal, revision 3**, with \`TEST - Stage 6C2B Private Workout\` dated 2026-11-18, 20 kg × 10 reps, one checked set. The older Stage 6C1 recovery copy is separate and still has 2 workouts/2 favorites. The normal \`index.html\` keeps its original 2 fictional workouts and 2 favorites. The owner already downloaded a v2 revision-3 JSON safety backup, which is **not yet independently inspected or restorable in the app**.

## Owner Chrome acceptance checks — start here, one step at a time

1. Preserve all old ZIP folders and JSON backups. Download the latest Draft PR branch ZIP to a **new folder** (e.g. \`Lift Journal 2.0 - Stage 6C3A Read Only\`), extract, and restart \`python -m http.server 8006 --bind 127.0.0.1\` **inside the directory containing \`index.html\` and \`private-app-preview.html\`**. Close the old server first. Use the same Chrome profile and **exact** origin \`http://127.0.0.1:8006\`.
2. Open \`http://127.0.0.1:8006/private-app-preview.html\`, hard-refresh, verify linked original Test User and existing encrypted compartment. **No workout names or favorites should appear before unlock**. If signed out, sign in through \`private-preview.html\` with the original linked Test User; never share passwords.
3. Enter the existing working **separate** encryption passphrase; click **Unlock private History & Movements**. Expect **3 workouts, 3 favorites, 1 saved meal, revision 3**. History displays the three fictional workouts. The Nov 18 Stage 6C2B Goblet Squat workout should show **20 kg × 10 reps**, one checked set.
4. Click **Movements**. Check favorite stars for Goblet Squat, Lat Pulldown and \`TEST - Stage 6C2 Encrypted Favorite\`. Type a search term and ensure list filters without any saving controls. Switch back to History. **No changes or writes should occur.**
5. Click **Lock and hide private information**. Verify no decrypted workout names, set details or favorites remain visible. Optionally verify that leaving the tab locks automatically and that a fresh unlock restores the same data.
6. Sign out the linked Test User from the older account sign-in/out page, sign into Admin, open Stage 6C3A. Expect **PRIVATE APP LOCKED** with no private data or unlock controls. Sign out Admin, return as original Test User and re-unlock revision 3. Do not edit/migrate/delete any data.
7. The owner may separately verify \`index.html\` still has **2 original workouts and 2 favorites** and \`private-workout-test.html\` still has the **3 encrypted workouts**. A new backup is unnecessary for this read-only stage.

**If numbers, account verification, fields, or access controls differ, stop and report the exact message. No import, editing, migration, or storage clearing.**

## Critical next steps — not complete

- **6C3B:** build an ordered, account-bound, durable encrypted write adapter (only a standalone disposable fictional edit at first); test stale tab, conflicting revision, failed storage, wrong passphrase and independent readback.
- **6C3C:** migrate the real app's synchronous \`save()\` callsites carefully behind the adapter and a startup privacy gate; do not send data from plaintext \`lift-journal-v1\` to the private compartment without explicit owner consent.
- **6C3D:** fully tested v2 restore/import and explicit preview-and-verify migration with source preservation.
- **6C3E:** full browser/mobile acceptance, Android PWA tests, account isolation, offline and UX/accessibility checks.

**Do not deploy or merge. The regular app is still not fully private.**
