// Run with: node --test tests/stage6c2b-workout-ui.test.mjs
// UI mock checks only. Cryptographic engine tests live in Stage 6B/6C2A suites.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildFictionalPrivateWorkout } from "../stage6c2b-workout-core.mjs";
const source=readFileSync(new URL("../stage6c2b-workout-ui.mjs",import.meta.url),"utf8");
function setup(account="test-user") {
 let js=source.replace(/^import[\s\S]*?from .*?;\n/gm,"")
   .replace('await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm")',
      "{createClient:()=>fakeClient}");
 js=js.replace(/\nrender\(\);\nvoid init\(\);\s*$/,"")+
 [
 "return {init,click:id=>$(id)._events.click(),",
 "input:(id,val)=>{$(id).value=val;$(id)._events.input?.();},",
 "setForm:()=>{",
 '$("b-date").value="2026-11-17";',
 '$("b-movement").value="Goblet Squat";',
 '$("b-weight").value="20";',
 '$("b-reps").value="12";',
 '$("b-sets").value="2";',
 '$("b-save-pass").value="test passphrase";render();},',
 'state:()=>({privateHidden:$("b-private").hidden,unlockHidden:$("b-unlock-area").hidden,',
 'status:$("b-status").textContent,workouts:$("b-workouts").textContent,',
 'favorites:$("b-favorites").textContent,revision:$("b-revision").textContent,',
 'reviewHidden:$("b-review-box").hidden}),',
 'authEvent:(event,user)=>client.notify(event,user)};'
 ].join("\n");
 const elems=new Map(),events={};
 const element=id=>{
  if(!elems.has(id))elems.set(id,{value:"",checked:false,disabled:false,
   hidden:false,textContent:"",dataset:{},_events:{},
   addEventListener(n,fn){this._events[n]=fn;},
   replaceChildren(){this.children=[];},
   append(child){(this.children??=[]).push(child);}});
  return elems.get(id);
 };
 const document={hidden:false,getElementById:element,
  addEventListener(n,fn){(events["doc:"+n]??=[]).push(fn);},
  createElement:tag=>element("new-"+tag+"-"+elems.size)};
 const window={LIFT_JOURNAL_AUTH:{url:"https://example.supabase.co",
  publishableKey:"test",testLoginEnabled:true,signupEnabled:false},
  addEventListener(n,fn){(events[n]??=[]).push(fn)},setTimeout(){}};
 const crypto={randomUUID:()=>"11111111-2222-4333-8444-555555555555"};
 const user={id:account,email:account+"@example.com"};
 const original={unit:"kg",sessions:{
  "w1":{name:"TEST workout one",scheduledDate:"2026-10-20",month:"2026-10",exercises:[]},
  "w2":{name:"TEST workout two",scheduledDate:"2026-10-21",month:"2026-10",exercises:[]}
 },favoriteMovements:["Goblet Squat","Lat Pulldown","TEST - Stage 6C2 Encrypted Favorite"],
 nutrition:{entries:{"2026-10-20":[{name:"TEST meal"}]}}};
 const compartment={data:JSON.parse(JSON.stringify(original)),revision:2,headRaw:"head-2"};
 let writes=0,authHandler=null,refresh=true;
 const fakeClient={auth:{
  async getSession(){return {data:{session:{user}},error:null}},
  async getUser(){
   if(writes && refresh){refresh=false;authHandler?.("TOKEN_REFRESHED",{user});}
   return {data:{user},error:null};
  },
  onAuthStateChange(fn){authHandler=fn}
 },notify:(event,user)=>authHandler?.(event,user?{user}:null)};
 const localStorage={getItem(){return null},setItem(){throw Error("Plaintext storage must never be written")}};
 const snapshot=data=>({workoutCount:Object.keys(data.sessions).length,
  favoriteCount:data.favoriteMovements.length,mealCount:1,unit:data.unit,
  sessions:Object.entries(data.sessions).map(([id,s])=>({
    id,name:s.name,date:s.scheduledDate,exercises:s.exercises.map(x=>x.name)}))
 });
 const open=async({reverify,userId})=>{
  assert.equal(await reverify(),userId);
  return {...compartment};
 };
 const commit=async({userId,reverify,data,expectedData,expectedHeadRaw})=>{
  assert.equal(await reverify(),userId);
  assert.equal(expectedHeadRaw,compartment.headRaw);
  assert.deepEqual(expectedData,compartment.data);
  writes++;
  compartment.data=JSON.parse(JSON.stringify(data));
  compartment.revision++;
  compartment.headRaw="head-"+compartment.revision;
  return {headRaw:compartment.headRaw,revision:compartment.revision};
 };
 const app=new Function("window","document","location","localStorage","navigator","crypto",
   "inspectCompartment","openCompartment","commitCompartment",
   "DEVICE_OWNER_KEY","deviceOwnerStatus","buildPrivateSnapshot",
   "buildFictionalPrivateWorkout","fakeClient",js)(
   window,document,{hostname:"127.0.0.1"},localStorage,{locks:{}},crypto,
   ()=>({exists:true}),open,commit,"owner-key",
   (_s,id)=>({status:id==="test-user"?"linked":"other-account"}),
   snapshot,buildFictionalPrivateWorkout,fakeClient);
 return {app,events,writes:()=>writes,original,compartment};
}
test("private workout view is locked before passphrase; reveals only verified owner's data",async()=>{
 const {app}=setup();
 await app.init();
 assert.equal(app.state().privateHidden,true);
 app.input("b-unlock-pass","test passphrase");
 await app.click("b-unlock");
 assert.equal(app.state().privateHidden,false);
 assert.equal(app.state().workouts,"2");
 assert.equal(app.state().favorites,"3");
 assert.equal(app.state().revision,"2");
});
test("inline workout review never writes and final confirmation saves one encrypted session",async()=>{
 const {app,writes,original,compartment}=setup();
 await app.init();app.input("b-unlock-pass","test passphrase");await app.click("b-unlock");
 app.setForm();
 await app.click("b-review");
 assert.equal(writes(),0);
 assert.equal(app.state().reviewHidden,false);
 await app.click("b-confirm");
 assert.equal(writes(),1);
 assert.equal(app.state().workouts,"3");
 assert.equal(app.state().favorites,"3");
 assert.equal(app.state().revision,"3");
 assert.equal(Object.keys(original.sessions).length,2);
 assert.equal(Object.keys(compartment.data.sessions).length,3);
});
test("window blur hides decrypted workout names and disables review",async()=>{
 const {app,events}=setup();
 await app.init();app.input("b-unlock-pass","test passphrase");await app.click("b-unlock");
 assert.equal(app.state().privateHidden,false);
 for(const fn of events.blur||[])fn();
 assert.equal(app.state().privateHidden,true);
});
test("Admin account cannot access the linked Test User's compartment",async()=>{
 const {app}=setup("admin");
 await app.init();
 assert.equal(app.state().unlockHidden,true);
 assert.equal(app.state().privateHidden,true);
 assert.match(app.state().status,/PRIVATE WORKOUT LOCKED/);
});
test("account sign-out locks decrypted data immediately",async()=>{
 const {app}=setup();
 await app.init();app.input("b-unlock-pass","test passphrase");await app.click("b-unlock");
 app.authEvent("SIGNED_OUT",null);
 assert.equal(app.state().privateHidden,true);
});
