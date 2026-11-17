// Run: node --test tests/stage6c2b-workout-core.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildFictionalPrivateWorkout, TEST_MOVEMENTS } from "../stage6c2b-workout-core.mjs";
const fixture=JSON.parse(readFileSync(new URL("./fixtures/lift-journal-stage3-device-backup.json", import.meta.url),"utf8")).data;
const id="test-6c2b-11111111-2222-4333-8444-555555555555";
const values = () => ({data:fixture,date:"2026-11-17",movement:"Goblet Squat",
  weight:"25.5",reps:"12",setCount:"3",id,now:"2026-11-17T22:00:00.000Z"});
test("creates exactly one compatible completed workout while leaving all original state unchanged",()=>{
 const before=JSON.stringify(fixture);
 const {data,session}=buildFictionalPrivateWorkout(values());
 assert.equal(JSON.stringify(fixture),before);
 assert.equal(Object.keys(data.sessions).length,2);
 assert.equal(data.unit,"kg");
 assert.deepEqual(data.favoriteMovements,["Goblet Squat","Lat Pulldown"]);
 assert.deepEqual(data.nutrition,fixture.nutrition);
 assert.equal(session.month,"2026-11");
 assert.equal(session.scheduledDate,"2026-11-17");
 assert.equal(session.unit,"kg");
 assert.equal(session.finished,values().now);
 assert.equal(session.exercises[0].name,"Goblet Squat");
 assert.equal(session.exercises[0].sets.length,3);
 assert.deepEqual(session.exercises[0].sets[0],{reps:"12",weight:"25.5",done:true});
});
test("rejects invalid calendar dates, preventing malformed history",()=>{
 for(const bad of ["2026-02-30","2026-13-01","11/17/2026","","2026-1-3"])
   assert.throws(()=>buildFictionalPrivateWorkout({...values(),date:bad}),/date/);
});
test("only known fictional test movements may be added",()=>{
 assert.deepEqual(TEST_MOVEMENTS,["Goblet Squat","Lat Pulldown","Dumbbell Bench Press"]);
 assert.throws(()=>buildFictionalPrivateWorkout({...values(),movement:"Custom Arbitrary"}),/fictional test movements/);
});
test("set count and reps have strict finite bounds",()=>{
 for(const setCount of ["0","-1","1.5","6","1e3",""])
   assert.throws(()=>buildFictionalPrivateWorkout({...values(),setCount}),/Sets/);
 for(const reps of ["0","101","2.3","NaN",""])
   assert.throws(()=>buildFictionalPrivateWorkout({...values(),reps}),/Reps/);
});
test("weights cannot contain formulas, infinity, negative values, or more than two decimals",()=>{
 for(const weight of ["-1","Infinity","1e3","20.005","10000","10;alert(1)"])
   assert.throws(()=>buildFictionalPrivateWorkout({...values(),weight}),/Weight/);
 assert.equal(buildFictionalPrivateWorkout({...values(),weight:"0"}).session.exercises[0].sets[0].weight,"0");
});
test("a workout ID collision must never replace existing workout data",()=>{
 const data=JSON.parse(JSON.stringify(fixture));
 data.sessions[id]={name:"KEEP EXISTING WORKOUT"};
 assert.throws(()=>buildFictionalPrivateWorkout({...values(),data}),/already exists/);
 assert.equal(data.sessions[id].name,"KEEP EXISTING WORKOUT");
});
test("invalid compartment data stops before preparing new records",()=>{
 assert.throws(()=>buildFictionalPrivateWorkout({...values(),data:{unit:"kg",sessions:[]}}),/invalid/);
 assert.throws(()=>buildFictionalPrivateWorkout({...values(),data:{unit:"broken",sessions:{}}}),/invalid/);
});
test("private workout test never accesses old plaintext key or browser storage",()=>{
 const source=readFileSync(new URL("../stage6c2b-workout-ui.mjs", import.meta.url),"utf8");
 const page=readFileSync(new URL("../private-workout-test.html", import.meta.url),"utf8");
 assert.match(source,/await commitCompartment\(/);
 assert.match(source,/await openCompartment\(/);
 assert.match(source,/getUser\(\)/);
 assert.match(source,/window\.addEventListener\("blur"/);
 assert.match(source,/document\.addEventListener\("visibilitychange"/);
 assert.doesNotMatch(source,/localStorage\.(?:setItem|removeItem|clear)\s*\(/);
 assert.doesNotMatch(source,/localStorage\.getItem\(\s*["']lift-journal-v1["']/);
 assert.doesNotMatch(source,/fetch\(/);
 assert.match(page,/NOT the regular Lift Journal app/);
});
