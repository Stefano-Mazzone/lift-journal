// Stage 6C2A standalone storage test UI, localhost/127.0.0.1 ONLY.
// Does not edit index.html's legacy workouts. No normal-app save interception.
// No data upload, sync, legacy deletion, or real account onboarding.
import {
  inspectCompartment, createCompartment, openCompartment, commitCompartment,
  compartmentKeys
} from "./stage6c2-private-storage.mjs";
import { latestVault } from "./stage6b-vault-recovery.mjs";
import { DEVICE_DATA_KEY, DEVICE_OWNER_KEY, deviceOwnerStatus } from "./stage6-device-owner.mjs";
import { buildPrivateSnapshot } from "./stage6c-private-core.mjs";

const AUTH_KEY = "lift-journal-auth-test-v1";
const TEST_FAVORITE = "TEST - Stage 6C2 Encrypted Favorite";
const $ = id => document.getElementById(id);
const config = window.LIFT_JOURNAL_AUTH;
const allowedHost = ["127.0.0.1", "localhost"].includes(location.hostname);
let client = null, user = null, unlockedData = null, openedHeadRaw = null;
let revision = null, busy = false, seq = 0, created = false;
let savedLegacyBackup = false, savedEncryptedBackup = false;
let message = "Checking test account…", statusKind = "info";
// Explicit two-step review replaces native confirm() entirely.
// Review forms never write; final clicks always rerun owner/server/storage checks.
let createReview = false, saveReview = false;

