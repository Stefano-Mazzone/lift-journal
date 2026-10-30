// Lift Journal 2.0 — Stage 4: manual, opt-in sync in a LOOPBACK-ONLY test origin.
// Requires same http://127.0.0.1:PORT origin as the isolated index.html workout app.
// This module does not run on public GitHub Pages. Never clears localStorage.
// Stage 4 pilot only: no automatic sync, no offline queue, no conflict overwrites.
import { fetchCloudWorkouts } from "./cloud-workout-download.mjs";
import { buildSyncPlan, makeSafetyBackup, planSelectedSync } from "./cloud-sync-core.mjs";
import { DEVICE_OWNER_KEY, isDeviceOwnedBy } from "./stage6-device-owner.mjs";

const KEY = "lift-journal-v1";
const AUTH_KEY = "lift-journal-auth-test-v1";
const $ = id => document.getElementById(id);
const settings = window.LIFT_JOURNAL_AUTH;
const localOnly = location.hostname === "127.0.0.1" || location.hostname === "localhost";
const MAX_CHANGES = 25;
let client = null;
let user = null;
let snapshot = null;
let busy = false;
let sequence = 0;
let backupRequested = false;
const selectedUploads = new Set();
const selectedDownloads = new Set();
const ownerLinked = () => !!user && localOnly && isDeviceOwnedBy(localStorage, user.id);

const elements = {
  status: $("sync-status"),
  login: $("sync-login"),
  email: $("sync-email"),
  password: $("sync-password"),
  loginButton: $("sync-login-submit"),
  account: $("sync-account"),
  accountEmail: $("sync-account-email"),
  signOut: $("sync-signout"),
  localOrigin: $("sync-origin"),
  compare: $("sync-compare"),
  localCount: $("sync-local-count"),
  cloudCount: $("sync-cloud-count"),
  uploadCount: $("sync-upload-count"),
  downloadCount: $("sync-download-count"),
  conflicts: $("sync-conflicts"),
  selection: $("sync-selection"),
  uploadList: $("sync-upload-list"),
  downloadList: $("sync-download-list"),
  backup: $("sync-safety-backup"),
  backupCheck: $("sync-backup-confirmed"),
  ownerCheck: $("sync-owner-confirmed"),
  apply: $("sync-apply")
};

// Accessible alternative to small native checkboxes. Added dynamically so the
// test operator only needs to update this one JS file, not the HTML or app.
const selectMissingCloudButton = document.createElement("button");
selectMissingCloudButton.type = "button";
selectMissingCloudButton.className = "btn";
selectMissingCloudButton.textContent = "Select missing cloud workout(s)";
selectMissingCloudButton.disabled = true;
selectMissingCloudButton.setAttribute("aria-label", "Select eligible missing cloud workouts for manual download");
elements.downloadList.before(selectMissingCloudButton);

