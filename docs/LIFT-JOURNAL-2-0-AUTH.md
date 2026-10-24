# Lift Journal 2.0 — Accounts and Cloud Sync (Phase 1)

## Purpose
Introduce secure optional accounts while retaining the public Lift Journal experience and all existing local user data.

## This draft
- Adds an isolated mobile-friendly account screen preview in auth-preview.html.
- Sign in and create account tabs are visible, but all credential fields and actions are disabled.
- Does not connect to Supabase, create users, send email, or accept passwords.
- Does not modify index.html, localStorage key, service-worker.js, or Cloudflare Worker.

## Requirements before enabling registration
1. Owner supplies only the Supabase publishable key. Never commit secret keys or service-role keys.
2. Implement auth with maintained supabase-js v2. Handle login, logout, sign-up, email confirmation callbacks and password reset.
3. Limit initial testing to authorized team addresses. Built-in Supabase SMTP does not support public signup email; use validated custom SMTP before public registration.
4. Verify all SELECT/INSERT/UPDATE RLS policies with two different authenticated test accounts. Recheck table API exposure and database grants.
5. Keep localStorage lift-journal-v1 unchanged. Make cloud import an opt-in, non-destructive process after data backups, conflict resolution and restore testing.
6. Keep core workout tracking usable without an account, including offline sessions.
7. Merge production changes only after the owner's explicit approval.

Subscription billing and public community features are out of scope. Lift Journal launches free first.
