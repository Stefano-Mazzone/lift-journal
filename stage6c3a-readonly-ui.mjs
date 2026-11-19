// Stage 6C3A — private-app read-only interface, NOT index.html.
// Account-gated encrypted v2 reads only. No plaintext localStorage reads/writes.
import { inspectCompartment, openCompartment } from "./stage6c2-private-storage.mjs";
import { DEVICE_OWNER_KEY, deviceOwnerStatus } from "./stage6-device-owner.mjs";
import { buildReadOnlyPrivateAppModel } from "./stage6c3a-readonly-model.mjs";
const AUTH_KEY = "lift-journal-auth-test-v1";
const $ = id => document.getElementById(id);
const config = window.LIFT_JOURNAL_AUTH;
const allowedHost = ["127.0.0.1", "localhost"].includes(location.hostname);
let client = null, verifiedUser = null, compartmentExists = false;
let generation = 0, busy = false, model = null, revision = null;
let activeTab = "history";

function setStatus(message,kind="info") {
  $("c3-status").textContent = message;
  $("c3-status").dataset.kind = kind;
}
function clearPrivate() {
  model = null; revision = null;
  $("c3-private").hidden = true;
  $("c3-history-list").replaceChildren();
  $("c3-movement-list").replaceChildren();
  for(const id of ["c3-workouts","c3-favorites","c3-meals","c3-revision"])
    $(id).textContent = "—";
  for(const id of ["c3-history-count","c3-movement-count"])
    $(id).textContent = "";
  $("c3-passphrase").value = "";
  $("c3-history-filter").value = "";
  $("c3-movement-filter").value = "";
}
function linkedOwner() {
  try { return !!verifiedUser?.id &&
    deviceOwnerStatus(localStorage,verifiedUser.id).status === "linked"; }
  catch { return false; }
}
function authorized() {
  return allowedHost && !!client && !!verifiedUser?.id && linkedOwner();
}
function renderGate() {
  const allowed = authorized();
  $("c3-account").textContent = allowed ?
    (verifiedUser.email || "Verified linked test account") : "Not the linked Test User";
  $("c3-unlock-area").hidden = !allowed || !compartmentExists;
  if(!allowed)clearPrivate();
  $("c3-check").disabled = busy || !client;
  $("c3-unlock").disabled = busy || !allowed || !compartmentExists ||
    !$("c3-passphrase").value;
  $("c3-lock").disabled = busy;
  $("c3-lock-open").disabled = busy;
}
function lock(message="Private History and Movements locked.") {
  generation++;
  busy = false;
  clearPrivate();
  setStatus(message);
  renderGate();
}
async function verify(expected,token) {
  if(token !== generation || document.hidden || !authorized() ||
    verifiedUser.id !== expected)
    throw Error("Private viewer locked or device owner changed.");
  const sessionRes = await client.auth.getSession();
  if(sessionRes?.error || !sessionRes?.data?.session)
    throw Error("The test account is signed out.");
  const userRes = await client.auth.getUser();
  if(userRes?.error || userRes?.data?.user?.id !== expected ||
    token !== generation || document.hidden || !authorized() ||
    verifiedUser.id !== expected)
    throw Error("Current linked account changed while decrypting.");
  return expected;
}
async function checkAccount() {
  if(busy) return;
  const token=++generation;
  verifiedUser=null; compartmentExists=false; clearPrivate();
  setStatus("Verifying linked account and encrypted private compartment…");
  try {
    if(!client || !allowedHost)
      throw Error("Private preview disabled: test account service unavailable.");
    const sessionRes=await client.auth.getSession();
    if(token!==generation)return;
    if(sessionRes?.error || !sessionRes?.data?.session){
      setStatus("Signed out. Open account sign-in and sign in with the original linked Test User.");
      return;
    }
    const userRes=await client.auth.getUser();
    if(token!==generation)return;
    if(userRes?.error || !userRes?.data?.user?.id)
      throw Error("Server account verification failed.");
    verifiedUser=userRes.data.user;
    if(!linkedOwner()){
      setStatus("PRIVATE APP LOCKED: encrypted workouts belong to a different linked test account.","error");
      return;
    }
    const found=inspectCompartment(localStorage,verifiedUser.id);
    compartmentExists=found.exists;
    setStatus(found.exists ?
      "Linked Test User verified. Encrypted workout compartment found; unlock to view History and Movements." :
      "PRIVATE APP LOCKED: this account has no Stage 6C2 encrypted compartment yet.",
      found.exists?"success":"error");
  } catch(error) {
    if(token !== generation) return;
    verifiedUser=null;compartmentExists=false;
    setStatus("PRIVATE APP LOCKED: "+(error?.message||"Account verification unavailable"),"error");
  } finally {
    if(token===generation) renderGate();
  }
}
function node(tag,text,cls="") {
  const n=document.createElement(tag);
  n.textContent=text;
  if(cls)n.className=cls;
  return n;
}
function makeWorkoutCard(s) {
  const article=node("article","","workout");
  const header=node("div","","workout-header");
  const left=node("div");
  left.append(node("div",s.title,"workout-title"),
    node("div",s.date,"workout-date"));
  header.append(left,node("span",s.completed?"Completed":"In progress","pill"));
  article.append(header);
  if(!s.exercises.length){
    article.append(node("p","No exercises recorded","smallnote"));
  }
  for(const ex of s.exercises) {
    const section=node("section","","exercise");
    section.append(node("h4",ex.name));
    if(!ex.sets.length)section.append(node("p","No sets recorded","smallnote"));
    else {
      const ul=node("ul","","sets");
      for(const set of ex.sets){
        const label="Set "+set.index+" · "+(set.weight||"—")+" "+s.unit+
          " × "+(set.reps||"—")+" reps"+(set.done?" · Done":" · Not checked");
        ul.append(node("li",label,set.done?"done":""));
      }
      section.append(ul);
    }
    article.append(section);
  }
  return article;
}
function showHistory() {
  if(!model)return;
  const target=$("c3-history-list");
  target.replaceChildren();
  const query=$("c3-history-filter").value.trim().toLocaleLowerCase();
  const found=model.history.filter(s=>(
    s.title+" "+s.date+" "+s.exercises.map(x=>x.name).join(" ")
  ).toLocaleLowerCase().includes(query));
  $("c3-history-count").textContent=found.length+" shown"+
    (model.workouts>model.shownWorkouts?" of "+model.workouts+" total workouts (latest "+
      model.shownWorkouts+" loaded)":"");
  if(!found.length){
    target.append(node("p","No matching private workouts.","note"));
    return;
  }
  for(const s of found) target.append(makeWorkoutCard(s));
}
function showMovements() {
  if(!model)return;
  const target=$("c3-movement-list");
  target.replaceChildren();
  const query=$("c3-movement-filter").value.trim().toLocaleLowerCase();
  const found=model.movements.filter(x=>x.name.toLocaleLowerCase().includes(query));
  $("c3-movement-count").textContent=found.length+
    " movement"+(found.length===1?"":"s")+" shown · "+model.favorites+" saved favorites";
  if(!found.length){
    target.append(node("p","No matching private movements.","note"));
    return;
  }
  for(const movement of found){
    const row=node("div","","movement");
    const info=node("div");
    info.append(node("div",movement.name,"movement-name"),
      node("div",movement.workouts+" workout"+(movement.workouts===1?"":"s")+
        " among recent history","smallnote"));
    row.append(info,node("span",movement.isFavorite?"★ Favorite":"Not a favorite",
      movement.isFavorite?"pill":"smallnote"));
    target.append(row);
  }
}
function selectTab(tab){
  if(!model || !["history","movements"].includes(tab))return;
  activeTab=tab;
  $("c3-tab-history").setAttribute("aria-selected",String(tab==="history"));
  $("c3-tab-movements").setAttribute("aria-selected",String(tab==="movements"));
  $("c3-history").hidden=tab!=="history";
  $("c3-movements").hidden=tab!=="movements";
  if(tab==="history")showHistory();
  else showMovements();
}
function showPrivate(snapshot,number){
  model=snapshot; revision=number;
  $("c3-workouts").textContent=String(model.workouts);
  $("c3-favorites").textContent=String(model.favorites);
  $("c3-meals").textContent=String(model.meals);
  $("c3-revision").textContent=String(number);
  $("c3-private").hidden=false;
  selectTab(activeTab);
}
$("c3-check").addEventListener("click",()=>{if(!busy)void checkAccount()});
$("c3-passphrase").addEventListener("input",renderGate);
$("c3-history-filter").addEventListener("input",showHistory);
$("c3-movement-filter").addEventListener("input",showMovements);
$("c3-tab-history").addEventListener("click",()=>selectTab("history"));
$("c3-tab-movements").addEventListener("click",()=>selectTab("movements"));
for(const id of ["c3-lock","c3-lock-open"])
  $(id).addEventListener("click",()=>lock("Private workout interface manually locked."));
