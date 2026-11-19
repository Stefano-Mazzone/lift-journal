// node --test tests/stage6c2-storage-lab-ui.test.mjs
// Simulated inline user confirmation, account refresh and privacy locking.
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
 'clickReview:()=> $("v2-create")._events.click(),',
 'clickConfirm:()=> $("v2-create-final")._events.click(),',
 'clickCancel:()=> $("v2-create-cancel")._events.click(),',
 'setUnlocked(){unlockedData={unit:"kg",sessions:{}};$("v2-data").hidden=false;},',
 'getState(){return {message:$("v2-status").textContent,created,busy,seq,historyHidden:$("v2-data").hidden,',
 'reviewVisible:!$("v2-create-confirmation").hidden,createPass:$("v2-create-pass").value};},',
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
 // Native confirm is forbidden in Stage 6C2A. Any code path using it fails the test.
 const confirm=()=>{throw Error("Unexpected native confirm dialog.");};
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
test("inline review makes no writes, then final click creates despite same-owner auth refresh",async()=>{
 const {lab,counts}=mockLab();
 await lab.initialize();
 lab.setReady();
 await lab.clickReview();
 assert.equal(counts(),0);
 assert.equal(lab.getState().created,false);
 assert.equal(lab.getState().reviewVisible,true);
 assert.match(lab.getState().message,/Review prepared/);
 await lab.clickConfirm();
 assert.equal(counts(),1);
 assert.equal(lab.getState().created,true);
 assert.equal(lab.getState().busy,false);
 assert.match(lab.getState().message,/created and verified \(revision 1\)/);
});
test("cancelling inline review makes no encrypted writes",async()=>{
 const {lab,counts}=mockLab();
 await lab.initialize();
 lab.setReady();
 await lab.clickReview();
 await lab.clickCancel();
 assert.equal(counts(),0);
 assert.equal(lab.getState().created,false);
 assert.equal(lab.getState().reviewVisible,false);
 assert.equal(lab.getState().createPass,"");
});
test("window blur without exposed decrypted data preserves the creation success result",async()=>{
 const {lab,counts,listeners}=mockLab();
 await lab.initialize();
 lab.setReady();
 await lab.clickReview();
 await lab.clickConfirm();
 assert.equal(counts(),1);
 for(const fn of listeners.blur||[])fn();
 assert.match(lab.getState().message,/created and verified \(revision 1\)/);
 assert.equal(lab.getState().created,true);
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
