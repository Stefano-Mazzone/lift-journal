# Lift Journal 2.0 — Accounts and Cloud Sync (Phase 1)

## Current draft scope (PR #11)

This branch adds an **isolated** account preview at auth-preview.html, connected to the Lift Journal Supabase project using its **public publishable** API key, with the SDK version pinned.

- auth-config.js — public project URL and publishable key; signupEnabled is false.
- auth-ui.mjs — test-only password sign-in, session verification, sign-out, private profile lookup and editing, plus explicit saving/listing of cloud **sample workouts** (not real workout sync).
- auth-preview.html — responsive UI with disabled sign-up fields, profile controls, and a cloud workout test area. Saving requires an explicit confirmation; records are labeled TEST.
- No changes to the production index.html, service worker, Cloudflare Worker, or existing workout data.

This is **NOT** a production-ready account rollout. PR remains a draft and must not be merged without explicit owner approval.

## Important security boundary: disable Supabase signups server-side

The frontend signupEnabled:false switch prevents this preview from offering public signup, but it is **not a security control**; third parties could still call the public Auth endpoint directly when Supabase allows signups.

**Before any deployment or real authentication test, go to Supabase > Authentication > Sign In / Providers and turn OFF "Allow new users to sign up", then Save.** Existing accounts can still sign in when backend signups are disabled. For initial testing, manually provision a test account in Authentication > Users (or use another authorized approach). Do not share passwords.

## Preconditions before opening public registration

1. Set up verified custom SMTP with an owned domain; Supabase's default email sender only delivers to organization team addresses and is not for public signup.
2. Ensure signup-related email redirects point to a production-capable callback, and that the callback is on the allowed Redirect URLs list.
3. Keep email verification on and review password reset, account deletion, abuse protection and rate limits.
4. Test RLS against two distinct authenticated users and one anonymous client: authenticated SELECT/INSERT/UPDATE must affect only the matching auth.uid profile; anon must not read or alter profiles. Test Data API exposure, SQL grants, and negative cases.
5. After passing tests, add an opt-in migration and cloud storage implementation for localStorage key lift-journal-v1. Never clear local data on login, logout, or profile operations.
6. Review app privacy notices and user account security. Keep workout logging usable without an account until a safe migration is verified.
7. Obtain explicit authorization for any merge or production release.

## Test flow after owner authorizes a test deployment

1. Confirm Supabase new signup is disabled server-side.
2. Create one test account through the Supabase Dashboard under Authentication > Users, preferably using the authorized organization email and a strong unique password.
3. Test sign-in on a dedicated HTTPS testing deployment of auth-preview.html. The GitHub draft PR by itself does not host a test website.
4. With a signed-in test account, create its profile via the explicit button, edit the display name, refresh, and sign out. Confirm its data persists and only belongs to that account.
5. Create a second test account and verify it cannot read/edit the first user's row. Check that unauthenticated requests cannot see profiles.
6. Only after all checks, and after further review, consider an owner-approved merge to the production repo.

## Not implemented here

- Public sign-ups, invitation email, confirmation callback, password reset, social logins.
- Automatic profile creation or automatic upload/merge of existing workouts.
- Automatic or real workout storage/sync from the live Lift Journal app, safe download/merge into its local history, messaging, AI history integration, subscriptions.

Lift Journal launches free first, with optional Pro later.

## Verified manual Supabase tests (October 25, 2026)

The owner confirmed by screenshots:
- Two manually provisioned test accounts with distinct profiles (Admin and Test User).
- Session persistence after browser reload.
- RLS isolation: one account's profile SELECT and UPDATE cannot access the other account's profile.
- Anonymous profile SELECT returns zero rows.
- After correcting broad grants, public.profiles granted only SELECT, INSERT, UPDATE to authenticated; anon and DELETE denied.
- public.workouts table created with a separate user_id, a unique (user_id,client_workout_id), JSONB data, three authenticated own-row RLS policies, and exposed through Data API.
- SQL grants for public.workouts verified: only authenticated SELECT, INSERT, UPDATE.
- A sample workout inserted through the REST API as Test User; its row verified in Table Editor.
- Admin could neither SELECT nor UPDATE the Test User workout through the authenticated REST API; anonymous SELECT returned zero rows.

## New UI test to perform (not yet browser-tested)

1. Keep Supabase > Authentication > Sign In / Providers > **Allow new users to sign up** OFF.
2. Download a fresh ZIP of branch feature/lift-journal-2-auth-preview and extract it; previously downloaded ZIPs do not update automatically.
3. Start the local Python server from the inner folder containing auth-preview.html:
   python -m http.server 8000 --bind 127.0.0.1