$("c3-unlock").addEventListener("click",async()=>{
  if(busy || !authorized() || !compartmentExists)return;
  const passphrase=$("c3-passphrase").value;
  $("c3-passphrase").value="";
  if(!passphrase)return;
  const token=++generation, id=verifiedUser.id;
  busy=true; clearPrivate();renderGate();
  setStatus("Verifying account and decrypting private workout interface…");
  try {
    const opened=await openCompartment({
      storage:localStorage,userId:id,passphrase,
      reverify:()=>verify(id,token)
    });
    if(token!==generation)return;
    const snapshot=buildReadOnlyPrivateAppModel(opened.data);
    if(token!==generation || document.hidden || !authorized())return;
    showPrivate(snapshot,opened.revision);
    setStatus("Private History and Movements unlocked (encrypted revision "+
      opened.revision+"). Read only; no workout data was modified.","success");
  }catch(error){
    if(token===generation){
      clearPrivate();
      setStatus("Private viewer remains locked: "+(error?.message||"Unable to unlock"),"error");
    }
  }finally{
    if(token===generation){busy=false;renderGate();}
  }
});
window.addEventListener("blur",()=>{
  if(model || busy)lock("Private interface locked when the window lost focus.");
  else{
    $("c3-passphrase").value="";
    renderGate();
  }
});
document.addEventListener("visibilitychange",()=>{
  if(document.hidden)lock("Private interface locked when the tab was hidden.");
  else if(client && !busy)void checkAccount();
});
window.addEventListener("pagehide",()=>lock("Private interface locked on navigation."));
window.addEventListener("storage",event=>{
  if(event.key===null || event.key===AUTH_KEY || event.key===DEVICE_OWNER_KEY ||
     event.key?.startsWith("lift-journal-private-v2:")){
    lock("Account or encrypted history changed in another tab. Private interface locked.");
    if(client && !document.hidden)void checkAccount();
  }
});
async function init(){
  if(!allowedHost || !config?.url || !config?.publishableKey ||
    !config.testLoginEnabled || config.signupEnabled){
    setStatus("PRIVATE APP LOCKED: localhost verified test-login configuration required.","error");
    renderGate();return;
  }
  try{
    const { createClient }=
      await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm");
    client=createClient(config.url,config.publishableKey,{
      auth:{storageKey:AUTH_KEY,persistSession:true,autoRefreshToken:true,
        detectSessionInUrl:false,flowType:"pkce"}
    });
    client.auth.onAuthStateChange((event,session)=>{
      if(event==="SIGNED_OUT"){
        verifiedUser=null;compartmentExists=false;
        lock("Account signed out. Private History and Movements locked.");
      } else if(event==="SIGNED_IN" && verifiedUser?.id &&
                session?.user?.id!==verifiedUser.id){
        verifiedUser=null;compartmentExists=false;
        lock("Account changed. Private History and Movements locked.");
      } else if(event==="INITIAL_SESSION" && !verifiedUser && !busy){
        window.setTimeout(()=>{if(!busy)void checkAccount()},0);
      }
    });
    await checkAccount();
  }catch(error){
    verifiedUser=null;compartmentExists=false;
    clearPrivate();
    setStatus("PRIVATE APP LOCKED: account service unavailable. "+
      (error?.message||"Unknown error"),"error");
    renderGate();
  }
}
renderGate();
void init();
