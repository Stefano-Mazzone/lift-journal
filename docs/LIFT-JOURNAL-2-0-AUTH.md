# Lift Journal 2.0 — Accounts and Cloud Sync (Phase 1)

## Current draft scope (PR #11)

This branch adds an **isolated** account preview at auth-preview.html, connected to the Lift Journal Supabase project using its **public publishable** API key, with the SDK version pinned.

- auth-config.js — public project URL and publishable key; signupEnabled is false.
- auth-ui.mjs — test-only password sign-in, session verification, sign-out, private profile lookup, and explicit profile creation/editing.
- auth-preview.html — responsive UI with disabled sign-up fields and an independent Supabase auth status.
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
- Cloud workout storage/sync, messaging, AI history integration, subscriptions.

Lift Journal launches free first, with optional Pro later.