4. Open http://127.0.0.1:8000/auth-preview.html and sign in as Test User.
5. Check Your cloud workouts — test area, where the manually created "TEST - Cloud Storage" record should appear.
6. Click Save sample workout and approve the browser confirmation. Expect a success notice and an additional "TEST - Workout saved from preview" record.
7. Click Refresh cloud list and verify both records appear. Sign out and sign in as Admin; expect no Test User cloud workouts.
8. Do not import or sync any real device workouts in this test; no cloud delete is implemented and sample records remain until explicitly cleaned up.

This change is **draft only**, and does not touch the public app or local workout data. All UI/network behavior must be verified on the owner's machine before considering further work.

## Stage 1 — Opt-in, non-destructive backup upload (draft; browser test pending)

Files:
- `cloud-backup-upload.mjs` parses Lift Journal's actual Settings > Export backup (.json) structure: `{ format:"lift-journal-v1", data:{unit,sessions} }`.
- `auth-preview.html` adds a signed-in-only backup picker, completed-workout selection, explicit confirmation, and upload status.
- `tests/fixtures/lift-journal-backup-sample.json` contains one synthetic completed workout suitable for tests when no real workouts exist.
- `tests/backup-upload.test.mjs` contains pure-parser validation tests; runnable with `node --test tests/backup-upload.test.mjs` for development (Node is optional for the owner's Python web server).

### Important safeguards

1. **Opt-in only:** Selecting a file does not upload anything. The user selects individual workouts or explicitly selects all, then confirms the account email and data scope in a second dialog.
2. Only completed workout sessions in `data.sessions` are considered; unfinished sessions are excluded. Nutrition, running logs, favorites, and other top-level backup data are **not** uploaded.
3. Backup is read as a local file and remains unchanged. The module never touches `localStorage` (notably `lift-journal-v1`), and it does not import anything back onto the device.
4. Cloud row ID: `client_workout_id = "lj-session:" + originalSessionKey`. Existing rows with that same ID **for the same account** are skipped. Re-selecting a backup will not overwrite cloud records. This pilot offers **INSERT only**, no upsert/update/delete.
5. Records preserve workout data from each completed session, including any recorded sets, notes, check-in data, and training preferences. The confirmation warns about potentially sensitive content. Upload cannot currently be undone through this preview.
6. Fail closed if duplicate lookups fail. Limit files to 20 MB and 250 completed workouts; batch inserts in groups of 10. Network errors may leave a **partial upload**; select the same file again to recheck which IDs succeeded.
7. Database RLS/GRANT still restrict reads/writes to the signed-in account; the importer checks account identity before each batch and clears selected files on sign-out/account change.
8. This is an **experimental test flow only**. Backup import/download, conflict resolution, schema migrations, offline queues, and automatic synchronization have **not** been implemented. Do not treat this as a production migration feature.

### How to test (after downloading the NEW branch ZIP)

1. Keep Supabase public signups disabled, and retain a backup of any current local Lift Journal data.
2. Extract a fresh ZIP of branch `feature/lift-journal-2-auth-preview`. Earlier downloaded folders do not update automatically.
3. In the **inner folder containing auth-preview.html**, run `python -m http.server 8001 --bind 127.0.0.1` and open `http://127.0.0.1:8001/auth-preview.html`.
4. Sign in as Test User. In "Cloud upload from a Lift Journal backup", choose the synthetic sample JSON through the supplied download link (or a genuine backup from the live app).
5. Check that one completed workout is previewed and nothing is uploaded until a checkbox is selected.
6. Select it, click "Upload 1 selected workout", read the account/data confirmation, and accept. Expect one extra row under Test User.
7. Choose the **same backup again**; the new record must show "ALREADY IN CLOUD — skipped" and not be selectable.
8. Sign out and sign in as Admin. That uploaded workout must not appear. The original backup file and live app data must remain untouched.
9. If any unexpected change or error occurs, stop and capture a screenshot. Do not attempt repeated bulk uploads without review.

### Further tasks before wider rollout

- Add controlled download and non-destructive merge of cloud workouts, with explicit conflict choices.
- Test offline mode, retries, two-device edits, deduplication, and handling of partial failures.
- Decide how sensitive workout/check-in information will be handled in the privacy policy.
- Configure custom SMTP and consent/retention settings before enabling public registrations.
- Move the stable schema and RLS policies to version-controlled database migrations.


## Stage 2 — Private, non-destructive cloud archive download (draft; needs owner browser tests)

Added `cloud-workout-download.mjs` and a signed-in-only section after the Stage 1 uploader. This feature:
- Loads **all** workouts visible to the current authenticated account (not just the latest 25) through RLS-protected, user-scoped, paginated API reads (200 per page).
- Shows names, dates and exercise counts. Users select individual workouts or click `Select all workouts`.
- Before downloading, explicitly confirms the signed-in email, number of workouts and sensitivity of exported training/check-in data.
- Downloads **only the selected workout data** as `lift-journal-cloud-workouts-YYYY-MM-DD.json`.
- Refuses incomplete/invalid cloud responses, count inconsistencies and duplicate IDs; maximum 5,000 workouts and a 20 MB output in this pilot.
- Resets the visible list/selections when switching accounts; never reads or writes the live app's `lift-journal-v1` localStorage, and never changes Supabase records.

### Archive format is deliberately incompatible with the live app importer

The exported file has `format: "lift-journal-cloud-workouts-v1"`, `workout_count`, and `workouts` array with `client_workout_id`, `workout_data`, `created_at`, and `updated_at`. It omits row UUIDs, owner IDs, and authentication data. It is a private, portable **cloud archive** that can be examined and backed up on another device.

**It does NOT restore workouts into Lift Journal's history.** The existing production Settings > Import backup action replaces local data, rather than merging. Never tell a tester to import this Stage 2 archive through that action. A separate conflict-aware, non-destructive merge path will be developed and tested before device restoration.

### Stage 2 browser test plan

1. Download a fresh ZIP of `feature/lift-journal-2-auth-preview` after the Stage 2 commit; old extracted folders are not updated automatically.
2. Start a local Python HTTP server in the inner folder that contains `auth-preview.html` and `cloud-workout-download.mjs` (a new unused port can be used).
3. Sign in as Test User. In `Stage 2 — Download your cloud workouts`, click `Load my cloud workouts`. Expect the existing four or more Test User records (the two sample records and one backup-imported record have already been manually verified; actual count may have increased).
4. Select only `TEST - Imported From Backup`, click Download, read the warning and confirm. Browser should save `lift-journal-cloud-workouts-YYYY-MM-DD.json`.
5. Inspect the downloaded JSON in a text editor. It should have `format: "lift-journal-cloud-workouts-v1"` and exactly one workout, including its exercises.
6. With another test account (Admin), load the cloud list and verify only Admin's data appears. Sign out and verify the previous list and selections are cleared.
7. Check live Lift Journal on each device: no history changed. Do not use the existing `Import backup` feature with this archive.

Pure function/read pagination tests: `node --test tests/cloud-workout-download.test.mjs` (Node optional for local Python server). Browser-side download flow still requires manual owner confirmation.

**No production release, automatic sync, cloud deletion, or local merge is included.**

## Stage 3 — Non-destructive workout merge preview (draft; browser test pending)

### Why Stage 3 uses a destination-device backup

The existing live `Settings → Import backup (.json)` feature **replaces** all device data including sessions, nutrition, running, program, favorites and settings. The isolated `auth-preview.html` is on a different origin from the production app and deliberately cannot read or change the installed app's localStorage. Therefore Stage 3 is a **manual, review-only merger** — NOT automatic restoration or live sync.

The signed-in user supplies a full `lift-journal-v1` backup **exported from the device that should receive the cloud workouts**. Stage 3 then:
1. Validates that full destination backup locally (max 20 MB and 10,000 workouts).
2. Fetches **this account's** complete cloud workout list using the existing read-only RLS-scoped, paginated `fetchCloudWorkouts`.
3. Compares each cloud row against the destination backup. Only records with original Lift Journal session IDs (`lj-session:<original-id>`), completed sessions and compatible workout fields are selectable.
4. Unselectable items include cloud-only test placeholders, IDs that already exist on the destination device, malformed/incompatible sessions, and possible duplicates with matching exact start/end times.
5. The user explicitly selects workouts and then approves an account-aware confirmation before receiving a new `lift-journal-MERGED-PREVIEW-YYYY-MM-DD.json` file.
6. The new file is in the **complete** native `lift-journal-v1` format. It preserves every destination backup section, including existing workouts, food, running, favorites, program and schedule. Missing selected completed cloud sessions are added under their original IDs; existing sessions are **never replaced**. Each workout's original `lb`/`kg` unit is preserved.
7. The original destination backup file remains unchanged; nothing reads or writes the live app's localStorage and there are no Supabase mutations.
8. Merged output is revalidated and capped at the live importer's 20 MB size / 10,000-workout limits. Maximum of 250 new workouts in this pilot. On error, no output file is produced.
9. The UI and documentation explicitly **forbid importing the newly generated file into the real app during testing**. The file can be inspected and backed up; separately approve and test the destructive import flow on a disposable device/account or an isolated test copy first.

### Testing assets

- `cloud-safe-merge.mjs` — pure device-backup validator, cloud/session comparison, merged-backup builder, and isolated browser controls.
- `tests/fixtures/lift-journal-stage3-device-backup.json` — fictional destination device with **one existing completed workout**, `kg` settings, favorites, nutrition, running data, program and schedule.
- `tests/fixtures/lift-journal-backup-sample.json` — fictional Stage 1 original completed cloud workout with `lb` weights, already uploaded under Test User by owner.
- `tests/cloud-safe-merge.test.mjs` — regression tests for valid merges, non-mutating inputs, preservation of all destination sections, mixed weight units, duplicate/collision protection, invalid IDs/records, and output safety.

### First owner browser test (safe, no real device backups)

1. Download a **fresh ZIP** of branch `feature/lift-journal-2-auth-preview` after the Stage 3 commit. Open the inner folder containing `auth-preview.html` and `cloud-safe-merge.mjs`.
2. Run `python -m http.server 8005 --bind 127.0.0.1` there. Visit `http://127.0.0.1:8005/auth-preview.html`, sign in as Test User.
3. Scroll to **Stage 3 — Restore preview**. Click **download a fictional destination-device backup** and save `lift-journal-stage3-test-device-backup.json`.
4. Click **Choose destination device backup** and select the downloaded file. It should recognize **1 existing device workout**.
5. Click **Compare with my cloud**. Expect the previously uploaded **TEST - Imported From Backup** to be eligible; empty/incomplete manually created cloud test placeholders should be labeled incompatible and unselectable.
6. Select only **TEST - Imported From Backup**, click **Create merged backup**, carefully read the warning and confirm.
7. Open the new `lift-journal-MERGED-PREVIEW-YYYY-MM-DD.json` in a text editor. Expect `format: lift-journal-v1`, `data.sessions` containing both the existing **TEST - Already on destination device** and the cloud **TEST - Imported From Backup**. Check `favoriteMovements`, `nutrition`, `running` and `unit: kg` were preserved. The imported workout itself should have `unit: lb`.
8. **Do not import the new file into the real app.** Report screenshots and tests before any further restoration work.

### Not yet implemented

- Applying a merged backup to a device automatically.
- Non-destructive direct in-app import/merge and user-controlled conflict resolution.
- Automatic background sync, offline queues, changes across two devices, and data retention/deletion settings.
- Public authentication/signup. Supabase server-side new registrations must remain disabled.

**No production app file or original device data changed. Draft PR #11 must remain unpublished until explicit authorization.**


## Stage 4 — Opt-in, same-origin manual sync test (draft; browser test pending)

Stage 4 adds a **standalone loopback-only** \`sync-preview.html\` test page. **The live app (\`index.html\`) is unchanged**, and no automatic/background synchronization is enabled.

### Architecture and safety

- The sync page is served at **the same origin as a disposable local Lift Journal test installation**, e.g. \`http://127.0.0.1:8006/index.html\` and \`http://127.0.0.1:8006/sync-preview.html\`. Browser storage keys are isolated by *origin*, including **port**. Do not switch ports between those pages while testing the same fictional data.
- Only localhost/127.0.0.1 is allowed; the page refuses to initialize its Supabase test login on a public hostname.
- Uses the existing public Supabase publishable key and pinned SDK; **never** a service-role API key. Only authorized manually created test accounts may sign in. Public signups remain blocked server-side.
- Nothing runs automatically. The user must: **Compare with cloud**, select specific eligible records, **Download full local safety backup**, explicitly affirm that file was saved, separately confirm the local data belongs to the currently signed-in account, and approve a final account-scoped sync confirmation.
- Only completed *native* Lift Journal workout sessions with safe original session IDs are eligible; incomplete preview cloud rows are shown but disabled. In-progress local sessions remain stored only on the device.
- Cloud matching IDs with different content are **conflicts** and blocked (not arbitrarily overwritten); same timestamp across distinct IDs is a potential duplicate and also blocked. JSONB object keys are normalized for semantically correct equality comparisons.
- On each confirmed sync, cloud is **fetched again**, user identity reverified, local raw storage compared with the original snapshot, and the selected sync plan recalculated. If anything changed, stop rather than guessing.
- Cloud upload uses plain Supabase \`INSERT\` only, not \`UPSERT\`/\`UPDATE\`/\`DELETE\`. Local download adds **missing completed sessions only** to a cloned \`lift-journal-v1\` object and then saves it in the test origin's browser storage. It preserves all other local sections: existing workouts, schedule, nutrition, favorites, program, running logs, etc.
- Limits to **25 selected changes per manual sync** and **20 MB** for safety backup and resulting local data.
- A cloud insert may succeed before a later insertion/network failure or local storage failure. The page reports partial outcomes. On retry, compare first; never blindly repeat. It attempts to restore the previous storage snapshot if a local write fails.
- No delete, rename, modify, conflict resolution, background retry or offline queue. **Do not test with genuine workout history yet.** User data deletion/recovery, multi-device simultaneous edits and account lifecycle need further work.

### Files

- \`cloud-sync-core.mjs\` — pure compare/plan/data-clone/backup module. Shared Stage 3 validation enforces native session compatibility.
- \`cloud-sync-preview.mjs\` — local test UI, authorized Supabase query/insert, manual approval, backup, localStorage snapshot checking.
- \`sync-preview.html\` — independent authenticated loopback-only test page; intentionally not linked from production app.
- \`tests/cloud-sync-core.test.mjs\` — 15 pure test cases for two-way selection, exact merge preservation, unchanged source inputs, JSONB field ordering, collisions, stale selections, unfinished sessions, duplicate signatures, and safety backup.
- Existing \`tests/fixtures/lift-journal-stage3-device-backup.json\` and \`tests/fixtures/lift-journal-backup-sample.json\` — fictional records for tests.

### First browser test (owner)

1. **Download fresh ZIP** of \`feature/lift-journal-2-auth-preview\`. Do not reuse a previously extracted folder.
2. Open the old terminal that serves \`http://127.0.0.1:8006\` and press **Ctrl+C** to stop its Python server.
3. In the **new ZIP's extracted inner folder** (containing \`sync-preview.html\`, \`cloud-sync-preview.mjs\`, \`cloud-sync-core.mjs\`, \`index.html\`), start **the same port**: \`python -m http.server 8006 --bind 127.0.0.1\`.
4. Open \`http://127.0.0.1:8006/index.html\` in the **same Chrome profile**. Check both fictional Stage 3 restored workouts remain in History. If not, **stop**—the Stage 4 comparison should never fabricate/overwrite the missing local history.
5. Open a **new tab** at \`http://127.0.0.1:8006/sync-preview.html\`. Sign in with existing Test User credentials (do not paste passwords into chat).
6. Click **Compare this device with my cloud**. With the original fixtures, expect **2 local workouts, 4 cloud workouts, 1 safe upload** (the fictional destination-device Goblet Squat workout), **0 safe downloads** (the imported Stage 1 backup workout already exists locally), plus three unsupported cloud test placeholders.
7. Do **not select/apply yet**; send a screenshot for review before the first cloud insertion.
8. Only after reviewing that comparison: select the missing local workout, click **Download full local safety backup**, verify file exists, tick **both** the backup-saved and account-ownership acknowledgements, then approve manual sync to test cloud. Recompare to confirm it is now classified as **already in cloud**.
9. Refresh \`index.html\` on the same port and verify both workouts and the nutrition/favorites remain unchanged. Test with a *separate fictional test origin* for cloud-to-device download before any real data.

### Release gate

**No code in production \`index.html\`, \`service-worker.js\`, Cloudflare worker or service credentials was changed.** PR #11 must remain an unmerged draft pending explicit owner approval. Before a public launch we still need secure signup/SMTP, retention/deletion/consent, failure and conflict handling, a production UI for signed-in accounts, and true multi-device/offline tests.


## Stage 5A — Embedded test accounts in the ACTUAL Lift Journal Settings (draft; owner browser test pending)

**Scope:** The development version of \`index.html\` now contains a clearly marked **Account & Cloud Sync — STAGE 5 TEST** panel in Settings. It is a *real Settings integration*, not an independent account page. The verified Supabase login and private profile display run in new \`stage5-account-panel.mjs\`, sharing the same \`lift-journal-auth-test-v1\` session key with the Stage 4 standalone sync test.

- Test origin: **\`http://127.0.0.1:8006\` or \`http://127.0.0.1:8007\`** only (or localhost). On public hosts, the test login is hidden and no Supabase auth connection is opened by this module.
- Sign in using a manually created test account. On reload and Settings re-render, \`auth.getSession\` then **server-validated \`auth.getUser\`** checks that identity; the optional display name is read from RLS-restricted \`profiles\`, using text-only insertion into the DOM.
- Sign out uses Supabase \`scope:"local"\`, and Settings shows that device workouts remain unchanged. Multiple accounts must not be silently linked to browser workouts.
- The logged-in panel offers a **link to \`./sync-preview.html\`**, which preserves the proven manual comparison, selection, full backup, account-ownership acknowledgement, and confirmation safeguards. **Stage 5A does not yet embed the actual sync controls in Settings**; that is a future milestone.
- **Signing in/out does not read, write, clear, claim, or transfer \`lift-journal-v1\` workout/food/favorites/program data.** No automatic upload, download or background queue is started; regular offline Lift Journal features continue working without logging in.
- Only existing authorized **TEST** Supabase accounts may log in. Server-side public sign-up remains OFF. Do not copy private credentials or service keys into \`index.html\`.
- Added a tiny Settings mount event emitted from the existing \`render()\` to update the account controls after re-render. The existing workout event handlers and native import/backup logic remain otherwise unchanged.
- Added \`tests/stage5-account-panel.test.mjs\`: 6 isolated checks for app and module syntax, panel markup, mounting, verified-user/guest UI, localhost-only protection, same account session key, and no workout data access. Mocked V8 tests passed, but **real Chrome browser integration tests are still mandatory**.

### Stage 5A first owner browser test

1. Download a **fresh ZIP** of \`feature/lift-journal-2-auth-preview\`. Unlike Stage 4 patches, this test needs the updated **\`index.html\`**, new **\`stage5-account-panel.mjs\`**, and the existing **\`auth-config.js\`** and **\`sync-preview.html\`** together in the *same extracted inner directory*. Do not replace only the JS file.
2. Stop the old Python server at port 8006 via Ctrl+C and start the **new ZIP folder on the SAME port**: \`python -m http.server 8006 --bind 127.0.0.1\`. Use the **same Chrome profile** so the fictional 2-workout local test remains available.
3. Open \`http://127.0.0.1:8006/index.html\`; confirm History still shows both fictional workouts BEFORE doing account actions. If missing, stop and inspect the origin, do not re-import into a different origin.
4. Open **Settings** and inspect the new Account & Cloud Sync panel. If the prior Test User session persists, expect verified email **stef_world@hotmail.com** and profile **Test User**; otherwise sign in with the existing Test User account (never disclose password in chat).
5. From the Account panel, open **manual workout sync**. It should open \`http://127.0.0.1:8006/sync-preview.html\` on the **same port**, reuse the login, and compare to show 2 local, 5 cloud, 0 safe uploads/downloads, 0 conflicts.
6. Sign out from **Lift Journal Settings**; refresh History and verify both workouts still exist and all food/favorites remain. Note that sign-out on this port does not sign out of the *separate* port 8007 origin.
7. Optionally reload Settings and sign back in, then verify the email matches the test account. Do NOT sync or import any real workouts.

### Next Stage 5 milestone (NOT implemented yet)

Move the Stage 4 comparison, safe selection, backup download, and opt-in upload/download workflow **inside the Settings page itself** (rather than a link). Keep all destructive/auto-sync operations disabled pending tests. Later work: offline queue, multiple-device conflict resolution, public signup/SMTP, data deletion, recovery, privacy and production migration.

**Release gate:** PR #11 is a DRAFT. Do NOT merge to main, deploy GitHub Pages, update the production service worker, enable sign-ups, or use real user workout data until separately authorized.


## Stage 5B — Manual two-way sync directly in Lift Journal Settings (DRAFT, owner browser test pending)

Stage 5B extends the authenticated account section of **the development version of \`index.html\`**. When a verified test account is signed in, Settings now displays a native **Manual Workout Sync** panel rather than requiring a second tab. The standalone Stage 4 dashboard remains as an optional fallback.

**Files**
- \`stage5-manual-sync.mjs\`: new embedded Settings widget and manual flow, importing the already-tested pure \`cloud-sync-core.mjs\` and RLS-scoped \`fetchCloudWorkouts\` from \`cloud-workout-download.mjs\`.
- \`stage5-account-panel.mjs\`: imports the widget and provides current verified user + public client as dependencies. Existing account sign-in / sign-out never accesses device workouts.
- \`index.html\`: adds \`lj-stage5-sync-root\` inside the signed-in account section, a small responsive display style, and retains an optional fallback link to \`sync-preview.html\`.
- \`tests/stage5-manual-sync.test.mjs\`: 7 mocked integration tests for mount-only behavior, safe compare, backup/ownership gates, successful non-destructive cloud-to-device download, upload-only INSERT, stale local state, account switching/rerendering and public-host denial.
- \`tests/stage5-account-panel.test.mjs\`: updated 6 existing account-integration tests for the new widget module import. Both suites passed isolated V8 tests. **Actual Chrome test pending.**

**Functional scope**
- The user explicitly chooses **Compare this device with my cloud**. It shows local and cloud counts, eligible uploads/downloads, already-synced rows, unsupported test records, and conflicts/possible duplicates.
- Completed compatible sessions may be individually selected; there is a **Select eligible cloud workouts** accessibility shortcut to avoid the old disabled-checkbox issue. Limit 25 changes per operation.
- Requires **Download full local safety backup**, independent acknowledgement that the file is saved, independent acknowledgement that this device's fictional workouts belong to the current account, and a confirmation describing exact upload/download counts.
- On consent it validates the current server-side \`auth.getUser()\`, checks the exact original localStorage snapshot, re-fetches full RLS-scoped cloud data, and re-runs \`planSelectedSync\` before writing anything.
- Cloud writes are **plain INSERT only**. Existing cloud IDs are never updated/deleted. Downloads add only verified missing sessions into cloned local data and preserve nutrition, program, favorites, schedule, running and existing workout records.
- **Critical in-memory safeguard:** unlike Stage 4's separate-page dashboard, a download in the same \`index.html\` page must reload Lift Journal immediately following a successful localStorage write; otherwise its pre-sync \`data\` object could overwrite downloaded sessions on the next save. The confirmation warns about the reload. Upload-only operations report success without reloading.
- If the user switches accounts, leaves Settings, or the Settings DOM is rerendered during an operation, the pending compare/selection is invalidated or further data writes are refused. Local changes since comparison abort sync.
- Only available at \`127.0.0.1\` and \`localhost\`. No public signup; no background/automatic sync or offline queue; no cloud edit/delete/overwrite; not a full multi-device conflict resolution system.
- Data downloaded to the test device is currently owned by browser local storage, **not protected by an enforced per-account local data namespace**. Explicit account-ownership confirmation is required. Do not use real multi-user devices until local-account isolation/ownership controls are designed and verified.

**Owner browser validation (one step at a time)**
1. Obtain a **new ZIP** of branch \`feature/lift-journal-2-auth-preview\`. Check the extracted inner folder has \`index.html\`, \`stage5-account-panel.mjs\`, \`stage5-manual-sync.mjs\`, \`auth-config.js\`, \`cloud-sync-core.mjs\`, \`cloud-workout-download.mjs\`, and \`cloud-safe-merge.mjs\`.
2. Stop old Python server on port **8006** with Ctrl+C. From that **new folder** start the same port: \`python -m http.server 8006 --bind 127.0.0.1\`.
3. Open \`http://127.0.0.1:8006/index.html\` in the same Chrome profile. Check History retains both fictional workouts (October 24 and 25, 2026) before any further action.
4. In Settings → Account & Cloud Sync, sign in to existing Test User \`stef_world@hotmail.com\` if still signed out from Stage 5A. Verify email/profile, then see **Manual Workout Sync** panel *inside Settings*, below account details.
5. Click **Compare this device with my cloud**, expect 2 local, 5 cloud, 0 eligible uploads, 0 eligible downloads, 0 conflicts. Neither device nor cloud should change. Send screenshot of this embedded UI.
6. For an actual embedded-download test, prepare a third disposable browser origin (e.g. port **8008**) from the **same corrected folder**, restore the fictional one-workout destination backup there, then sign in and compare (1 local, 5 cloud, 1 safe download). Select only the missing October 25 workout. Download and check the full safety backup; check both acknowledgements, approve the preview of 0 uploads/1 download. On success **Lift Journal must reload automatically**, then History must show both records. Recompare and verify 0 safe downloads/conflicts. Do not use actual user data.
7. Test sign-out while a comparison is shown, switch to another test account and ensure the previous account's cloud list and selected workouts aren't retained. Verify signing out doesn't delete locally saved workout data. Do not switch devices or accounts with real data yet.
8. Stop test server as desired; browser storage under these origins persists unless Chrome site data is cleared.

**Release gate**: Keep PR #11 a DRAFT and unmerged. The public GitHub Pages app and service worker must not change. Additional release work: RLS/account lifecycle/security audit, privacy policies and account data deletion/export, server-side signup/SMTP gating, secure on-device per-account data isolation, offline queue/retry and multi-device edit conflict management.


## Stage 6A — Persistent device-to-test-account sync ownership guard (DRAFT; OWNER CHROME TEST PENDING)

**Reason:** The Stage 5B app retains the existing shared browser-storage key \`lift-journal-v1\`. A Supabase login alone does not identify who originally recorded those local workouts. Previously, an account switch could cause someone to upload the browser's existing workouts into the WRONG cloud account after clicking the regular safety acknowledgements. RLS alone does not prevent that voluntary misattribution.

**New Stage 6A behavior**
- Adds \`stage6-device-owner.mjs\`, with a strict versioned ownership marker \`lift-journal-sync-device-owner-v1\` stored separately from \`lift-journal-v1\`. Marker includes the **verified Supabase user ID**, time first linked, last reviewed time and state \`active\` or \`review-required\`. No email/password or workout body is stored in the marker.
- Every origin starts **UNCLAIMED**, including older test installations on ports 8006, 8007 and 8008. **Manual sync is DISABLED until the current signed-in test account explicitly links the local history.**
- In Settings → Account & Cloud Sync → **Device ownership for cloud sync**, linking requires: server-verified existing Test User login; the full native JSON **safety backup requested** and saved; explicit checkbox that these fictional local workouts belong to the signed-in test account; final confirmation showing account email and number of workouts; rechecking both the exact local \`lift-journal-v1\` bytes and ownership marker for changes before persisting the link. Linking saves only the small marker, never uploads/changes any workout, favorites, nutrition, schedule, or program.
- **Different account:** owner marker persists through logout and page reload. Logging in to another account on the same origin shows **SYNC LOCKED**. Ownership cannot be reassigned through the app. Sign in to the original account or use a different browser profile/origin. The app does not silently import or sync that shared history.
- **Backup import:** the existing destructive native "Import Backup" action now places an active ownership marker into \`review-required\` status **BEFORE** replacing local data. Sync remains locked until the **same verified account** downloads a new safety backup and expressly reapproves. A damaged marker or inability to write the suspension blocks the import. Canceled imports do not suspend ownership. If the actual app save later fails, the marker conservatively remains suspended, without deleting workout data.
- **Damaged marker:** invalid JSON, unexpected version or missing fields always fail closed: no silent reset, rebind, compare or sync. This is a safety guard, not an encrypted or tamper-proof device identifier.
- **Both sync entrypoints protected:** \`stage5-manual-sync.mjs\` in app Settings and the standalone fallback \`cloud-sync-preview.mjs\` import the same ownership guard. Comparison is disabled if unclaimed/wrong account/review-required/damaged. Ownership is rechecked at manual apply, revalidation, each cloud INSERT, and before any local history save. Changes in another tab invalidate pending work.
- **No automatic/background uploads, downloads, new user registrations or cloud deletes/updates.** The existing data model and cloud RLS remain unchanged.

**What this does NOT protect:** All sessions/nutrition/favorites still live under one same-origin \`lift-journal-v1\` localStorage key. Signing out **does not hide or encrypt** them; other people using the same browser profile can still open Lift Journal and view/edit local data, manually export backups, or use developer tools to alter localStorage. A locally editable marker cannot serve as a true security boundary. Stage 6A reduces accidental cross-account cloud attribution and is **not yet suitable for actual multi-user shared devices**. Stage 6B must design real per-account local storage compartments or authenticated encryption, protect guest/legacy migration and owner switching, and verify recovery without data loss before production rollout.

**Files/tests**
- \`stage6-device-owner.mjs\` — pure owner record parsing, fail-closed read, one-owner linking and import suspension.
- \`tests/stage6-device-owner.test.mjs\` — 12 tests for unclaimed, persistence, wrong account, stale bytes, races, review-required and corruption.
- \`tests/stage6-owner-ui.test.mjs\` — 6 mocked UI/import tests for backup-gated linking, wrong-account lock and import suspension.
- \`stage5-account-panel.mjs\`, \`index.html\` — explicit owner-link UI, native import lock, account switch refresh.
- \`stage5-manual-sync.mjs\` + \`cloud-sync-preview.mjs\` — both manual sync flows fail closed without the same matching active owner.
- \`tests/stage5-manual-sync.test.mjs\` — expanded to 12 mocked tests, including cross-account and suspended marker refusal.
- \`tests/cloud-sync-preview-controls.test.mjs\` — expanded to 4 tests including fallback lock.
- \`tests/stage5-account-panel.test.mjs\` — retains 6 account/settings regression tests.
- 40 individual source/fixture-based test cases passed in isolated JavaScript/V8 harnesses as of Stage 6A. These are mocks and do not substitute for owner Chrome tests.

**Owner first browser test — one step at a time**
1. Download fresh branch ZIP \`feature/lift-journal-2-auth-preview\`; extract a **new** inner directory with \`index.html\`, \`stage5-account-panel.mjs\`, \`stage5-manual-sync.mjs\`, and new \`stage6-device-owner.mjs\`. Do not patch a single JS file.
2. Stop previous Python server at **8006** and restart it from the new directory with \`python -m http.server 8006 --bind 127.0.0.1\`. Use the same Chrome profile and exact origin so the 2 fictional workouts persist.
3. Verify History shows both fictional sessions **before linking**. At Settings → Account & Cloud Sync, sign in as **Test User \`stef_world@hotmail.com\`**. Expect a **Device ownership for cloud sync** panel saying **SYNC LOCKED** and a disabled **Compare** button.
4. Download **full device safety backup**, confirm file exists in Downloads, check ownership acknowledgement, then click **Link this device history to my test account**. The confirmation must show the Test User email and 2 fictional workouts; agree. Linking must NOT alter workout count, favorites, nutrition, or cloud count.
5. With device linked, Compare should work. Expect 2 local workouts, 5 cloud rows, 0 eligible uploads/downloads and 0 conflicts. Any running uploads/downloads still require their separate safety backup and consent.
6. Sign out in Settings. Reopen History and verify both workouts remain. Sign into **Admin test account** on **the SAME port 8006**, without changing Chrome profile. Expect **SYNC LOCKED / linked to another account** and the Compare/sync controls DISABLED. Do not upload anything to Admin; Admin cloud data should not be read by the sync panel. The 2 local workouts may remain visible — known Stage 6A limitation.
7. Sign out of Admin and sign in again as Test User; the original owner guard should permit Compare without new linking.
8. Optional later isolated test: create another disposable origin or keep another verified test backup, import a native backup while bound, verify \`review-required\` and sync locked until same owner performs a fresh backup+reapproval. Do not do this on production or real data.

**Release gate:** Keep PR #11 a DRAFT; no merge, no GitHub Pages deploy or public sign-up. Stage 6A is a safety test with fictional data only; further shared-device privacy, account separation, conflict handling, offline reliability, policies, account deletion and recovery are required.
