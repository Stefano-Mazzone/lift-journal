// node --test tests/stage6c-private-viewer.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPrivateSnapshot, canOpenPrivateVault } from "../stage6c-private-core.mjs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const fixture = JSON.parse(read("tests/fixtures/lift-journal-stage3-device-backup.json")).data;

test("private preview preserves displayed counts and safely summarizes complete fictional history", () => {
  const view = buildPrivateSnapshot(fixture);
  assert.equal(view.workoutCount, 1);
  assert.equal(view.favoriteCount, 2);
  assert.equal(view.mealCount, 1);
  assert.equal(view.unit, "kg");
  assert.equal(view.sessions.length, 1);
  assert.equal(view.sessions[0].name, "TEST - Already on destination device");
  assert.deepEqual(view.favorites, ["Goblet Squat", "Lat Pulldown"]);
});
test("unknown or malicious text stays plain and controls are stripped", () => {
  const original = { unit:"lb", sessions:{"one":{
    name:"<img src=x onerror=alert(1)>\nTEST", exercises:[{name:"<script>evil</script>"}]
  }}, favoriteMovements:["<b>Test</b>", "<b>Test</b>"] };
  const view = buildPrivateSnapshot(original);
  assert.match(view.sessions[0].name, /<img/); // only ever injected via textContent
  assert.doesNotMatch(view.sessions[0].name, /\n/);
  assert.equal(view.favorites.length, 1);
});
test("summary is detached from the mutable decrypted input object", () => {
  const copy = JSON.parse(JSON.stringify(fixture));
  const view = buildPrivateSnapshot(copy);
  copy.sessions["device-only-workout-001"].name = "CHANGED";
  copy.favoriteMovements.length = 0;
  assert.equal(view.sessions[0].name,"TEST - Already on destination device");
  assert.equal(view.favoriteCount,2);
  assert.ok(Object.isFrozen(view));
});
test("invalid data structures fail without preview", () => {
  assert.throws(() => buildPrivateSnapshot({sessions:[],unit:"kg"}),/malformed/);
  assert.throws(() => buildPrivateSnapshot({sessions:{x:null},unit:"kg"}),/malformed/);
  assert.throws(() => buildPrivateSnapshot({sessions:{},unit:"invalid"}),/malformed/);
});
test("other signed-in account cannot unlock an owner's encrypted copy", () => {
  const owner = {verifiedId:"test-user",displayedId:"test-user",
    linkedToDevice:true,encryptedOwnerId:"test-user"};
  assert.equal(canOpenPrivateVault(owner),true);
  assert.equal(canOpenPrivateVault({...owner,verifiedId:"admin"}),false);
  assert.equal(canOpenPrivateVault({...owner,encryptedOwnerId:"admin"}),false);
  assert.equal(canOpenPrivateVault({...owner,linkedToDevice:false}),false);
});
test("viewer uses encrypted vault only and includes no plain-history reads or write operations", () => {
  const viewer = read("stage6c-private-viewer.mjs");
  const html = read("private-preview.html");
  const account = read("stage5-account-panel.mjs");
  const app = read("index.html");
  assert.match(viewer,/latestVault\(localStorage, currentId\)/);
  assert.match(viewer,/await verifiedUser\(currentId\)/);
  assert.match(viewer,/openVault\(/);
  assert.match(viewer,/document\.hidden/);
  assert.match(viewer,/visibilitychange/);
  assert.match(viewer,/pagehide/);
  assert.match(viewer,/onAuthStateChange/);
  assert.match(viewer,/replaceChildren\(\)/);
  assert.match(viewer,/\.textContent/);
  assert.doesNotMatch(viewer,/localStorage\.getItem\(["']lift-journal-v1["']\)/);
  assert.doesNotMatch(viewer,/localStorage\.(?:setItem|removeItem|clear)\s*\(/);
  assert.doesNotMatch(viewer,/\.from\(["']workouts["']\)/);
  assert.match(html,/STAGE 6C1/);
  assert.match(html,/This is not full account isolation yet/);
  assert.match(app,/id="lj6c-private-link"/);
  assert.match(account,/privateLink\.hidden = !authenticated/);
});
test("viewer scripts retain expected syntax", () => {
  const viewer = read("stage6c-private-viewer.mjs");
  const core = read("stage6c-private-core.mjs");
  assert.doesNotThrow(() => new Function(
    viewer.replace(/^import .*?;\n/gm, "").replace(/^export /gm, "")
  ));
  assert.doesNotThrow(() => new Function(core.replace(/^export /gm, "")));
});
