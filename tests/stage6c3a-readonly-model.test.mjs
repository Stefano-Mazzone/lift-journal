// Run: node --test tests/stage6c3a-readonly-model.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildReadOnlyPrivateAppModel, READ_ONLY_SESSION_LIMIT } from "../stage6c3a-readonly-model.mjs";
const input=JSON.parse(readFileSync(new URL("./fixtures/lift-journal-stage3-device-backup.json",import.meta.url),"utf8")).data;
const fixture=()=>JSON.parse(JSON.stringify(input));
test("builds frozen read-only workout details without changing source model",()=>{
 const source=fixture(), before=JSON.stringify(source);
 const model=buildReadOnlyPrivateAppModel(source);
 assert.equal(model.workouts,1);
 assert.equal(model.favorites,2);
 assert.equal(model.meals,1);
 assert.equal(model.unit,"kg");
 assert.equal(model.history[0].title,"TEST - Already on destination device");
 assert.equal(model.history[0].exercises[0].sets[0].weight,"18");
 assert.equal(model.history[0].exercises[0].sets[0].reps,"12");
 assert.equal(model.history[0].exercises[0].sets[0].done,true);
 assert.equal(JSON.stringify(source),before);
 assert.ok(Object.isFrozen(model));
 assert.ok(Object.isFrozen(model.history[0].exercises[0].sets[0]));
});
test("preserves all three fictional favorites and includes favorites not yet logged",()=>{
 const source=fixture();
 source.favoriteMovements.push("TEST - Stage 6C2 Encrypted Favorite");
 const model=buildReadOnlyPrivateAppModel(source);
 assert.equal(model.favorites,3);
 assert.equal(model.movements.find(x=>x.name==="TEST - Stage 6C2 Encrypted Favorite").isFavorite,true);
 assert.equal(model.movements.find(x=>x.name==="Lat Pulldown").workouts,0);
});
test("uses most recent completed workout first with date, units, and set details",()=>{
 const source=fixture();
 source.sessions["test-6c2b-11111111-2222-4333-8444-555555555555"]={
  name:"TEST - Stage 6C2B Private Workout",month:"2026-11",day:0,
  scheduledDate:"2026-11-18",started:"2026-11-18T12:00:00.000Z",
  finished:"2026-11-18T12:10:00.000Z",unit:"kg",
  exercises:[{name:"Goblet Squat",sets:[{weight:"20",reps:"10",done:true}]}]
 };
 const model=buildReadOnlyPrivateAppModel(source);
 assert.equal(model.workouts,2);
 assert.equal(model.history[0].date,"2026-11-18");
 assert.equal(model.history[0].completed,true);
 assert.equal(model.history[0].exercises[0].sets[0].weight,"20");
 assert.equal(model.movements.find(x=>x.name==="Goblet Squat").workouts,2);
});
test("does not mutate or execute malicious-looking text",()=>{
 const source=fixture();
 source.sessions["device-only-workout-001"].name="<script>alert(1)</script>";
 source.sessions["device-only-workout-001"].exercises[0].name="Evil\u0000movement";
 const model=buildReadOnlyPrivateAppModel(source);
 assert.equal(model.history[0].title,"<script>alert(1)</script>");
 assert.equal(model.history[0].exercises[0].name,"Evil movement");
 assert.ok(!model.history[0].exercises[0].name.includes("\u0000"));
});
test("rejects invalid encrypted data before displaying it",()=>{
 assert.throws(()=>buildReadOnlyPrivateAppModel({sessions:[],unit:"kg"}),/invalid/);
 assert.throws(()=>buildReadOnlyPrivateAppModel({sessions:{},unit:"gal"}),/invalid/);
 const bad=fixture();bad.sessions["device-only-workout-001"].exercises[0].sets=[null];
 assert.throws(()=>buildReadOnlyPrivateAppModel(bad),/malformed/);
});
test("uses a safe 100-workout display limit while keeping total count",()=>{
 const source=fixture();
 source.sessions={};
 for(let i=0;i<125;i++)
  source.sessions["test-"+i]={name:"Workout "+i,scheduledDate:"2026-11-18",
   exercises:[{name:"Goblet Squat",sets:[]}]};
 const model=buildReadOnlyPrivateAppModel(source);
 assert.equal(model.workouts,125);
 assert.equal(model.shownWorkouts,READ_ONLY_SESSION_LIMIT);
 assert.equal(model.history.length,100);
});
test("counts completed and in-progress workouts without generating new records",()=>{
 const source=fixture();
 source.sessions["device-only-workout-001"].finished=null;
 const model=buildReadOnlyPrivateAppModel(source);
 assert.equal(model.history[0].completed,false);
 assert.equal(Object.keys(source.sessions).length,1);
});
test("is a pure read-only model with no browser or storage access",()=>{
 const source=readFileSync(new URL("../stage6c3a-readonly-model.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(source,/\blocalStorage\b|\bfetch\s*\(|\bdocument\b|\bwindow\b|\bsetItem\s*\(/);
});
