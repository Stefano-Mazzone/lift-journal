// node --test tests/stage6c2-storage-lab-ui.test.mjs
// Simulated native confirmation-window blur and same-owner auth token refresh.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const original=readFileSync(new URL("../stage6c2-storage-lab.mjs",import.meta.url),"utf8");
function mockLab(){
 let src=original.replace(/^import[\s\S]*?from .*?;\n/gm,"");
 src=src.replace('await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm")',
  "{createClient:()=>fakeClient}");
 src=src.replace(/\nrender\(\);\nvoid initialize\(\);\s*$/,"")+
 [
 'return {initialize,',
 'setReady(){savedLegacyBackup=true;savedEncryptedBackup=true;',
 '$("v2-ack").checked=true;$("v2-create-pass").value="fictional passphrase";render();},',
 'clickCreate:()=> $("v2-create")._events.click(),',
 'setUnlocked(){unlockedData={unit:"kg",sessions:{}};$("v2-data").hidden=false;},',
 'getState(){return {message:$("v2-status").textContent,created,busy,seq,historyHidden:$("v2-data").hidden};},',
 'authEvent:(event,who)=>fakeClient.notify(event,who)};'
 ].join("\n");
 const elements=new Map(),listeners={};
 const element=id=>{
  if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,checked:false,
   value:"",textContent:"",dataset:{},_events:{},
   addEventListener(name,fn){this._events[name]=fn;},replaceChildren(){},append(){}});
  return elements.get(id);
 };
 const document={hidden:false,getElementById:element,
  addEventListener(n,fn){(listeners["doc:"+n]??=[]).push(fn);},
  createElement:tag=>element("new-"+tag)};
 const window={LIFT_JOURNAL_AUTH:{url:"https://example.supabase.co",
  publishableKey:"test",testLoginEnabled:true,signupEnabled:false},
  addEventListener(n,fn){(listeners[n]??=[]).push(fn);},setTimeout(){}};
 const ID="test-owner",user={id:ID,email:"test@example.com"},store=new Map();
 store.set("lift-journal-sync-device-owner-v1",JSON.stringify({version:1,
  userId:ID,state:"active",createdAt:"2026-11-01T00:00:00.000Z",
  updatedAt:"2026-11-01T00:00:00.000Z"}));
 const localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
 let authCallback=null,oneRefresh=true,creates=0;
 const fakeClient={auth:{
  onAuthStateChange(fn){authCallback=fn;},
  async getSession(){return {data:{session:{user}},error:null}},
  async getUser(){
   if(creates && oneRefresh){oneRefresh=false;authCallback("TOKEN_REFRESHED",{user});}
   return {data:{user},error:null};
  }
 },notify:(event,who)=>authCallback?.(event,who?{user:who}:null)};
 const confirm=()=>{for(const fn of listeners.blur||[])fn();return true};
 const createCompartment=async({reverify})=>{
  creates++;assert.equal(await reverify(),ID);return {revision:1,workouts:2,favorites:2};
 };
 const lab=new Function("window","document","location","localStorage","navigator",
  "confirm","createCompartment","openCompartment","commitCompartment",
  "compartmentKeys","inspectCompartment","latestVault","DEVICE_DATA_KEY",
  "DEVICE_OWNER_KEY","deviceOwnerStatus","buildPrivateSnapshot","fakeClient",src)(
  window,document,{hostname:"127.0.0.1"},localStorage,{locks:{}},
  confirm,createCompartment,null,null,null,()=>({exists:false}),null,
  "lift-journal-v1","lift-journal-sync-device-owner-v1",
  (_s,who)=>({status:who===ID?"linked":"other-account"}),()=>null,fakeClient
 );
 return {lab,listeners,counts:()=>creates};
}
test("native confirmation blur and same-user auth refresh do not abort safe encrypted creation",async()=>{
 const {lab,counts}=mockLab();
 await lab.initialize();
 lab.setReady();
 await lab.clickCreate();
 assert.equal(counts(),1);
 assert.equal(lab.getState().created,true);
 assert.equal(lab.getState().busy,false);
 assert.match(lab.getState().message,/created and verified \(revision 1\)/);
});
test("real window blur still hides decrypted private information",async()=>{
 const {lab,listeners}=mockLab();
 await lab.initialize();
 lab.setUnlocked();
 assert.equal(lab.getState().historyHidden,false);
 for(const fn of listeners.blur||[])fn();
 assert.equal(lab.getState().historyHidden,true);
});
test("signout auth event still hides decrypted private information",async()=>{
 const {lab}=mockLab();
 await lab.initialize();
 lab.setUnlocked();
 lab.authEvent("SIGNED_OUT",null);
 assert.equal(lab.getState().historyHidden,true);
 assert.match(lab.getState().message,/Signed-out or different test account/);
});