function announce(message, kind = "info") {
  elements.status.textContent = message;
  elements.status.dataset.kind = kind;
}
function readRaw() {
  const raw = localStorage.getItem(KEY);
  if (!raw) throw new Error("No device history found at this test address. Restore the fictional Stage 3 backup into index.html on THIS SAME PORT before comparing.");
  if (new Blob([raw]).size > 20 * 1024 * 1024) throw new Error("Device history exceeds 20 MB.");
  return raw;
}
function invalidate() {
  sequence++;
  busy = false;
  snapshot = null;
  backupRequested = false;
  selectedUploads.clear();
  selectedDownloads.clear();
  elements.backupCheck.checked = false;
  elements.ownerCheck.checked = false;
  elements.localCount.textContent = "—";
  elements.cloudCount.textContent = "—";
  elements.uploadCount.textContent = "—";
  elements.downloadCount.textContent = "—";
  elements.conflicts.textContent = "—";
  elements.uploadList.replaceChildren();
  elements.downloadList.replaceChildren();
  elements.selection.textContent = "No changes selected.";
  update();
}
function update() {
  const selectedCount = selectedUploads.size + selectedDownloads.size;
  const safeDownloads = snapshot?.plan.download.filter(entry => entry.status === "eligible") || [];
  selectMissingCloudButton.disabled = busy || !snapshot || !user ||
    snapshot.ownerId !== user.id || !ownerLinked() || safeDownloads.length === 0;
  // Comparison rows are first rendered while busy=true. Recalculate the row
  // controls when the async comparison finishes, rather than leaving safe
  // eligible checkboxes permanently disabled.
  for (const list of [elements.uploadList, elements.downloadList]) {
    for (const checkbox of list.querySelectorAll('input[type="checkbox"]')) {
      checkbox.disabled = busy || !snapshot || !ownerLinked() ||
        checkbox.dataset.eligible !== "true";
      const choices = list === elements.uploadList ? selectedUploads : selectedDownloads;
      checkbox.checked = choices.has(checkbox.dataset.workoutId);
    }
  }
  elements.compare.disabled = busy || !ownerLinked();
  elements.backup.disabled = busy || !snapshot || !ownerLinked();
  elements.backupCheck.disabled = busy || !snapshot || !backupRequested || !ownerLinked();
  elements.ownerCheck.disabled = busy || !snapshot || !ownerLinked();
  elements.apply.disabled = busy || !snapshot || !ownerLinked() || !backupRequested ||
    !elements.backupCheck.checked || !elements.ownerCheck.checked ||
    selectedCount === 0 || selectedCount > MAX_CHANGES;
  elements.apply.textContent = selectedCount ?
    "Sync " + selectedCount + " selected workout change(s)" : "Sync selected workouts";
  elements.selection.textContent = selectedCount > MAX_CHANGES ?
    "Select at most 25 workout changes per test. Current selection: " + selectedCount :
    selectedUploads.size + " upload(s) + " + selectedDownloads.size + " download(s) selected.";
}
function showAccount(nextUser) {
  const oldId = user?.id || null;
  user = nextUser;
  elements.login.hidden = !!user;
  elements.account.hidden = !user;
  elements.accountEmail.textContent = user?.email || "";
  if (oldId !== (user?.id || null)) {
    invalidate();
    announce(user ? (ownerLinked() ?
      "Signed in. This browser is linked to your test account; manual sync can be compared." :
      "SYNC LOCKED: Open Lift Journal Settings to download a safety backup and link this browser history to this test account.") :
      "Sign in with an existing authorized test account.");
  }
}
async function verifyUser(expectedId) {
  if (!client) return false;
  const { data: { user: verified }, error } = await client.auth.getUser();
  return !error && verified?.id === expectedId && user?.id === expectedId &&
    ownerLinked();
}
async function refreshUser() {
  if (!client) return;
  try {
    const { data: { session }, error: sessionError } = await client.auth.getSession();
    if (sessionError || !session) { showAccount(null); return; }
    const { data: { user: verified }, error } = await client.auth.getUser();
    showAccount(error ? null : verified);
  } catch {
    showAccount(null);
    announce("Could not validate the test account. Check your connection.", "error");
  }
}
function createRow(entry, destination) {
  const li = document.createElement("li");
  const label = document.createElement("label");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.dataset.eligible = entry.status === "eligible" ? "true" : "false";
  checkbox.dataset.workoutId = entry.id;
  checkbox.disabled = busy || entry.status !== "eligible";
  const set = entry.direction === "upload" ? selectedUploads : selectedDownloads;
  checkbox.checked = set.has(entry.id);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) set.add(entry.id); else set.delete(entry.id);
    update();
  });
  const body = document.createElement("span");
  const strong = document.createElement("strong");
  const details = document.createElement("small");
  strong.textContent = entry.name;
  details.textContent = entry.date + " · " + entry.status.toUpperCase() + " — " + entry.reason;
  body.append(strong, details);
  label.append(checkbox, body);
  li.append(label);
  destination.append(li);
}
function render(plan) {
  elements.localCount.textContent = String(plan.localCount);
  elements.cloudCount.textContent = String(plan.cloudCount);
  elements.uploadCount.textContent = String(plan.uploadCounts.eligible || 0);
  elements.downloadCount.textContent = String(plan.downloadCounts.eligible || 0);
  elements.conflicts.textContent = String((plan.uploadCounts.conflict || 0) +
    (plan.downloadCounts.conflict || 0) +
    (plan.uploadCounts["possible-duplicate"] || 0) +
    (plan.downloadCounts["possible-duplicate"] || 0));
  elements.uploadList.replaceChildren();
  elements.downloadList.replaceChildren();
  for (const item of plan.upload) createRow(item, elements.uploadList);
  for (const item of plan.download) createRow(item, elements.downloadList);
  update();
}
selectMissingCloudButton.addEventListener("click", () => {
  if (!snapshot || busy || !user || snapshot.ownerId !== user.id || !ownerLinked()) {
    announce("Cannot select: comparison is outdated or the account is not ready. Compare again.", "error");
    return;
  }
  const eligible = snapshot.plan.download.filter(entry => entry.status === "eligible");
  const freeSlots = MAX_CHANGES - selectedUploads.size - selectedDownloads.size;
  const missing = eligible.filter(entry => !selectedDownloads.has(entry.id));
  if (!missing.length) {
    announce("All eligible cloud workouts are already selected. Review the list below.", "success");
    return;
  }
  if (freeSlots < missing.length) {
    announce("Too many eligible workouts to select at once. Pick up to 25 manually.", "error");
    return;
  }
  for (const entry of missing) selectedDownloads.add(entry.id);
  update();
  announce("Selected " + missing.length + " eligible cloud workout(s). No data has been changed. Save and verify a full backup before syncing.", "success");
});

