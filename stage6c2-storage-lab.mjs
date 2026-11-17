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

function status(s, kind = "info") {
  message = s; statusKind = kind;
  $("v2-status").textContent = s;
  $("v2-status").dataset.kind = kind;
}
function resetPrivateState() {
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
  $("v2-unlock-area").hidden = !canUse || !created;
  if (!canUse) resetPrivateState();
  $("v2-check").disabled = busy || !client;
  $("v2-backup-legacy").disabled = busy;
  $("v2-backup-encrypted").disabled = busy;
  $("v2-ack").disabled = !(savedLegacyBackup && savedEncryptedBackup) || busy;
  $("v2-create").disabled = busy || !canUse || !savedLegacyBackup ||
    !savedEncryptedBackup || !$("v2-ack").checked ||
    !$("v2-create-pass").value;
  $("v2-unlock").disabled = busy || !canUse || !$("v2-pass").value;
  $("v2-add-fav").disabled = busy || !canUse || !unlockedData || !$("v2-save-pass").value;
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
$("v2-create").addEventListener("click", async () => {
  if (busy || !linked() || !savedLegacyBackup || !savedEncryptedBackup || !$("v2-ack").checked) return;
  const passphrase = $("v2-create-pass").value;
  $("v2-create-pass").value = "";
  if (!passphrase) return;
  if (!confirm("Create an ADDITIONAL encrypted private test compartment for the currently verified Test User? Original Stage 6B copies and local workouts will remain unchanged. No cloud changes."))
    return;
  const token = ++seq, id = user.id;
  busy = true; render();
  status("Verifying account and writing encrypted copy…");
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
    status("Create stopped without touching original history: " + (error?.message || "Unknown error"), "error");
    try {created=inspectCompartment(localStorage,id).exists;}catch{created=false;}
  } finally { if (token === seq) {busy=false;render();} }
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
$("v2-add-fav").addEventListener("click", async () => {
  if (busy || !linked() || !unlockedData || !openedHeadRaw) return;
  const passphrase=$("v2-save-pass").value;
  $("v2-save-pass").value="";
  if (!passphrase) return;
  const startingData=unlockedData;
  const data=JSON.parse(JSON.stringify(startingData));
  data.favoriteMovements=Array.isArray(data.favoriteMovements)?data.favoriteMovements:[];
  if (data.favoriteMovements.includes(TEST_FAVORITE)) {
    status("The fictional Stage 6C2 test favorite was already saved. No duplicate added.","info");
    render();return;
  }
  data.favoriteMovements.push(TEST_FAVORITE);
  const token=++seq,id=user.id,expect=openedHeadRaw;
  if (!confirm("Save ONE fictional favorite in the separate ENCRYPTED Stage 6C2 test compartment? The original Lift Journal app and Stage 6B backups remain unchanged."))return;
  busy=true;render();status("Verifying encrypted save and current account…");
  try {
    const saved=await commitCompartment({
      storage:localStorage,userId:id,passphrase,data,expectedData:startingData,expectedHeadRaw:expect,
      reverify:()=>verifiedId(id,token),locks:navigator.locks
    });
    if(token!==seq)return;
    const reopened=await openCompartment({
      storage:localStorage,userId:id,passphrase,
      reverify:()=>verifiedId(id,token)
    });
    if(reopened.headRaw!==saved.headRaw)throw Error("Reloaded saved revision differs. Stop testing.");
    if(token!==seq)return;
    previewData(reopened.data,reopened.revision,reopened.headRaw);
    status("Encrypted favorite saved and read back successfully at revision "+saved.revision+
      ". Now reload this page and unlock again to verify persistence.", "success");
  }catch(error) {
    if(token===seq){resetPrivateState();status("Encrypted save could not be confirmed: "+
      (error?.message||"Unknown error")+". No legacy history was touched. Re-open compartment to inspect.", "error");}
  }finally{if(token===seq){busy=false;render();}}
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
window.addEventListener("blur",()=>lock("Private compartment locked when the browser lost focus."));
document.addEventListener("visibilitychange",()=>{
  if(document.hidden)lock("Private compartment locked when this tab was hidden.");
  else if(client)void checkAccount();
});
window.addEventListener("pagehide",()=>lock("Private compartment locked on navigation."));
window.addEventListener("storage",event=>{
  if(event.key===null||event.key===AUTH_KEY||event.key===DEVICE_OWNER_KEY||
    event.key===DEVICE_DATA_KEY||event.key?.startsWith("lift-journal-private-v1:")||
    event.key?.startsWith("lift-journal-private-v2:")){
    lock("Account or storage changed in another tab. Private data locked.");
    if(client)void checkAccount();
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
    client.auth.onAuthStateChange(()=>{
      lock("Authentication changed. Private compartment locked.");
      window.setTimeout(()=>{if(!busy)void checkAccount();},0);
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
