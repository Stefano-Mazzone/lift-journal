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
- Automatic or real workout storage/sync from the live Lift Journal app, messaging, AI history integration, subscriptions.

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
