import { createSettingsManualSync } from "./stage5-manual-sync.mjs";
import { makeSafetyBackup } from "./cloud-sync-core.mjs";
import {
  DEVICE_OWNER_KEY, DEVICE_DATA_KEY, deviceOwnerStatus, bindDeviceOwner
} from "./stage6-device-owner.mjs";

// Lift Journal 2.0 — Stage 5B: verified test accounts with opt-in
// manual workout sync embedded directly in the draft Settings UI.
// Authentication in this file never reads or writes workout storage.
// The separately imported manual-sync module writes ONLY after explicit
// comparison, safety-backup and account-owner confirmations.
// Sign-in alone NEVER moves or attributes local workouts to a cloud account.
// Active only on disposable 127.0.0.1 / localhost test origins.
const config = window.LIFT_JOURNAL_AUTH;
const testOrigin = location.hostname === "127.0.0.1" || location.hostname === "localhost";
const AUTH_KEY = "lift-journal-auth-test-v1";
const $ = id => document.getElementById(id);

let client = null;
let currentUser = null;
let displayName = "";
let busy = false;
let initialized = false;
let refreshGeneration = 0;
let ownerBackupSnapshot = null;
let statusMessage = testOrigin ? "Checking your existing test account…" :
  "This experimental account integration is only enabled in the localhost test version.";
let statusKind = "info";
const state = () => ({ currentUser, displayName, busy, initialized, statusMessage, statusKind, testOrigin });
const embeddedSync = createSettingsManualSync({
  getClient: () => client,
  getUser: () => currentUser
});

function setStatus(message, kind = "info") {
  statusMessage = message;
  statusKind = kind;
  renderAccount();
}

function renderAccount() {
  const panel = $("lj-account-panel");
  if (!panel) return;
  // The main app replaces Settings markup on re-render. Never store element
  // references between renders and never insert account data as HTML.
  const login = $("lj-account-login");
  const signed = $("lj-account-signed");
  const status = $("lj-account-status");
  const email = $("lj-account-email-display");
  const name = $("lj-account-name-display");
  const signIn = $("lj-account-signin");
  const signOut = $("lj-account-signout");
  const sync = $("lj-account-open-sync");
  if (!login || !signed || !status || !email || !name || !signIn || !signOut || !sync) return;

  const authenticated = !!currentUser && testOrigin;
  login.hidden = authenticated || !testOrigin;
  signed.hidden = !authenticated;
  status.textContent = statusMessage;
  status.dataset.kind = statusKind;
  email.textContent = authenticated ? currentUser.email || "Verified test account" : "";
  name.textContent = authenticated ? displayName || "No display name saved" : "";
  const canSignIn = initialized && !busy && !authenticated;
  signIn.disabled = !canSignIn;
  signOut.disabled = busy;
  // The full-page Stage 4 link remains available as a fallback; manual sync
  // now also renders directly inside the signed-in Settings section.
  sync.hidden = !authenticated;
  const ownerPanel = $("lj-device-owner-panel");
  const ownerMessage = $("lj-device-owner-message");
  const ownerActions = $("lj-device-owner-actions");
  const ownerBackup = $("lj-owner-backup");
  const ownerAcknowledge = $("lj-owner-ack");
  const ownerClaim = $("lj-owner-claim");
  if (ownerPanel && ownerMessage && ownerActions && ownerBackup && ownerAcknowledge && ownerClaim) {
    ownerPanel.hidden = !authenticated;
    const ownership = authenticated ? deviceOwnerStatus(localStorage, currentUser.id) : { status: "signed-out" };
    const canLink = ownership.status === "unclaimed" || ownership.status === "review-required";
    ownerActions.hidden = !authenticated || !canLink;
    ownerMessage.dataset.kind = ownership.status === "linked" ? "success" : "info";
    ownerMessage.textContent = ({
      linked: "Linked for manual sync to this verified test account. The link stays after sign-out. Workout data is still visible to other users of this browser profile.",
      unclaimed: "Sync is LOCKED. This browser history has not been linked to any cloud account. Save a full backup and confirm ownership before enabling synchronization.",
      "review-required": "Sync is LOCKED. A local backup import replaced the data since linking. The SAME account must review a new safety backup and reapprove ownership.",
      "other-account": "Sync is LOCKED. This browser history is linked to ANOTHER account. Sign in to its original account or use a separate Chrome profile. Local workouts are not private on this shared browser.",
      damaged: "Sync is LOCKED. The device ownership record is invalid or storage is unavailable. Do not reset storage or sync without recovering a backup."
    })[ownership.status] || "Cloud sync is locked until account ownership is verified.";
    if (!canLink) ownerBackupSnapshot = null;
    const fresh = !!ownerBackupSnapshot && currentUser?.id === ownerBackupSnapshot.userId &&
      !busy && canLink;
    ownerBackup.disabled = busy || !canLink;
    ownerAcknowledge.disabled = !fresh;
    ownerClaim.disabled = !fresh || !ownerAcknowledge.checked;
    ownerClaim.textContent = ownership.status === "review-required" ?
      "Reapprove this account for sync" : "Link this device history to my test account";
  }
  embeddedSync.mount();
}

