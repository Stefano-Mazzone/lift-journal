// Lift Journal 2.0 isolated authentication preview.
// No code in this module reads or writes the existing "lift-journal-v1" workout data.
// Authentication is limited to existing TEST accounts; signup is disabled pending SMTP and security review.
const settings = window.LIFT_JOURNAL_AUTH;
const $ = id => document.getElementById(id);

const tabs = ["login", "signup"];
const tabList = $("mode-tabs");
const status = $("auth-status");
const loginFieldset = $("login-fields");
const loginButton = $("login-button");
const signedIn = $("signed-in");
const profileMessage = $("profile-message");
const profileEditor = $("profile-editor");
const displayNameInput = $("display-name");
const createProfileButton = $("create-profile");
const saveProfileButton = $("save-profile");
const accountEmail = $("account-email");
const accountName = $("account-name");
const signupInfo = $("signup-info");

let client = null;
let currentUser = null;
let busy = false;
let initialized = false;

function announce(message, kind = "info") {
  status.textContent = message;
  status.dataset.kind = kind;
}

function chooseTab(mode) {
  if (currentUser) return;
  for (const tab of tabs) {
    const active = tab === mode;
    $("tab-" + tab).setAttribute("aria-selected", String(active));
    $("tab-" + tab).tabIndex = active ? 0 : -1;
    $("panel-" + tab).hidden = !active;
  }
}

for (const mode of tabs) {
  $("tab-" + mode).addEventListener("click", () => chooseTab(mode));
}
tabList.addEventListener("keydown", event => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const selected = tabs.findIndex(mode => $("tab-" + mode).getAttribute("aria-selected") === "true");
  const next = tabs[(selected + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
  chooseTab(next);
  $("tab-" + next).focus();
});

function showGuest() {
  currentUser = null;
  tabList.hidden = false;
  signedIn.hidden = true;
  $("panel-login").hidden = $("tab-login").getAttribute("aria-selected") !== "true";
  $("panel-signup").hidden = $("tab-signup").getAttribute("aria-selected") !== "true";
  loginFieldset.disabled = !initialized || busy || !settings?.testLoginEnabled;
  loginButton.textContent = busy ? "Signing in…" : "Sign in";
}

async function showAccount(user) {
  currentUser = user;
  tabList.hidden = true;
  $("panel-login").hidden = true;
  $("panel-signup").hidden = true;
  signedIn.hidden = false;
  accountEmail.textContent = user.email || "Signed-in test user";
  accountName.textContent = "";
  displayNameInput.value = "";
  profileEditor.hidden = true;
  createProfileButton.hidden = true;
  profileMessage.textContent = "Checking your profile access…";

  // An auth.users entry is NOT automatically a public.profiles row.
  // Profile inserts happen only after the user clicks "Create my profile".
  const { data, error } = await client
    .from("profiles").select("display_name, created_at").eq("id", user.id).maybeSingle();
  if (currentUser?.id !== user.id) return;
  if (error) {
    profileMessage.textContent = "Profile access needs attention: " + error.message;
    announce("You are signed in, but your profile could not be retrieved.", "error");
    return;
  }
  if (!data) {
    profileMessage.textContent = "Your account exists. Create your private profile when you're ready.";
    createProfileButton.hidden = false;
    return;
  }
  accountName.textContent = data.display_name || "No display name set";
  displayNameInput.value = data.display_name || "";
  profileMessage.textContent = "Only your own profile is available through Row Level Security.";
  profileEditor.hidden = false;
}

async function refreshSession() {
  if (!client) return;
  const { data: { session }, error: sessionError } = await client.auth.getSession();
  if (sessionError) {
    announce("Could not read the test session: " + sessionError.message, "error");
    showGuest();
    return;
  }
  if (!session) {
    showGuest();
    return;
  }
  // getUser validates identity with the Supabase Auth server.
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) {
    announce(error ? "Session verification failed: " + error.message : "Session expired.", "error");
    showGuest();
    return;
  }
  await showAccount(user);
}

