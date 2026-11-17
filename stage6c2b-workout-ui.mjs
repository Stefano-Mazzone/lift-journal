// Stage 6C2B — account-gated encrypted workout ENTRY test, not full Lift Journal.
// Does not load plaintext legacy storage, modify index.html, or sync to cloud.
import {
  inspectCompartment, openCompartment, commitCompartment
} from "./stage6c2-private-storage.mjs";
import { DEVICE_OWNER_KEY, deviceOwnerStatus } from "./stage6-device-owner.mjs";
import { buildPrivateSnapshot } from "./stage6c-private-core.mjs";
import { buildFictionalPrivateWorkout } from "./stage6c2b-workout-core.mjs";

const AUTH_KEY = "lift-journal-auth-test-v1";
const $ = id => document.getElementById(id);
const config = window.LIFT_JOURNAL_AUTH;
const localhost = ["127.0.0.1", "localhost"].includes(location.hostname);
let client = null, user = null, seq = 0, busy = false;
let compartmentExists = false;
let unlockedData = null, openedHeadRaw = null, revision = null;
let review = null;

function status(message, kind = "info") {
  $("b-status").textContent = message;
  $("b-status").dataset.kind = kind;
}
function erase() {
  unlockedData = null;
  openedHeadRaw = null;
  revision = null;
  review = null;
  $("b-private").hidden = true;
  $("b-workout-list").replaceChildren();
  for (const id of ["b-workouts", "b-favorites", "b-revision", "b-meals"])
    $(id).textContent = "—";
  $("b-review-box").hidden = true;
  $("b-save-pass").value = "";
  $("b-unlock-pass").value = "";
}
function lock(message = "Private workout test locked; no plaintext was saved.") {
  ++seq; busy = false;
  erase(); status(message); render();
}
function linked() {
  try { return !!user?.id && deviceOwnerStatus(localStorage, user.id).status === "linked"; }
  catch { return false; }
}
function render() {
  const authorized = localhost && !!client && !!user?.id && linked();
  $("b-account").textContent = authorized ? (user.email || "Verified Test User") :
    "Not signed into the linked Test User";
  $("b-owner").textContent = authorized ?
    "Account verified and device ownership linked." :
    "Private workout entry locked until the linked Test User is server-verified.";
  $("b-unlock-area").hidden = !authorized || !compartmentExists;
  if (!authorized) erase();
  $("b-check").disabled = busy || !client;
  $("b-unlock").disabled = busy || !authorized || !$("b-unlock-pass").value;
  $("b-lock").disabled = busy;
  $("b-lock-open").disabled = busy;
  $("b-review").disabled = busy || !authorized || !unlockedData ||
    !openedHeadRaw || !$("b-save-pass").value || !!review;
  $("b-review-box").hidden = !authorized || !unlockedData || !review;
  $("b-confirm").disabled = busy || !review || !authorized || !$("b-save-pass").value;
  $("b-cancel").disabled = busy;
}
async function verify(expected, token) {
  if (!client || document.hidden || seq !== token || !linked())
    throw Error("Private workout view was locked or device owner changed.");
  const { data: { session }, error: sessionError } = await client.auth.getSession();
  if (sessionError || !session) throw Error("Test User is signed out.");
  const { data: { user: verified }, error } = await client.auth.getUser();
  if (error || verified?.id !== expected || user?.id !== expected ||
    !linked() || document.hidden || seq !== token)
    throw Error("Verified account changed while accessing encrypted workout data.");
  return expected;
}
async function checkAccount() {
  if (busy) return;
  const token = ++seq;
  erase();
  status("Verifying account ownership and encrypted workout compartment…");
  try {
    if (!client) throw Error("Test account service unavailable.");
    const { data: { session }, error: sessionError } = await client.auth.getSession();
    if (sessionError || !session) {
      user = null; compartmentExists = false;
      status("Signed out. Use Private Workout Viewer to sign into the linked Test User.");
      return;
    }
    const { data: { user: serverUser }, error } = await client.auth.getUser();
    if (token !== seq) return;
    if (error || !serverUser?.id) throw Error("Could not verify current account.");
    user = serverUser;
    if (!linked()) {
      compartmentExists = false;
      status("PRIVATE WORKOUT LOCKED: this browser's encrypted test history belongs to a different linked account.", "error");
      return;
    }
    const saved = inspectCompartment(localStorage, user.id);
    compartmentExists = saved.exists;
    status(saved.exists ?
      "Verified Test User. Encrypted compartment found. Enter the separate passphrase to unlock private test workouts." :
      "No Stage 6C2 encrypted compartment found. Complete Stage 6C2A first; no records will be created here.",
      saved.exists ? "success" : "error");
  } catch (error) {
    if (token !== seq) return;
    user = null; compartmentExists = false;
    status("Private workout test locked: " + (error?.message || "Account unavailable"), "error");
  } finally {
    if (token === seq) render();
  }
}
function setSummary(data, revisionNumber, head) {
  const summary = buildPrivateSnapshot(data);
  const ul = $("b-workout-list");
  ul.replaceChildren();
  for (const workout of summary.sessions) {
    const li = document.createElement("li");
    li.textContent = [workout.name, workout.date,
      workout.exercises.join(", ")].filter(Boolean).join(" · ");
    ul.append(li);
  }
  if (!summary.sessions.length) {
    const li = document.createElement("li");
    li.textContent = "No saved workouts";
    ul.append(li);
  }
  unlockedData = data;
  openedHeadRaw = head;
  revision = revisionNumber;
  $("b-workouts").textContent = String(summary.workoutCount);
  $("b-favorites").textContent = String(summary.favoriteCount);
  $("b-revision").textContent = String(revisionNumber);
  $("b-meals").textContent = String(summary.mealCount);
  $("b-units").textContent = "Weight unit from your encrypted account: " + summary.unit;
  $("b-private").hidden = false;
  review = null;
  $("b-review-box").hidden = true;
}
function currentForm() {
  return {
    date: $("b-date").value,
    movement: $("b-movement").value,
    weight: $("b-weight").value,
    reps: $("b-reps").value,
    setCount: $("b-sets").value
  };
}
function defaultDate() {
  const d = new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}