function isAccountPanel(el) {
  return !!el && !!el.closest?.("#lj-account-panel");
}

// Delegated events survive all the app's Settings re-renders. A navigation
// resets ownership backup consent; a stale form cannot silently authorize sync.
document.addEventListener("lift-journal:settings-mounted", () => {
  ownerBackupSnapshot = null;
  renderAccount();
});
document.addEventListener("lift-journal:device-owner-review", () => {
  ownerBackupSnapshot = null;
  embeddedSync.reset();
  renderAccount();
});

function saveOwnerBackup(json, filename) {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

document.addEventListener("change", event => {
  if (event.target?.id === "lj-owner-ack") renderAccount();
});

document.addEventListener("click", async event => {
  const button = event.target?.closest?.("#lj-owner-backup, #lj-owner-claim");
  if (!button || !isAccountPanel(button) || !testOrigin || !client || !currentUser || busy) return;
  const ownership = deviceOwnerStatus(localStorage, currentUser.id);
  if (!["unclaimed", "review-required"].includes(ownership.status)) return;
  if (button.id === "lj-owner-backup") {
    try {
      const raw = localStorage.getItem(DEVICE_DATA_KEY);
      if (!raw) throw new Error("No device workout history to protect.");
      const at = new Date().toISOString();
      const json = makeSafetyBackup(JSON.parse(raw), at);
      saveOwnerBackup(json, "lift-journal-ACCOUNT-LINK-SAFETY-BACKUP-" + at.slice(0, 10) + ".json");
      ownerBackupSnapshot = {
        userId: currentUser.id,
        raw,
        ownerRaw: localStorage.getItem(DEVICE_OWNER_KEY)
      };
      const ack = $("lj-owner-ack");
      if (ack) ack.checked = false;
      renderAccount();
      const message = $("lj-device-owner-message");
      if (message) message.textContent =
        "Backup download requested. Verify the JSON file exists before checking the acknowledgement.";
    } catch (error) {
      ownerBackupSnapshot = null;
      renderAccount();
      const message = $("lj-device-owner-message");
      if (message) message.textContent = "Cannot create safety backup: " + (error?.message || "Unknown error");
    }
    return;
  }
  const snapshot = ownerBackupSnapshot;
  if (!snapshot || !($("lj-owner-ack")?.checked) || snapshot.userId !== currentUser.id ||
      localStorage.getItem(DEVICE_DATA_KEY) !== snapshot.raw ||
      localStorage.getItem(DEVICE_OWNER_KEY) !== snapshot.ownerRaw) {
    ownerBackupSnapshot = null;
    renderAccount();
    const message = $("lj-device-owner-message");
    if (message) message.textContent =
      "Ownership or workouts changed after backup. Restart the safety backup and account approval.";
    return;
  }
  const email = currentUser.email || "this account";
  const quantity = Object.keys(JSON.parse(snapshot.raw).sessions || {}).length;
  if (!window.confirm(
    "LINK THIS TEST BROWSER HISTORY TO ONE ACCOUNT\n\n" +
    "Verified email: " + email + "\nWorkout records: " + quantity +
    "\n\nOnly this account will be permitted to manually synchronize these local workouts. " +
    "This does not encrypt them or hide them from other browser users. " +
    "Changing accounts will NOT reassign this device.\n\n" +
    "You confirmed your complete safety backup was downloaded. Continue?"
  )) return;
  busy = true;
  renderAccount();
  try {
    const expectedId = snapshot.userId;
    const { data: { user: verified }, error } = await client.auth.getUser();
    if (error || !verified || verified.id !== expectedId ||
        currentUser?.id !== expectedId || !testOrigin) {
      throw new Error("Signed-in account could not be verified or changed.");
    }
    bindDeviceOwner({
      storage: localStorage,
      verifiedId: expectedId,
      expectedData: snapshot.raw,
      expectedOwnerRaw: snapshot.ownerRaw,
      now: new Date().toISOString()
    });
    ownerBackupSnapshot = null;
    embeddedSync.reset();
    setStatus("Device sync ownership saved for this test account. No workouts were uploaded.", "success");
  } catch (error) {
    ownerBackupSnapshot = null;
    renderAccount();
    const message = $("lj-device-owner-message");
    if (message) message.textContent =
      "Device linking was stopped: " + (error?.message || "Unknown error");
  } finally {
    busy = false;
    renderAccount();
  }
});

document.addEventListener("submit", async event => {
  const form = event.target;
  if (form?.id !== "lj-account-login" || !isAccountPanel(form)) return;
  event.preventDefault();
  if (!testOrigin || !client || !initialized || busy || currentUser ||
      !config?.testLoginEnabled || config.signupEnabled) return;
  const email = form.querySelector("#lj-account-email")?.value?.trim();
  const passwordInput = form.querySelector("#lj-account-password");
  const password = passwordInput?.value;
  if (!email || !password) return;
  busy = true;
  setStatus("Signing in to your existing test account…");
  try {
    const { error } = await client.auth.signInWithPassword({ email, password });
    // Never keep passwords in an input after submitting.
    if (passwordInput?.isConnected) passwordInput.value = "";
    if (error) throw error;
    await refreshAccount();
    if (currentUser) setStatus("Test account verified. Workouts remain stored on this device until you explicitly sync.", "success");
  } catch (error) {
    if (passwordInput?.isConnected) passwordInput.value = "";
    setStatus("Sign-in failed: " + (error?.message || "Unable to connect"), "error");
  } finally {
    busy = false;
    renderAccount();
  }
});

document.addEventListener("click", async event => {
  const target = event.target?.closest?.("#lj-account-signout");
  if (!target || !isAccountPanel(target) || busy || !testOrigin || !client) return;
  busy = true;
  ownerBackupSnapshot = null;
  embeddedSync.reset();
  setStatus("Signing out of this test account…");
  try {
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw error;
    ++refreshGeneration;
    currentUser = null;
    displayName = "";
    setStatus("Signed out. All workouts and nutrition on this device are unchanged.", "success");
  } catch (error) {
    setStatus("Sign-out failed: " + (error?.message || "Unable to connect"), "error");
    await refreshAccount();
  } finally {
    busy = false;
    renderAccount();
  }
});

async function refreshAccount() {
  if (!client || !testOrigin) return;
  const generation = ++refreshGeneration;
  try {
    const { data: { session }, error: sessionError } = await client.auth.getSession();
    if (generation !== refreshGeneration) return;
    if (sessionError) throw sessionError;
    if (!session) {
      ownerBackupSnapshot = null;
      currentUser = null;
      displayName = "";
      setStatus("Not signed in. Your current workouts stay on this browser.");
      return;
    }
    // Never trust getSession's locally cached identity alone.
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (generation !== refreshGeneration) return;
    if (userError || !user) throw userError || new Error("Account verification failed.");
    if (currentUser?.id !== user.id) {
      ownerBackupSnapshot = null;
      embeddedSync.reset();
    }
    currentUser = user;
    displayName = "";
    setStatus("Test account verified. Workouts are still local; automatic synchronization is OFF.", "success");
    // Optional private profile; do not fail sign-in if the profile is missing.
    const { data: profile, error: profileError } = await client.from("profiles")
      .select("display_name").eq("id", user.id).maybeSingle();
    if (generation !== refreshGeneration || currentUser?.id !== user.id) return;
    if (!profileError && profile) {
      displayName = typeof profile.display_name === "string" ?
        profile.display_name.slice(0, 60) : "";
      renderAccount();
    }
  } catch (error) {
    if (generation !== refreshGeneration) return;
    ownerBackupSnapshot = null;
    embeddedSync.reset();
    currentUser = null;
    displayName = "";
    setStatus("Account could not be verified: " + (error?.message || "Network unavailable") +
      ". Device workouts are still available offline.", "error");
  }
}

window.addEventListener("storage", event => {
  // Keep the displayed account current when the separate manual-sync tab
  // signs in/out. Never react to the workout-data storage key.
  if (event.key === DEVICE_OWNER_KEY || event.key === DEVICE_DATA_KEY || event.key === null) {
    ownerBackupSnapshot = null;
    embeddedSync.reset();
    renderAccount();
  }
  if (event.key === AUTH_KEY || event.key === null) void refreshAccount();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && client && !busy) void refreshAccount();
});

async function initialize() {
  if (!testOrigin) {
    renderAccount();
    return;
  }
  if (!config?.url || !config.publishableKey || !config.testLoginEnabled || config.signupEnabled) {
    setStatus("Test account configuration is unavailable. Public registration must remain disabled.", "error");
    return;
  }
  try {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm");
    client = createClient(config.url, config.publishableKey, {
      auth: {
        storageKey: AUTH_KEY,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: "pkce"
      }
    });
    initialized = true;
    client.auth.onAuthStateChange(() => {
      // Supabase discourages synchronous async auth calls in its callback.
      window.setTimeout(() => { if (!busy) void refreshAccount(); }, 0);
    });
    await refreshAccount();
  } catch (error) {
    setStatus("Test account connection unavailable: " + (error?.message || "Network error") +
      ". Lift Journal still works offline.", "error");
  }
}
renderAccount();
void initialize();