$("login-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!client || busy || !settings?.testLoginEnabled) return;
  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  if (!email || !password) return;
  busy = true;
  showGuest();
  announce("Signing in to your test account…");
  try {
    const { error } = await client.auth.signInWithPassword({ email, password });
    // Do not keep a password in the input after the request.
    $("login-password").value = "";
    if (error) {
      announce("Sign-in failed: " + error.message, "error");
      return;
    }
    announce("Signed in. Checking your private profile…", "success");
    await refreshSession();
  } catch {
    $("login-password").value = "";
    announce("Sign-in is unavailable. Check your connection and try again.", "error");
  } finally {
    busy = false;
    loginFieldset.disabled = !initialized || !settings?.testLoginEnabled;
    loginButton.textContent = "Sign in";
  }
});

createProfileButton.addEventListener("click", async () => {
  if (!currentUser || busy) return;
  busy = true;
  createProfileButton.disabled = true;
  try {
    const { error } = await client.from("profiles").insert({ id: currentUser.id });
    if (error) throw error;
    announce("Your private test profile was created.", "success");
    await showAccount(currentUser);
  } catch (error) {
    announce("Could not create your profile: " + (error?.message || "Unknown error"), "error");
  } finally {
    busy = false;
    createProfileButton.disabled = false;
  }
});

profileEditor.addEventListener("submit", async event => {
  event.preventDefault();
  if (!currentUser || busy) return;
  const name = displayNameInput.value.trim();
  if (name.length > 60) {
    announce("Display names cannot exceed 60 characters.", "error");
    return;
  }
  busy = true;
  saveProfileButton.disabled = true;
  try {
    const { error } = await client.from("profiles")
      .update({ display_name: name || null })
      .eq("id", currentUser.id);
    if (error) throw error;
    announce("Display name saved to your private test profile.", "success");
    await showAccount(currentUser);
  } catch (error) {
    announce("Could not save your profile: " + (error?.message || "Unknown error"), "error");
  } finally {
    busy = false;
    saveProfileButton.disabled = false;
  }
});

$("sign-out").addEventListener("click", async () => {
  if (!client || busy) return;
  busy = true;
  try {
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw error;
    showGuest();
    announce("Signed out of this test session.", "success");
  } catch (error) {
    announce("Sign-out failed: " + (error?.message || "Unknown error"), "error");
  } finally {
    busy = false;
  }
});

async function init() {
  signupInfo.textContent = "Public registration is not available yet. Existing test accounts can sign in after we finish security checks.";
  if (!settings?.url?.startsWith("https://") || !settings?.publishableKey?.startsWith("sb_publishable_")) {
    announce("Test connection is not configured. No passwords can be submitted.", "error");
    return;
  }
  if (settings.signupEnabled) {
    // A client-side switch alone is NOT a security boundary. Explicitly refuse to enable
    // registrations before the server-side signup gate and SMTP are reviewed.
    announce("Registration must remain disabled until the server-side rollout is approved.", "error");
    return;
  }
  try {
    // Pin the released SDK version. Public CDN only loads client code; private keys are never used.
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm");
    client = createClient(settings.url, settings.publishableKey, {
      auth: {
        storageKey: "lift-journal-auth-test-v1",
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: "pkce"
      }
    });
    initialized = true;
    loginFieldset.disabled = !settings.testLoginEnabled;
    announce("Connected to Supabase. Existing authorized test accounts can sign in.");
    // Avoid running Supabase calls synchronously in auth-state callbacks.
    client.auth.onAuthStateChange(() => { window.setTimeout(() => { void refreshSession(); }, 0); });
    await refreshSession();
  } catch (error) {
    announce("Unable to load Supabase authentication: " + (error?.message || "Connection error"), "error");
    loginFieldset.disabled = true;
  }
}
void init();