function browserSave(json, filename) {
  const blob = new Blob([json], { type: "application/json" });
  const link = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = link;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(link), 10000);
}

elements.localOrigin.textContent = location.origin;
elements.login.addEventListener("submit", async e => {
  e.preventDefault();
  if (!client || busy || !localOnly || !settings?.testLoginEnabled) return;
  busy = true;
  elements.loginButton.disabled = true;
  announce("Signing in…");
  try {
    const { error } = await client.auth.signInWithPassword({
      email: elements.email.value.trim(), password: elements.password.value
    });
    elements.password.value = "";
    if (error) throw error;
    await refreshUser();
    announce("Signed in. Cloud sync remains manual and disabled until you preview and confirm.");
  } catch (error) {
    elements.password.value = "";
    announce("Sign-in failed: " + (error?.message || "Network error"), "error");
  } finally {
    busy = false;
    elements.loginButton.disabled = false;
    update();
  }
});

elements.signOut.addEventListener("click", async () => {
  if (!client || busy) return;
  invalidate();
  showAccount(null);
  try { await client.auth.signOut(); }
  catch { announce("Sign-out may not have completed. Please retry.", "error"); }
});

elements.compare.addEventListener("click", async () => {
  if (!user || busy || !client || !ownerLinked()) return;
  const ownerId = user.id;
  invalidate();
  const request = ++sequence;
  busy = true;
  update();
  announce("Reading this test device's saved history and fetching account-scoped cloud workouts…");
  try {
    if (!await verifyUser(ownerId)) throw new Error("Cloud account could not be verified.");
    const raw = readRaw();
    const localData = JSON.parse(raw);
    const cloudRows = await fetchCloudWorkouts(client, ownerId,
      () => request === sequence && user?.id === ownerId && ownerLinked());
    if (request !== sequence || user?.id !== ownerId || !ownerLinked()) return;
    if (readRaw() !== raw) throw new Error("This device's history changed while comparing. Refresh comparison.");
    const plan = buildSyncPlan(localData, cloudRows);
    snapshot = { raw, localData, cloudRows, plan, ownerId };
    // Rendering while busy=true previously left some eligible inputs disabled
    // on Device B. Finish the async phase BEFORE creating any checkbox.
    busy = false;
    render(plan);
    announce("Comparison ready. Choose missing workouts only, download a safety backup, then explicitly approve sync.", "success");
  } catch (error) {
    if (request === sequence) {
      invalidate();
      announce("Comparison stopped: " + (error?.message || "Unknown error"), "error");
    }
  } finally {
    if (request === sequence) {
      busy = false;
      update();
    }
  }
});

elements.backup.addEventListener("click", () => {
  if (!snapshot || busy || !ownerLinked() || user?.id !== snapshot.ownerId) return;
  try {
    if (readRaw() !== snapshot.raw) throw new Error("Device history changed. Compare again.");
    const at = new Date().toISOString();
    browserSave(makeSafetyBackup(snapshot.localData, at),
      "lift-journal-SAFETY-BACKUP-" + at.slice(0, 10) + ".json");
    backupRequested = true;
    announce("Safety backup download requested. Verify the JSON file is saved before checking the acknowledgement.", "success");
    update();
  } catch (error) {
    announce("Safety backup could not be generated: " + error.message, "error");
  }
});

elements.backupCheck.addEventListener("change", update);
elements.ownerCheck.addEventListener("change", update);