$("b-date").value = defaultDate();
$("b-check").addEventListener("click", () => { if (!busy) void checkAccount(); });
$("b-unlock-pass").addEventListener("input", render);
$("b-save-pass").addEventListener("input", render);
for (const id of ["b-date","b-movement","b-weight","b-reps","b-sets"]) {
  $(id).addEventListener("input", () => {
    review = null;
    $("b-review-box").hidden = true;
    render();
  });
}
$("b-unlock").addEventListener("click", async () => {
  if (busy || !linked() || !compartmentExists) return;
  const passphrase = $("b-unlock-pass").value;
  $("b-unlock-pass").value = "";
  if (!passphrase) return;
  const token = ++seq, id = user.id;
  busy = true; erase(); render();
  status("Decrypting account-private workout record…");
  try {
    const opened = await openCompartment({
      storage: localStorage, userId: id, passphrase,
      reverify: () => verify(id, token)
    });
    if (token !== seq) return;
    setSummary(opened.data, opened.revision, opened.headRaw);
    status("Private encrypted workout compartment unlocked at revision " +
      opened.revision + ". No plaintext data was written to browser storage.", "success");
  } catch (error) {
    if (token === seq) {
      erase();
      status("Unlock stopped: " + (error?.message || "Unable to decrypt"), "error");
    }
  } finally {
    if (token === seq) { busy = false; render(); }
  }
});
$("b-review").addEventListener("click", () => {
  if (busy || !linked() || !unlockedData || !openedHeadRaw || !$("b-save-pass").value) return;
  try {
    // Create and validate a DRAFT; only final confirmation can write encrypted data.
    const candidate = { ...currentForm(),
      id: "test-6c2b-" + crypto.randomUUID(),
      now: new Date().toISOString()
    };
    const result = buildFictionalPrivateWorkout({ data: unlockedData, ...candidate });
    review = candidate;
    const first = result.session.exercises[0];
    $("b-review-summary").textContent =
      "This will ADD one fictional completed workout on " + candidate.date +
      " with " + first.sets.length + " set(s) of " + first.name + ", " +
      first.sets[0].weight + " " + result.session.unit + " × " +
      first.sets[0].reps + " reps. Your separate Stage 6C2 encrypted test compartment will advance from revision " +
      revision + " to " + (revision + 1) + ". Your regular Lift Journal workouts remain unchanged.";
    status("Review prepared. No workout was saved. Verify the fictional details, then Confirm or Cancel.");
  } catch (error) {
    review = null;
    status("Cannot prepare fictional workout: " + (error?.message || "Invalid entry"), "error");
  }
  render();
});
$("b-cancel").addEventListener("click", () => {
  if (busy) return;
  review = null; $("b-save-pass").value = "";
  status("Private test workout entry cancelled. No data was changed.");
  render();
});
$("b-confirm").addEventListener("click", async () => {
  if (busy || !linked() || !unlockedData || !openedHeadRaw || !review) return;
  const passphrase = $("b-save-pass").value;
  $("b-save-pass").value = "";
  if (!passphrase) { review = null; render(); return; }
  const candidate = review, startingData = unlockedData;
  // Cannot be edited after the review step; changing any form field clears it.
  const current = currentForm();
  if (Object.keys(current).some(k => current[k] !== candidate[k])) {
    review = null;
    status("Workout details changed since review. No data saved; review again.", "error");
    render(); return;
  }
  const id = user.id, expectedHeadRaw = openedHeadRaw, token = ++seq;
  review = null; busy = true; render();
  status("Verifying encrypted workout save…");
  try {
    const prepared = buildFictionalPrivateWorkout({
      data: startingData, ...candidate
    });
    const saved = await commitCompartment({
      storage: localStorage, userId: id, passphrase,
      data: prepared.data, expectedData: startingData, expectedHeadRaw,
      reverify: () => verify(id, token),
      locks: navigator.locks
    });
    if (token !== seq) return;
    const again = await openCompartment({
      storage: localStorage, userId: id, passphrase,
      reverify: () => verify(id, token)
    });
    if (again.headRaw !== saved.headRaw ||
        !Object.prototype.hasOwnProperty.call(again.data.sessions, prepared.id))
      throw Error("Saved private workout failed independent readback. Stop testing.");
    if (token !== seq) return;
    setSummary(again.data, again.revision, again.headRaw);
    status("Fictional workout encrypted and re-opened successfully at revision " +
      saved.revision + ". Refresh and unlock to confirm persistence. Normal Lift Journal data was not modified by this test.", "success");
  } catch (error) {
    if (token === seq) {
      erase();
      status("Private workout save not confirmed: " + (error?.message || "Unknown error") +
        ". No original workout key was written. Reopen and inspect before any retry.", "error");
    }
  } finally {
    if (token === seq) { busy = false; render(); }
  }
});
for (const id of ["b-lock","b-lock-open"])
  $(id).addEventListener("click", () => lock("Private workout test manually locked."));