function status(s, kind = "info") {
  message = s; statusKind = kind;
  $("v2-status").textContent = s;
  $("v2-status").dataset.kind = kind;
}
function resetPrivateState() {
  createReview = false;
  saveReview = false;
  unlockedData = null;
  openedHeadRaw = null;
  revision = null;
  $("v2-data").hidden = true;
  $("v2-fav-list").replaceChildren();
  for (const id of ["v2-count", "v2-favs", "v2-revision", "v2-meals"]) $(id).textContent = "—";
  for (const id of ["v2-pass", "v2-create-pass", "v2-save-pass"]) $(id).value = "";
}
function lock(s = "Encrypted private compartment locked. No decrypted workout copy was saved.") {
  ++seq;
  busy = false;
  resetPrivateState();
  status(s);
  render();
}
function linked() {
  try { return !!user?.id && deviceOwnerStatus(localStorage, user.id).status === "linked"; }
  catch { return false; }
}
function render() {
  const canUse = !!user?.id && linked() && allowedHost && !!client;
  $("v2-account").textContent = canUse ? (user.email || "Verified test user") : "Not signed into linked test account";
  $("v2-link-status").textContent = canUse ?
    "Account verified and device link active." :
    "PRIVATE STORAGE LOCKED until you sign into the original linked Test User.";
  $("v2-create-area").hidden = !canUse || created;
  $("v2-create-confirmation").hidden = !canUse || created || !createReview;
  $("v2-save-confirmation").hidden = !canUse || !unlockedData || !saveReview;
  $("v2-unlock-area").hidden = !canUse || !created;
  if (!canUse) resetPrivateState();
  $("v2-check").disabled = busy || !client;
  $("v2-backup-legacy").disabled = busy;
  $("v2-backup-encrypted").disabled = busy;
  $("v2-ack").disabled = !(savedLegacyBackup && savedEncryptedBackup) || busy;
  $("v2-create").disabled = busy || createReview || !canUse || !savedLegacyBackup ||
    !savedEncryptedBackup || !$("v2-ack").checked ||
    !$("v2-create-pass").value;
  $("v2-create-final").disabled = busy || !createReview || !canUse ||
    !savedLegacyBackup || !savedEncryptedBackup || !$("v2-ack").checked ||
    !$("v2-create-pass").value;
  $("v2-create-cancel").disabled = busy;
  $("v2-unlock").disabled = busy || !canUse || !$("v2-pass").value;
  $("v2-add-fav").disabled = busy || saveReview || !canUse || !unlockedData || !$("v2-save-pass").value;
  $("v2-save-final").disabled = busy || !saveReview || !canUse ||
    !unlockedData || !$("v2-save-pass").value;
  $("v2-save-cancel").disabled = busy;
  $("v2-export").disabled = busy || !canUse || !unlockedData;
  $("v2-lock").disabled = busy;
  $("v2-lock-open").disabled = busy;
}
async function verifiedId(expected = null, expectedSeq = seq) {
  if (!client || document.hidden || seq !== expectedSeq)
    throw Error("Viewer lost focus or account verification was interrupted.");
  const { data: { session }, error: sessionError } = await client.auth.getSession();
  if (sessionError || !session) throw Error("Signed-out test account.");
  const { data: { user: serverUser }, error } = await client.auth.getUser();
  if (error || !serverUser?.id || !user?.id || serverUser.id !== user.id ||
    (expected && serverUser.id !== expected) || !linked() ||
    seq !== expectedSeq || document.hidden)
    throw Error("Server-verified identity or device owner changed. Private storage remains locked.");
  return serverUser.id;
}
async function checkAccount() {
  // A background auth token refresh cannot reset an active encrypted write.
  // The storage engine independently re-verifies server identity before commit.
  if (busy) return;
  const token = ++seq;
  resetPrivateState();
  status("Checking test-account identity and encrypted storage…");
  try {
    if (!client) throw Error("Test account service unavailable.");
    const { data: { session }, error } = await client.auth.getSession();
    if (error || !session) {
      user = null; created = false;
      status("Signed out. Sign into the original Test User from the private viewer.", "error");
      render(); return;
    }
    const { data: { user: serverUser }, error: whoError } = await client.auth.getUser();
    if (token !== seq) return;
    if (whoError || !serverUser?.id) throw Error("Server authentication could not be verified.");
    user = serverUser;
    if (!linked()) {
      created = false;
      status("PRIVATE STORAGE LOCKED: this browser belongs to another linked test account.", "error");
    } else {
      const state = inspectCompartment(localStorage, user.id);
      created = state.exists;
      status(created ?
        "Verified Test User. Encrypted compartment found. Enter the separate passphrase to unlock." :
        "Verified Test User. No private compartment exists yet. Save both new backups before creating an encrypted test copy.",
        "success");
    }
  } catch (error) {
    if (token !== seq) return;
    user = null; created = false;
    status("Private storage locked: " + (error?.message || "Account unavailable"), "error");
  } finally { if (token === seq) render(); }
}
function downloadFile(name, contents) {
  const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href; a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 30000);
}
function backupDay() { return new Date().toISOString().slice(0,10); }
function previewData(data, rev, token) {
  const snapshot = buildPrivateSnapshot(data);
  unlockedData = data;
  openedHeadRaw = token;
  revision = rev;
  $("v2-count").textContent = String(snapshot.workoutCount);
  $("v2-favs").textContent = String(snapshot.favoriteCount);
  $("v2-revision").textContent = String(rev);
  $("v2-meals").textContent = String(snapshot.mealCount);
  const list = $("v2-fav-list");
  list.replaceChildren();
  for (const movement of snapshot.favorites) {
    const li = document.createElement("li");
    li.textContent = movement;
    list.append(li);
  }
  if (!snapshot.favorites.length) {
    const li = document.createElement("li"); li.textContent = "None yet"; list.append(li);
  }
  $("v2-data").hidden = false;
}
$("v2-check").addEventListener("click", () => { if (!busy) void checkAccount(); });
$("v2-create-pass").addEventListener("input", render);
$("v2-pass").addEventListener("input", render);
$("v2-save-pass").addEventListener("input", render);
$("v2-ack").addEventListener("change", render);
$("v2-backup-legacy").addEventListener("click", () => {
  try {
    if (!linked() || busy) throw Error("A linked test account is required.");
    const raw = localStorage.getItem(DEVICE_DATA_KEY);
    if (!raw || raw.length > 20*1024*1024) throw Error("Legacy test history is missing or too large.");
    const data = JSON.parse(raw);
    buildPrivateSnapshot(data);
    downloadFile("lift-journal-STAGE-6C2-LEGACY-SAFETY-" + backupDay() + ".json",
      JSON.stringify({format:"lift-journal-v1",exported:new Date().toISOString(),data},null,2));
    savedLegacyBackup = true;
    status("Legacy safety backup download started. Confirm the file appears in Downloads.", "success");
  } catch (error) {status("Backup stopped: " + error.message, "error");}
  render();
});
$("v2-backup-encrypted").addEventListener("click", () => {
  try {
    if (!linked() || busy) throw Error("A linked test account is required.");
    const source = latestVault(localStorage, user.id);
    if (!source) throw Error("Stage 6B3 encrypted copy was not found.");
    downloadFile("lift-journal-STAGE-6C2-SOURCE-ENCRYPTED-" + backupDay() + ".json", source.raw);
    savedEncryptedBackup = true;
    status("Encrypted source download started. Confirm the file appears in Downloads.", "success");
  } catch (error) {status("Backup stopped: " + error.message, "error");}
  render();
});
$("v2-create").addEventListener("click", () => {
  if (busy || !linked() || created || !savedLegacyBackup || !savedEncryptedBackup ||
      !$("v2-ack").checked || !$("v2-create-pass").value) return;
  createReview = true;
  $("v2-create-review").textContent =
    "Verified linked account: " + (user.email || "Test User") +
    ". Both fresh safety downloads acknowledged. Final confirmation will copy the" +
    " working Stage 6B encrypted data into a SEPARATE Stage 6C2 encrypted compartment.";
  status("Review prepared. No encrypted compartment was created yet. Use the inline Confirm or Cancel button.", "info");
  render();
});
$("v2-create-cancel").addEventListener("click", () => {
  if (busy) return;
  createReview = false;
  $("v2-create-pass").value = "";
  status("Encrypted compartment creation cancelled. No storage changes made.");
  render();
});
$("v2-create-final").addEventListener("click", async () => {
  if (!createReview || busy || !linked() || created ||
      !savedLegacyBackup || !savedEncryptedBackup || !$("v2-ack").checked) return;
  const passphrase = $("v2-create-pass").value;
  $("v2-create-pass").value = "";
  if (!passphrase) { createReview = false; render(); return; }
  createReview = false;
  const token = ++seq, id = user.id;
  busy = true; render();
  status("Encrypting test compartment. Account identity, passphrase and storage are being verified…");
  try {
    const saved = await createCompartment({
      storage: localStorage, userId: id, passphrase, locks: navigator.locks,
      reverify: () => verifiedId(id, token)
    });
    if (token !== seq) return;
    created = true;
    resetPrivateState();
    status("Stage 6C2 encrypted compartment created and verified (revision " + saved.revision +
      "). " + saved.workouts + " workouts and " + saved.favorites +
      " favorites copied. Originals preserved. Unlock the compartment to test read/write.", "success");
  } catch (error) {
    if (token !== seq) return;
    resetPrivateState();
    status("Creation failed safely: " + (error?.message || "Unknown error") +
      ". Original workouts and encrypted sources were not overwritten. Do not retry before reviewing this error.", "error");
    try { created = inspectCompartment(localStorage, id).exists; }
    catch { created = false; }
  } finally { if (token === seq) { busy = false; render(); } }
});
$("v2-unlock").addEventListener("click", async () => {
  if (busy || !linked() || !created) return;
  const passphrase = $("v2-pass").value;
  $("v2-pass").value = "";
  if (!passphrase) return;
  const token = ++seq, id=user.id;
  busy=true; resetPrivateState(); render();status("Decrypting private compartment…");
  try {
    const opened = await openCompartment({
      storage:localStorage,userId:id,passphrase,
      reverify:() => verifiedId(id,token)
    });
    if (token !== seq) return;
    previewData(opened.data,opened.revision,opened.headRaw);
    status("Encrypted compartment unlocked from saved revision " + opened.revision +
      ". No plaintext was stored in localStorage.", "success");
  } catch(error) {
    if(token===seq){resetPrivateState();status("Unlock stopped: "+(error?.message||"Unknown error"),"error");}
  }finally {if(token===seq){busy=false;render();}}
});
$("v2-add-fav").addEventListener("click", () => {
  if (busy || !linked() || !unlockedData || !openedHeadRaw ||
      !$("v2-save-pass").value) return;
  const favorites = unlockedData.favoriteMovements;
  if (Array.isArray(favorites) && favorites.includes(TEST_FAVORITE)) {
    $("v2-save-pass").value = "";
    status("The fictional Stage 6C2 test favorite was already saved. No duplicate added.", "info");
    render(); return;
  }
  saveReview = true;
  status("Review prepared. No favorite was saved yet. Confirm the encrypted TEST favorite addition below.");
  render();
});
$("v2-save-cancel").addEventListener("click", () => {
  if (busy) return;
  saveReview = false;
  $("v2-save-pass").value = "";
  status("Encrypted test favorite save cancelled. No data changed.");
  render();
});
$("v2-save-final").addEventListener("click", async () => {
  if (!saveReview || busy || !linked() || !unlockedData || !openedHeadRaw) return;
  const passphrase = $("v2-save-pass").value;
  $("v2-save-pass").value = "";
  if (!passphrase) { saveReview = false; render(); return; }
  saveReview = false;
  const startingData = unlockedData;
  const data = JSON.parse(JSON.stringify(startingData));
  data.favoriteMovements = Array.isArray(data.favoriteMovements) ? data.favoriteMovements : [];
  if (data.favoriteMovements.includes(TEST_FAVORITE)) {
    status("The test favorite is already present; no duplicate saved.");
    render(); return;
  }
  data.favoriteMovements.push(TEST_FAVORITE);
  const token = ++seq, id = user.id, expect = openedHeadRaw;
  busy = true; render();
  status("Verifying current passphrase and saving encrypted test favorite…");
  try {
    const saved = await commitCompartment({
      storage: localStorage, userId: id, passphrase, data,
      expectedData: startingData, expectedHeadRaw: expect,
      reverify: () => verifiedId(id, token), locks: navigator.locks
    });
    if (token !== seq) return;
    const reopened = await openCompartment({
      storage: localStorage, userId: id, passphrase,
      reverify: () => verifiedId(id, token)
    });
    if (reopened.headRaw !== saved.headRaw)
      throw Error("Reloaded saved revision differs. Stop testing.");
    if (token !== seq) return;
    previewData(reopened.data, reopened.revision, reopened.headRaw);
    status("Encrypted favorite saved and read back successfully at revision " + saved.revision +
      ". Reload the page and unlock again to verify persistence.", "success");
  } catch (error) {
    if (token === seq) {
      resetPrivateState();
      status("Encrypted save could not be confirmed: " + (error?.message || "Unknown error") +
        ". No legacy history was touched. Re-open compartment to inspect.", "error");
    }
  } finally { if (token === seq) { busy = false; render(); } }
});
$("v2-export").addEventListener("click", () => {
  try {
    if (!linked() || !unlockedData || !openedHeadRaw) throw Error("Unlock the verified compartment first.");
    const state=inspectCompartment(localStorage,user.id);
    if (state.headRaw!==openedHeadRaw) throw Error("Compartment changed; reload before exporting.");
    const keys=compartmentKeys(user.id);
    const archive={format:"lift-journal-private-v2-test",exported:new Date().toISOString(),
      head:localStorage.getItem(keys.head), slots:keys.slots.map(k=>localStorage.getItem(k))};
    downloadFile("lift-journal-STAGE-6C2-ENCRYPTED-" + backupDay() + ".json",
      JSON.stringify(archive,null,2));
    status("Encrypted compartment backup download started. This format is not yet restorable through the app.", "success");
  }catch(error){status("Backup stopped: "+error.message,"error");}
});
for(const buttonId of ["v2-lock","v2-lock-open"])
  $(buttonId).addEventListener("click",()=>lock("Stage 6C2 private compartment manually locked."));
