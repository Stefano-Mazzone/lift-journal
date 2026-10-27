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