elements.apply.addEventListener("click", async () => {
  if (!snapshot || !user || busy || !ownerLinked() || !backupRequested ||
      !elements.backupCheck.checked || !elements.ownerCheck.checked) return;
  const current = snapshot;
  const uploadIds = [...selectedUploads];
  const downloadIds = [...selectedDownloads];
  if (!uploadIds.length && !downloadIds.length) return;
  const owner = current.ownerId;
  if (user.id !== owner) return;
  if (!window.confirm(
    "MANUAL TEST SYNC — DO NOT USE REAL DATA\n\n" +
    "Signed-in account: " + (user.email || "unknown") + "\n" +
    "Upload " + uploadIds.length + " missing completed workout(s) to Supabase.\n" +
    "Add " + downloadIds.length + " missing cloud workout(s) to THIS TEST BROWSER's history.\n\n" +
    "Existing device/cloud workouts will never be overwritten or deleted.\n" +
    "You confirmed that you saved a separate safety backup.\n\n" +
    "Make sure you are using your disposable 127.0.0.1 test origin. Continue?"
  )) return;
  const request = ++sequence;
  busy = true;
  update();
  let uploaded = 0;
  try {
    if (!await verifyUser(owner)) throw new Error("Cloud account changed or expired.");
    if (readRaw() !== current.raw) throw new Error("Device workouts changed after comparison.");
    // Never apply an outdated plan: get a fresh cloud view and recompute both directions.
    const freshCloud = await fetchCloudWorkouts(client, owner,
      () => request === sequence && user?.id === owner && ownerLinked());
    if (request !== sequence || user?.id !== owner || !ownerLinked()) return;
    if (readRaw() !== current.raw) throw new Error("Device history changed during refresh. Compare again.");
    const fresh = planSelectedSync(current.localData, freshCloud, uploadIds, downloadIds);
    for (const item of fresh.upload) {
      if (request !== sequence || !await verifyUser(owner) ||
          readRaw() !== current.raw) {
        throw new Error("Account or device state changed during sync.");
      }
      // Plain INSERT, not UPSERT. Cloud records are never replaced.
      const { error } = await client.from("workouts").insert({
        user_id: owner,
        client_workout_id: item.client_workout_id,
        workout_data: item.workout_data
      });
      if (error) throw new Error("Cloud insert stopped: " + error.message);
      uploaded++;
      announce("Uploaded " + uploaded + " of " + fresh.upload.length + " workout(s)…");
    }

    if (fresh.downloadCount) {
      if (request !== sequence || !await verifyUser(owner) ||
          readRaw() !== current.raw) {
        throw new Error("Device or account state changed; local download was not applied.");
      }
      const nextRaw = JSON.stringify(fresh.nextLocal);
      try {
        localStorage.setItem(KEY, nextRaw);
        if (localStorage.getItem(KEY) !== nextRaw) {
          throw new Error("Could not verify the saved workout history.");
        }
      } catch (storageError) {
        // On a storage-write failure, attempt to return to the exact original snapshot.
        try { if (localStorage.getItem(KEY) !== current.raw) localStorage.setItem(KEY, current.raw); }
        catch { /* Never clear the existing data. */ }
        throw new Error("Local save failed. Check your saved safety backup: " +
          (storageError?.message || "Storage unavailable"));
      }
    }
    const added = fresh.downloadCount;
    invalidate();
    announce("Manual sync finished: " + uploaded + " cloud upload(s), " +
      added + " local addition(s). No existing workouts overwritten. " +
      "Refresh Lift Journal index.html on this SAME PORT to verify. " +
      "Automatic sync remains OFF.", "success");
  } catch (error) {
    invalidate();
    announce("Sync stopped after " + uploaded + " cloud upload(s): " +
      (error?.message || "Unknown error") +
      ". Do not repeat blindly. Compare again; any successful uploads should now be detected. " +
      "Your safety backup remains available.", "error");
  } finally {
    busy = false;
    update();
  }
});

window.addEventListener("storage", e => {
  if (e.key === KEY || e.key === AUTH_KEY || e.key === DEVICE_OWNER_KEY || e.key === null) {
    invalidate();
    announce("Browser storage changed in another tab. Compare again before syncing.", "error");
    if (e.key === AUTH_KEY || e.key === null) void refreshUser();
  }
});

async function initialize() {
  if (!localOnly) {
    elements.login.hidden = true;
    elements.account.hidden = true;
    announce("Stage 4 sync is disabled on public websites. Use a disposable http://127.0.0.1 test origin only.", "error");
    return;
  }
  if (!settings?.url || !settings.publishableKey ||
      !settings.testLoginEnabled || settings.signupEnabled) {
    announce("Stage 4 test account settings are unavailable or public signups enabled. Stopped.", "error");
    return;
  }
  try {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm");
    client = createClient(settings.url, settings.publishableKey, {
      auth: { storageKey: AUTH_KEY, autoRefreshToken: true, persistSession: true,
        detectSessionInUrl: false, flowType: "pkce" }
    });
    client.auth.onAuthStateChange(() => { window.setTimeout(() => { void refreshUser(); }, 0); });
    await refreshUser();
    if (!user) announce("Connected to Supabase. Sign in with an existing test account.");
  } catch (error) {
    announce("Could not connect the test login: " + (error?.message || "Network unavailable"), "error");
  }
}
update();
void initialize();
