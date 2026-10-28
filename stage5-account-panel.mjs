// Lift Journal 2.0 — Stage 5A: embedded ACCOUNT controls in the draft
// Lift Journal Settings screen. Manual workout sync stays on sync-preview.html.
// IMPORTANT: this file NEVER reads/writes lift-journal-v1 workout storage.
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
let statusMessage = testOrigin ? "Checking your existing test account…" :
  "This experimental account integration is only enabled in the localhost test version.";
let statusKind = "info";
const state = () => ({ currentUser, displayName, busy, initialized, statusMessage, statusKind, testOrigin });

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
  // Linking to the separate, proven Stage 4 sync page is the only action.
  // Users still must compare, select workouts, download a backup, and confirm.
  sync.hidden = !authenticated;
}

function isAccountPanel(el) {
  return !!el && !!el.closest?.("#lj-account-panel");
}

// Delegated events survive all the app's Settings re-renders.
document.addEventListener("lift-journal:settings-mounted", renderAccount);
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
      currentUser = null;
      displayName = "";
      setStatus("Not signed in. Your current workouts stay on this browser.");
      return;
    }
    // Never trust getSession's locally cached identity alone.
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (generation !== refreshGeneration) return;
    if (userError || !user) throw userError || new Error("Account verification failed.");
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
    currentUser = null;
    displayName = "";
    setStatus("Account could not be verified: " + (error?.message || "Network unavailable") +
      ". Device workouts are still available offline.", "error");
  }
}

window.addEventListener("storage", event => {
  // Keep the displayed account current when the separate manual-sync tab
  // signs in/out. Never react to the workout-data storage key.
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