window.addEventListener("blur", () => {
  // There is no native confirm() anymore. If decrypted history is on-screen,
  // losing focus immediately hides it. If no data is displayed, do not erase
  // creation diagnostics just because another window (e.g. screenshot tool)
  // gained focus. A genuinely hidden tab still invalidates an active operation.
  if (unlockedData) {
    lock("Private compartment locked when the browser lost focus.");
  } else if (!busy) {
    createReview = false;
    saveReview = false;
    for (const id of ["v2-create-pass", "v2-pass", "v2-save-pass"]) $(id).value = "";
    render();
  }
});
document.addEventListener("visibilitychange",()=>{
  if(document.hidden)lock("Private compartment locked when this tab was hidden.");
  else if(client && !busy)void checkAccount();
});
window.addEventListener("pagehide",()=>lock("Private compartment locked on navigation."));
window.addEventListener("storage",event=>{
  if(event.key===null||event.key===AUTH_KEY||event.key===DEVICE_OWNER_KEY||
    event.key===DEVICE_DATA_KEY||event.key?.startsWith("lift-journal-private-v1:")||
    event.key?.startsWith("lift-journal-private-v2:")){
    // An auth-token refresh from another tab is not an account switch.
    // For an in-flight creation (no decrypted UI shown), let server re-check
    // reject a real account change immediately before committing ciphertext.
    if(event.key===AUTH_KEY && busy && !unlockedData) return;
    lock("Account or storage changed in another tab. Private data locked.");
    if(client && !busy)void checkAccount();
  }
});
async function initialize() {
  if(!allowedHost || !config?.url || !config.publishableKey ||
    !config.testLoginEnabled || config.signupEnabled) {
    status("Storage lab is disabled: localhost-only test login configuration is required.","error");
    render();return;
  }
  try {
    const {createClient}=await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm");
    client=createClient(config.url,config.publishableKey,{auth:{
      storageKey:AUTH_KEY,persistSession:true,autoRefreshToken:true,
      detectSessionInUrl:false,flowType:"pkce"
    }});
    client.auth.onAuthStateChange((event, session)=>{
      const incomingId = session?.user?.id || null;
      const switched = !!user?.id && !!incomingId && incomingId !== user.id;
      if (event === "SIGNED_OUT" || switched) {
        // Fail closed immediately for a true sign-out or different account.
        user = null;
        lock("Signed-out or different test account. Private compartment locked.");
        window.setTimeout(()=>{if(!busy)void checkAccount();},0);
      } else if (event === "INITIAL_SESSION" && !user && !busy) {
        window.setTimeout(()=>{if(!busy)void checkAccount();},0);
      }
      // TOKEN_REFRESHED and same-user SIGNED_IN must NOT interrupt an
      // encrypted operation. Every write separately checks getUser() and owner.
    });
    await checkAccount();
  }catch(error){
    user=null;created=false;
    status("Test authentication service unavailable: "+(error?.message||"Unknown error"),"error");
    render();
  }
}
render();
void initialize();
