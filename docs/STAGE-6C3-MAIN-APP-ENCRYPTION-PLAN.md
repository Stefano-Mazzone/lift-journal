# Stage 6C3 — Safe integration architecture for the regular Lift Journal app

**Status:** Design only; not implemented or released. Follows successful scoped owner Chrome Stage 6C2A/6C2B browser tests with fictional data. Keep PR #11 **draft and unmerged**.

## Confirmed owner outcome

The Stage 6C2B page was manually locked; screenshot displayed `Private workout test manually locked.`, no workout titles, and no decrypted data summary. Previously the owner verified after Admin switching that the linked Test User reopened the same Stage 6C2B encrypted compartment with **revision 3 / 3 fictional workouts / 3 favorites / 1 saved meal**. The owner downloaded a revision-3 encrypted backup (not independently inspected and restore not tested).

## Why not simply replace localStorage in index.html?

The current `index.html` is a standalone ~4,217-line HTML/JS app that immediately initializes its mutable `data` object from plaintext `localStorage['lift-journal-v1']` and renders the full app without first verifying account ownership. Its synchronous `save()` does `localStorage.setItem(KEY, JSON.stringify(data))`. Workout creation rolls back if `save()` returns false, but many workout-set edits, settings updates, calendar operations, nutrition changes and other handlers mutate in-memory state and call synchronous `save()` without awaiting an asynchronous commit. Its native import replaces the original local state after user confirmation. Changing only the storage key or patching `save()` to fire-and-forget encrypted writes would create data-loss, stale-write and cross-account disclosure risks.

The Stage 6C2A/6C2B encrypted compartments instead use a server-verified owner check, passphrase and copy-on-write encrypted revision with final head commit, but this is a **separate experimental copy** and not a complete account-private app. Stage 6C1 read-only encrypted recovery copy is also distinct from v2.

## Required design decisions before modifying the regular app

1. **Startup gate:** Before any normal page markup, workout data read, or feature initialization, verify the signed-in linked Test User. If signed out or in an unlinked account, only show a privacy/login screen; do not read `lift-journal-v1` or render workout history. The user must explicitly unlock a v2 encrypted compartment with a separate passphrase. A verified account alone is not sufficient to expose decrypted content.
2. **Private state adapter:** Load and validate a complete app-compatible model into ephemeral in-memory state only after unlock, and route all reads and mutations through an explicit owner-bound state service. Preserve original functionality and unrecognized valid app fields, not only workouts and favorites. No decrypted data persisted into localStorage, browser caches, URL parameters, logging or remote endpoints.
3. **Durable edits:** Convert synchronous save assumptions to an ordered, awaitable transaction API. Each user action creates a draft copy, verifies the account and current encrypted revision, serializes with Web Locks/validated fallback, commits encrypted slot and head, reads back, then acknowledges success. On rejection, restore last committed state and show a clearly actionable error. Do not claim changes saved when pending/failed. Handle set-by-set editing carefully, including mobile/closing tab.
4. **Concurrency:** Explicitly define a sole writer/queue per tab, reject stale revisions across tabs, and show a safe re-open/review path on conflicts without silently overriding data. Validate cross-account signout/token refresh events and never let a result from a previous account update the current UI.
5. **Security and usable locking:** Immediately hide data on sign-out, verified owner change, explicit lock or tab hidden; clear pending drafts, passphrase strings and private DOM text. For future normal-app UX, reconsider the prototype's window-`blur` lock because switching to ChatGPT to send a screenshot forces repeated re-entry. Only relax it after testing tab-hidden, window switching, timeout and background security with realistic use. Never store the passphrase for convenience.
6. **Migration rehearsal:** Explicitly opt in; back up original `lift-journal-v1`, Stage 6B encrypted copy and v2 encrypted copy; preview counts/details and validate complete model; encrypt and independently re-open a NEW destination; confirm parity before offering a cutover. Never delete/overwrite plaintext data during testing, and never silently link one account's old local state to another account.
7. **Recovery and backup:** Build and test v2 JSON import/restore before relying on v2 for real data. Validate owner/account identity, structure, encrypted integrity, wrong passphrase refusal, replay/rollback rules, partial writes, storage full, browser restart, corrupted head/slot, and recovery from multiple revisions. Export before any migration. Provide explicit safety stops when integrity cannot be verified.
8. **Offline and mobile:** Determine and communicate availability of verified offline unlock, because the prototype currently depends on server-verified account checks. Test Chrome PWA Android install and offline startup separately; no automatic cloud sync or signup without their own security release gates.
9. **Release:** Stage 6C3 development must occur in a separate opt-in local test shell/feature flag first. Keep production untouched, do not auto-migrate, and do not merge PR #11 before owner acceptance of all critical safety scenarios.

## Proposed implementation sequence

- **6C3A — Read-only private app shell (no saves):** Extract or adapt a safe read-only portion of the existing History and Movement displays behind a verified account/unlock gate, using only v2 compartment data. Ensure original `index.html` and the legacy key remain unchanged. Validate Admin block, lock-on-signout, correct Test User re-entry, and browser refresh.
- **6C3B — Write adapter rehearsal:** Add one carefully isolated workout mutation (for example changing a fictional set's reps) and test ordered durable commit, wrong passphrase, failed storage, stale revision, account switch, and independent readback.
- **6C3C — Expanded original app integration:** Gradually port or refactor Plan, Train, History, Movements, Calories and other modules behind the owner-bound private state adapter, auditing each mutating path for asynchronous durability.
- **6C3D — Backup/restore and opt-in migration rehearsal:** Validate encrypted restore, snapshots, data parity, source retention and all failure paths.
- **6C3E — User acceptance:** Test same-profile multi-account behavior, Android install, offline behavior, keyboard navigation, tab changes and repeated workout edits before any rollout decision.

## Stage 6C2B remaining negative/failure tests

- Wrong-passphrase save refusal and unchanged revision: **passed in owner's Chrome**.
- Admin account denied Stage 6C2B access, followed by successful linked Test User recovery: **passed in owner's Chrome**.
- Tab/window blur lock and sign-out mock tests: **passed in isolated UI mocks**; full owner browser coverage still incomplete.
- Simultaneous/stale writes across two tabs: **not yet owner-tested**.
- Quota exceeded or interrupted write, damaged head/slot, and v2 restore: **not yet owner-tested**.

**Non-negotiable:** No real workout data or changes to original `index.html` until a safe read-only architecture proves account-specific privacy and the restore path is tested.
