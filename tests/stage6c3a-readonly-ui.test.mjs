// Run: node --test tests/stage6c3a-readonly-ui.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildReadOnlyPrivateAppModel } from "../stage6c3a-readonly-model.mjs";
const source=readFileSync(new URL("../stage6c3a-readonly-ui.mjs",import.meta.url),"utf8");
function setup(account="test-user") {
 const events={}; const all=new Map(); let authListener=null;let active=account;
 const element=id=>{
   if(!all.has(id)) all.set(id,{id,value:"",hidden:false,disabled:false,
     textContent:"",dataset:{},className:"",children:[],attributes:{},_events:{},
     setAttribute(name,val){this.attributes[name]=val;},
     addEventListener(name,fn){this._events[name]=fn;},
     replaceChildren(){this.children=[];},
     append(...items){this.children.push(...items);}
   });
   return all.get(id);
 };
 const doc={hidden:false,
   getElementById:element,
   createElement:tag=>element("created-"+tag+"-"+all.size),
   addEventListener(name,fn){(events["doc:"+name]??=[]).push(fn)}
 };
 const window={LIFT_JOURNAL_AUTH:{url:"https://example.supabase.co",
   publishableKey:"test",testLoginEnabled:true,signupEnabled:false},
   setTimeout(){},
   addEventListener(name,fn){(events[name]??=[]).push(fn)}
 };
 const storage={getItem(){return null},
   setItem(){throw Error("No workout writes allowed")}};
 const original={
   unit:"kg",sessions:{
     older:{name:"TEST - Already on destination device",scheduledDate:"2026-10-24",
       finished:"2026-10-24T12:00:00.000Z",exercises:[{name:"Goblet Squat",
         sets:[{weight:"18",reps:"12",done:true}]}]},
     middle:{name:"TEST - Imported From Backup",scheduledDate:"2026-10-25",
       finished:"2026-10-25T12:00:00.000Z",exercises:[{name:"Lat Pulldown",
         sets:[{weight:"30",reps:"10",done:true}]}]},
     recent:{name:"TEST - Stage 6C2B Private Workout",scheduledDate:"2026-11-18",
       finished:"2026-11-18T12:00:00.000Z",exercises:[{name:"Goblet Squat",
         sets:[{weight:"20",reps:"10",done:true}]}]}
   },
   favoriteMovements:["Goblet Squat","Lat Pulldown","TEST - Stage 6C2 Encrypted Favorite"],
   nutrition:{entries:{"2026-10-24":[{id:"meal-1",name:"TEST meal"}]}}
 };
 const fakeClient={auth:{
   async getSession(){return {data:{session:active?{user:{id:active}}:null},error:null}},
   async getUser(){return {data:{user:active?{id:active,email:active+"@example.com"}:null},error:null}},
   onAuthStateChange(fn){authListener=fn}
 }};
 let unlockCount=0;
 const open=async({userId,passphrase,reverify})=>{
   await reverify();
   if(passphrase==="wrong")throw Error("Unable to unlock vault.");
   unlockCount++;
   return {data:JSON.parse(JSON.stringify(original)),revision:3,headRaw:"head-3"};
 };
 const code=source.replace(/^import[\s\S]*?from .*?;\n/gm,"")
   .replace('await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm")',
     "{createClient:()=>fakeClient}")
   .replace(/\nrenderGate\(\);\nvoid init\(\);\s*$/,"")+
   "\nreturn {init,click:id=>$(id)._events.click(),"+
   "input:(id,value)=>{$(id).value=value;$(id)._events.input?.();},"+
   "state:()=>({locked:$('c3-private').hidden,unlockHidden:$('c3-unlock-area').hidden,"+
   "status:$('c3-status').textContent,workouts:$('c3-workouts').textContent,"+
   "favorites:$('c3-favorites').textContent,revision:$('c3-revision').textContent,"+
   "historyHidden:$('c3-history').hidden,movementsHidden:$('c3-movements').hidden}),"+
   "signout:()=>{verifiedUser=null;compartmentExists=false;lock('Account signed out.')}, "+
   "};";
 const app=new Function("window","document","location","localStorage",
    "inspectCompartment","openCompartment","DEVICE_OWNER_KEY","deviceOwnerStatus",
    "buildReadOnlyPrivateAppModel","fakeClient",code)(
    window,doc,{hostname:"127.0.0.1"},storage,
    ()=>({exists:true}),open,"device-owner",
    (_storage,id)=>({status:id==="test-user"?"linked":"other-account"}),
    buildReadOnlyPrivateAppModel,fakeClient);
 const flatten=n=>[n.textContent,...(n.children??[]).flatMap(flatten)].join(" ");
 return {app,events,doc,element,flatten,original,
    setActive:id=>{active=id;authListener?.(id?"SIGNED_IN":"SIGNED_OUT",id?{user:{id}}:null)},
    unlockCount:()=>unlockCount};
}
test("starts with all private data hidden before passphrase verification",async()=>{
 const {app}=setup(); await app.init();
 assert.equal(app.state().locked,true);
 assert.equal(app.state().unlockHidden,false);
 assert.equal(app.state().status.includes("compartment found"),true);
});
test("owner passphrase opens revision 3 and renders real History & Movements",async()=>{
 const {app,element,flatten,unlockCount}=setup();
 await app.init();
 app.input("c3-passphrase","correct test passphrase");
 await app.click("c3-unlock");
 assert.equal(app.state().locked,false);
 assert.equal(app.state().workouts,"3");
 assert.equal(app.state().favorites,"3");
 assert.equal(app.state().revision,"3");
 assert.equal(unlockCount(),1);
 assert.match(flatten(element("c3-history-list")),/Stage 6C2B Private Workout/);
 assert.match(flatten(element("c3-history-list")),/20 kg × 10 reps/);
 await app.click("c3-tab-movements");
 assert.equal(app.state().historyHidden,true);
 assert.equal(app.state().movementsHidden,false);
 assert.match(flatten(element("c3-movement-list")),/★ Favorite/);
});
test("history and movement filters render matching records only",async()=>{
 const {app,element,flatten}=setup();
 await app.init();app.input("c3-passphrase","correct");await app.click("c3-unlock");
 app.input("c3-history-filter","Stage 6C2B");
 assert.equal(element("c3-history-list").children.length,1);
 await app.click("c3-tab-movements");
 app.input("c3-movement-filter","TEST - Stage 6C2 Encrypted Favorite");
 assert.equal(element("c3-movement-list").children.length,1);
 assert.match(flatten(element("c3-movement-list")),/Favorite/);
});
test("Admin account is denied and receives no decrypt control or workout details",async()=>{
 const {app,element}=setup("admin");
 await app.init();
 assert.equal(app.state().unlockHidden,true);
 assert.equal(app.state().locked,true);
 assert.match(app.state().status,/PRIVATE APP LOCKED/);
 assert.equal(element("c3-history-list").children.length,0);
});
test("window blur hides decrypted workout records and clears plaintext nodes",async()=>{
 const {app,events,element}=setup();
 await app.init();app.input("c3-passphrase","correct");await app.click("c3-unlock");
 for(const fn of events.blur??[])fn();
 assert.equal(app.state().locked,true);
 assert.equal(element("c3-history-list").children.length,0);
 assert.equal(element("c3-movement-list").children.length,0);
});
test("signing out locks immediately and prevents further private viewing",async()=>{
 const {app,setActive}=setup();
 await app.init();app.input("c3-passphrase","correct");await app.click("c3-unlock");
 setActive(null);
 assert.equal(app.state().locked,true);
 assert.equal(app.state().unlockHidden,true);
});
test("private compartment changes in another tab lock the page",async()=>{
 const {app,events}=setup();
 await app.init();app.input("c3-passphrase","correct");await app.click("c3-unlock");
 for(const fn of events.storage??[])fn({key:"lift-journal-private-v2:test-user:head"});
 assert.equal(app.state().locked,true);
});
test("wrong passphrase displays no private history",async()=>{
 const {app}=setup();
 await app.init();app.input("c3-passphrase","wrong");await app.click("c3-unlock");
 assert.equal(app.state().locked,true);
 assert.match(app.state().status,/Unable to unlock vault/);
});
test("standalone interface contains no plaintext legacy reads, app writes or HTML injection",()=>{
 const html=readFileSync(new URL("../private-app-preview.html",import.meta.url),"utf8");
 assert.doesNotMatch(source,/localStorage\.(?:setItem|removeItem|clear)\s*\(/);
 assert.doesNotMatch(source,/localStorage\.getItem\(\s*["']lift-journal-v1["']/);
 assert.doesNotMatch(source,/\.innerHTML\s*=/);
 assert.doesNotMatch(html,/<script[^>]+src=["']\.\/stage5-account-panel/);
 assert.match(html,/READ ONLY/i);
});