window.addEventListener("blur", () => {
  if (unlockedData) {
    lock("Private workout test locked when browser lost focus.");
  } else if (!busy) {
    review = null;
    $("b-review-box").hidden = true;
    $("b-unlock-pass").value = "";
    $("b-save-pass").value = "";
    render();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) lock("Private workout test locked when tab became hidden.");
  else if (client && !busy) void checkAccount();
});
window.addEventListener("pagehide", () => lock("Private workout test locked on navigation."));
window.addEventListener("storage", event => {
  if (event.key === null || event.key === AUTH_KEY ||
      event.key === DEVICE_OWNER_KEY || event.key?.startsWith("lift-journal-private-v2:")) {
    if (event.key === AUTH_KEY && busy && !unlockedData) return;
    lock("Account or encrypted storage changed in another tab. Private workout view locked.");
    if (client && !busy) void checkAccount();
  }
});
async function init() {
  if (!localhost || !config?.url || !config.publishableKey ||
      !config.testLoginEnabled || config.signupEnabled) {
    status("Private workout test disabled outside localhost or verified test-login configuration.", "error");
    render(); return;
  }
  try {
    const { createClient } =
      await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm");
    client = createClient(config.url, config.publishableKey, {
      auth: { storageKey: AUTH_KEY, persistSession: true, autoRefreshToken: true,
        detectSessionInUrl: false, flowType: "pkce" }
    });
    client.auth.onAuthStateChange((event, session) => {
      const candidateId = session?.user?.id || null;
      if (event === "SIGNED_OUT" ||
          (!!user?.id && !!candidateId && user.id !== candidateId)) {
        user = null;
        compartmentExists = false;
        lock("Account signed out or switched. Private workout data locked.");
      } else if (event === "INITIAL_SESSION" && !user && !busy) {
        window.setTimeout(() => { if (!busy) void checkAccount(); }, 0);
      }
      // No refresh-triggered lock during same-user encrypted commits.
      // Each encrypted read/write independently verifies Supabase getUser.
    });
    await checkAccount();
  } catch (error) {
    user = null; compartmentExists = false;
    status("Test account service unavailable: " + (error?.message || "Unknown error"), "error");
    render();
  }
}
render();
void init();
