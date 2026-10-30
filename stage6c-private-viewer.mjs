// Stage 6C1 standalone encrypted private viewer. READ ONLY.
// Never accesses DEVICE_DATA_KEY or writes a decrypted workout record.
// The legacy index.html app still holds unencrypted data — NOT full privacy.
import { deviceOwnerStatus, DEVICE_OWNER_KEY } from "./stage6-device-owner.mjs";
import { latestVault, vaultLocations } from "./stage6b-vault-recovery.mjs";
import { openVault } from "./stage6b-vault-core.mjs";
import { buildPrivateSnapshot, canOpenPrivateVault } from "./stage6c-private-core.mjs";

const AUTH_KEY = "lift-journal-auth-test-v1";
const allowedHost = ["127.0.0.1", "localhost"].includes(location.hostname);
const config = window.LIFT_JOURNAL_AUTH;
const $ = id => document.getElementById(id);
let client = null, user = null, seq = 0, busy = false, unlocked = false;
let sessionStatus = "Checking test account…";

function status(message, kind = "info") {
  sessionStatus = message;
  const area = $("private-status");
  area.textContent = message;
  area.dataset.kind = kind;
}
function clearPrivateContent() {
  unlocked = false;
  $("private-history").hidden = true;
  $("private-workouts").replaceChildren();
  $("private-favorites").replaceChildren();
  for (const id of ["private-workout-count", "private-favorite-count",
    "private-meal-count", "private-running-count"]) $(id).textContent = "—";
  $("private-passphrase").value = "";
  $("private-show-passphrase").checked = false;
  $("private-passphrase").type = "password";
}
function lock(message = "Private viewer locked. No decrypted workout data was saved.") {
  ++seq;
  busy = false;
  clearPrivateContent();
  status(message);
  render();
}
function owned() {
  try { return !!user?.id && deviceOwnerStatus(localStorage, user.id).status === "linked"; }
  catch { return false; }
}
function render() {
  const authenticated = !!user && allowedHost;
  const linked = authenticated && owned();
  $("private-login").hidden = authenticated || !allowedHost || !client;
  $("private-signed").hidden = !authenticated;
  $("private-user").textContent = authenticated ? user.email || "Verified test account" : "";
  $("private-ownership").textContent = linked ?
    "Device link verified. The encrypted copy remains locked until you enter its separate passphrase." :
    "PRIVATE VIEW LOCKED: This browser's fictional workouts are not linked to the signed-in account.";
  $("private-unlock-section").hidden = !linked;
  if (!linked) clearPrivateContent();
  $("private-signin").disabled = !client || busy || !allowedHost;
  $("private-signout").disabled = busy;
  $("private-open").disabled = !linked || busy;
  $("private-lock").disabled = busy;
  $("private-lock-open").disabled = busy;
  if (client && allowedHost && !authenticated && sessionStatus.startsWith("Checking")) {
    status("Not signed in. Only an existing verified test account can open an encrypted copy.");
  }
}
function showSnapshot(summary) {
  // DOM textContent only: never render workout names through innerHTML.
  $("private-workout-count").textContent = String(summary.workoutCount);
  $("private-favorite-count").textContent = String(summary.favoriteCount);
  $("private-meal-count").textContent = String(summary.mealCount);
  $("private-running-count").textContent = String(summary.runningCount);
  const workouts = $("private-workouts"), favorites = $("private-favorites");
  workouts.replaceChildren();
  favorites.replaceChildren();
  for (const row of summary.sessions) {
    const item = document.createElement("li");
    item.textContent = [row.name, row.date,
      row.exercises.length ? row.exercises.join(", ") : ""].filter(Boolean).join(" · ");
    workouts.append(item);
  }
  for (const movement of summary.favorites) {
    const item = document.createElement("li");
    item.textContent = movement;
    favorites.append(item);
  }
  if (!summary.sessions.length) {
    const item = document.createElement("li");
    item.textContent = "No completed or saved workouts found.";
    workouts.append(item);
  }
  if (!summary.favorites.length) {
    const item = document.createElement("li");
    item.textContent = "No favorite movements found.";
    favorites.append(item);
  }
  $("private-history").hidden = false;
  unlocked = true;
}
async function verifiedUser(expected = null) {
  if (!client) throw Error("Account service unavailable.");
  const { data: { user: serverUser }, error } = await client.auth.getUser();
  if (error || !serverUser?.id || !user?.id ||
    serverUser.id !== user.id || (expected && serverUser.id !== expected)) {
    throw Error("Account identity could not be verified.");
  }
  return serverUser;
}
async function refreshAccount() {
  const ownSeq = ++seq;
  clearPrivateContent();
  status("Verifying signed-in account…");
  try {
    if (!client) throw Error("Account service unavailable.");
    const { data: { session }, error } = await client.auth.getSession();
    if (ownSeq !== seq) return;
    if (error) throw error;
    if (!session) {
      user = null;
      status("Signed out. Private workout history is locked.");
      render();
      return;
    }
    // A stored session token alone is NOT an authenticated identity.
    const { data: { user: serverUser }, error: userError } = await client.auth.getUser();
    if (ownSeq !== seq) return;
    if (userError || !serverUser?.id) throw userError || Error("Account verification failed.");
    user = serverUser;
    status(owned() ?
      "Account verified. Enter your separate passphrase to unlock your encrypted test copy." :
      "Account verified, but this browser's workout history belongs to another account. PRIVATE VIEW LOCKED.",
      owned() ? "success" : "error");
    render();
  } catch (error) {
    if (ownSeq !== seq) return;
    user = null;
    status("Private viewer locked: " + (error?.message || "Account verification unavailable."), "error");
    render();
  }
}
async function unlock(event) {
  event.preventDefault();
  if (busy || !client || !user || !owned()) return;
  const passphrase = $("private-passphrase").value;
  if (!passphrase) return;
  const currentId = user.id;
  const thisSeq = ++seq;
  const ownerRaw = localStorage.getItem(DEVICE_OWNER_KEY);
  const vault = latestVault(localStorage, currentId);
  // Hide the passphrase immediately; do not persist or print it.
  $("private-passphrase").value = "";
  $("private-show-passphrase").checked = false;
  $("private-passphrase").type = "password";
  if (!vault) {
    lock("No encrypted test copy was found for this linked account.");
    return;
  }
  let metadata;
  try { metadata = JSON.parse(vault.raw); }
  catch { lock("Encrypted copy metadata is damaged."); return; }
  if (!canOpenPrivateVault({
    verifiedId: currentId,
    displayedId: user.id,
    linkedToDevice: owned(),
    encryptedOwnerId: metadata?.ownerId
  })) {
    lock("Encrypted copy is locked to a different account.");
    return;
  }
  busy = true;
  clearPrivateContent();
  render();
  status("Verifying account and decrypting the read-only test copy…");
  try {
    await verifiedUser(currentId);
    if (thisSeq !== seq || !owned()) return;
    const decrypted = await openVault({
      userId: currentId, passphrase, encryptedRecord: vault.raw
    });
    const view = buildPrivateSnapshot(decrypted);
    await verifiedUser(currentId);
    if (thisSeq !== seq || document.hidden || !owned() ||
      localStorage.getItem(DEVICE_OWNER_KEY) !== ownerRaw ||
      latestVault(localStorage, currentId)?.raw !== vault.raw) return;
    showSnapshot(view);
    status("Encrypted workout copy unlocked. Read-only private viewer is active.", "success");
  } catch (error) {
    if (thisSeq === seq) {
      clearPrivateContent();
      status("Unlock failed; no information shown or changed: " +
        (error?.message || "Unable to decrypt."), "error");
    }
  } finally {
    if (thisSeq === seq) { busy = false; render(); }
  }
}
$("private-login").addEventListener("submit", async event => {
  event.preventDefault();
  if (!client || busy || user) return;
  const email = $("private-email").value.trim();
  const password = $("private-password").value;
  $("private-password").value = "";
  busy = true; render();
  status("Signing into existing test account…");
  try {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await refreshAccount();
  } catch (error) {
    lock("Sign-in failed: " + (error?.message || "Unknown error."));
  } finally { busy = false; render(); }
});
$("private-signout").addEventListener("click", async () => {
  if (!client || busy) return;
  // Lock UI BEFORE remote/local sign-out starts, even if sign-out fails.
  lock("Signing out. Private workout history is already locked.");
  busy = true; render();
  try {
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw error;
    user = null;
    lock("Signed out. Private workout history is hidden and locked.");
  } catch (error) {
    user = null; // Fail CLOSED; require server re-verification before another unlock.
    lock("Sign-out could not be confirmed. Viewer remains locked: " + (error?.message || "Unknown error."));
  } finally { busy = false; render(); }
});
$("private-unlock-form").addEventListener("submit", event => { void unlock(event); });
for (const buttonId of ["private-lock", "private-lock-open"]) {
  $(buttonId).addEventListener("click", () => lock("Private viewer manually locked."));
}
$("private-show-passphrase").addEventListener("change", event => {
  $("private-passphrase").type = event.target.checked ? "text" : "password";
});
window.addEventListener("storage", event => {
  // Any account, owner or encrypted-vault change in another tab fails closed.
  if (event.key === null || event.key === AUTH_KEY || event.key === DEVICE_OWNER_KEY ||
    event.key?.startsWith("lift-journal-private-v1:")) {
    lock("Account or encrypted storage changed in another tab. Viewer locked.");
    if (event.key === AUTH_KEY || event.key === null) void refreshAccount();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) lock("Viewer locked when this tab became hidden.");
  else if (client) void refreshAccount();
});
window.addEventListener("pagehide", () => lock("Viewer locked on navigation."));
// Do not leave a private viewer unlocked indefinitely when identity expires.
// A failed network verification locks the viewer, it never exposes cached data.
window.setInterval(async () => {
  if (!unlocked || document.hidden || !user) return;
  const currentId = user.id;
  try { await verifiedUser(currentId); }
  catch { lock("Session could not be reverified. Private viewer locked."); }
}, 60000);
async function initialize() {
  if (!allowedHost) {
    status("Private viewer is disabled outside a localhost test address.", "error");
    render(); return;
  }
  if (!config?.url || !config.publishableKey || !config.testLoginEnabled || config.signupEnabled) {
    status("Private test account configuration unavailable. Public signup stays disabled.", "error");
    render(); return;
  }
  try {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm");
    client = createClient(config.url, config.publishableKey, {
      auth: {
        storageKey: AUTH_KEY, autoRefreshToken: true, persistSession: true,
        detectSessionInUrl: false, flowType: "pkce"
      }
    });
    client.auth.onAuthStateChange(() => {
      // Never await Supabase methods inside its auth callback.
      lock("Authentication changed. Private viewer locked.");
      window.setTimeout(() => { if (!busy) void refreshAccount(); }, 0);
    });
    await refreshAccount();
  } catch (error) {
    user = null;
    status("Private viewer account service unavailable: " + (error?.message || "Unknown error."), "error");
    render();
  }
}
render();
void initialize();
