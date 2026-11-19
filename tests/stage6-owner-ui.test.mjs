// node --test tests/stage6-owner-ui.test.mjs
// Mock DOM safety tests. No real Supabase calls, user data or browser storage.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEVICE_OWNER_KEY, DEVICE_DATA_KEY, deviceOwnerStatus, bindDeviceOwner,
  suspendDeviceOwnerAfterImport
} from "../stage6-device-owner.mjs";
import { makeSafetyBackup } from "../cloud-sync-core.mjs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const app = read("index.html");
const accountSrc = read("stage5-account-panel.mjs");
const backup = JSON.parse(read("tests/fixtures/lift-journal-stage3-device-backup.json")).data;
const fixtureRaw = JSON.stringify(backup);
const clone = obj => JSON.parse(JSON.stringify(obj));

function harness() {
  const htmlFnStart = app.indexOf("function stage5AccountPanel()");
  const htmlFnEnd = app.indexOf("function settings(){", htmlFnStart);
  const html = new Function(app.slice(htmlFnStart, htmlFnEnd) + "\nreturn stage5AccountPanel();")();
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const nodes = Object.fromEntries(ids.map(id => [id, {
    id, checked:false, disabled:false, hidden:false, textContent:"", dataset:{},
    closest(selector){return selector === "#lj-account-panel" ? {} : null}
  }]));
  const listeners = {};
  const saved = [];
  const doc = {
    getElementById(id) { return nodes[id] || null; },
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
    createElement(tag) {
      if (tag !== "a") throw Error("Unexpected dynamic element");
      return {
        download:"", href:"", click(){saved.push(this.download)}, remove(){}
      };
    },
    body:{append(){}}
  };
  const values = new Map([[DEVICE_DATA_KEY, fixtureRaw]]);
  const storage = {
    getItem(k){return values.has(k) ? values.get(k) : null},
    setItem(k,v){values.set(k,v)},
    removeItem(k){values.delete(k)}
  };
  const user = { id:"test-user-id", email:"test@example.com" };
  const win = {
    LIFT_JOURNAL_AUTH:{testLoginEnabled:true, signupEnabled:false},
    addEventListener(name,fn){(listeners[name] ||= []).push(fn)},
    setTimeout(){},
    confirm(){return true}
  };
  const url = { createObjectURL:()=>"blob:test",revokeObjectURL(){} };
  const widget = { mount(){},reset(){} };
  const simpleSrc = accountSrc.replace(/^import \{[\s\S]*?\} from "[^"]+";\s*/gm, "")
    .replace(/renderAccount\(\);\s*void initialize\(\);\s*$/, "");
  const api = new Function(
    "window","document","location","localStorage","URL","Blob",
    "createSettingsManualSync","createSettingsVaultPreview","makeSafetyBackup","DEVICE_OWNER_KEY",
    "DEVICE_DATA_KEY","deviceOwnerStatus","bindDeviceOwner","mockClient",
    simpleSrc +
    "\nreturn { renderAccount,setUser:v=>{currentUser=v;initialized=true;client=mockClient;} };"
  )(win, doc, {hostname:"127.0.0.1"}, storage, url, Blob,
    () => widget, () => widget, makeSafetyBackup, DEVICE_OWNER_KEY, DEVICE_DATA_KEY,
    deviceOwnerStatus, bindDeviceOwner,
    {auth:{async getUser(){return {data:{user},error:null}}}});
  const click = async id => {
    const el = nodes[id];
    for (const handler of listeners.click || []) {
      await handler({target:{
        id:el.id,
        closest(selector){return selector.includes("#" + id) ? el : null}
      }});
    }
  };
  api.setUser(user);
  api.renderAccount();
  return { api, nodes, storage, values, saved, click, user, listeners };
}
test("new browser cannot sync until explicitly linked", () => {
  const h = harness();
  assert.equal(deviceOwnerStatus(h.storage,h.user.id).status,"unclaimed");
  assert.equal(h.nodes["lj-device-owner-panel"].hidden,false);
  assert.equal(h.nodes["lj-device-owner-actions"].hidden,false);
  assert.equal(h.nodes["lj-owner-backup"].disabled,false);
  assert.equal(h.nodes["lj-owner-claim"].disabled,true);
});
test("owner backup + check + confirmation links without modifying workout data", async () => {
  const h = harness();
  await h.click("lj-owner-backup");
  assert.equal(h.saved.length,1);
  assert.match(h.saved[0], /^lift-journal-ACCOUNT-LINK-SAFETY-BACKUP-/);
  assert.equal(h.nodes["lj-owner-ack"].disabled,false);
  assert.equal(h.nodes["lj-owner-claim"].disabled,true);
  h.nodes["lj-owner-ack"].checked=true;
  for (const fn of h.listeners.change || []) fn({target:h.nodes["lj-owner-ack"]});
  assert.equal(h.nodes["lj-owner-claim"].disabled,false);
  await h.click("lj-owner-claim");
  assert.equal(deviceOwnerStatus(h.storage,h.user.id).status,"linked");
  assert.equal(h.values.get(DEVICE_DATA_KEY),fixtureRaw);
  assert.equal(h.nodes["lj-device-owner-actions"].hidden,true);
  assert.equal(h.nodes["lj-device-owner-message"].dataset.kind,"success");
});
test("account switch leaves original owner and workouts untouched and locks approval", () => {
  const h = harness();
  bindDeviceOwner({storage:h.storage,verifiedId:h.user.id,
    expectedData:fixtureRaw,expectedOwnerRaw:null,now:"2026-10-29T00:00:00Z"});
  h.api.setUser({id:"another-test-id", email:"other@example.com"});
  h.api.renderAccount();
  assert.equal(h.nodes["lj-device-owner-actions"].hidden,true);
  assert.match(h.nodes["lj-device-owner-message"].textContent,/ANOTHER account/);
  assert.equal(h.values.get(DEVICE_DATA_KEY),fixtureRaw);
  assert.equal(deviceOwnerStatus(h.storage,h.user.id).status,"linked");
});
test("native Import Backup action suspends ownership BEFORE replacing local data", () => {
  const h = harness();
  bindDeviceOwner({storage:h.storage,verifiedId:h.user.id,
    expectedData:fixtureRaw,expectedOwnerRaw:null,now:"2026-10-29T00:00:00Z"});
  const a=app.indexOf("function suspendSyncOwnerBeforeNativeImport()");
  const b=app.indexOf("function save(){",a);
  assert.ok(a>=0&&b>a);
  const suspend=new Function("localStorage",app.slice(a,b)+"\nreturn suspendSyncOwnerBeforeNativeImport")(h.storage);
  suspend();
  assert.equal(deviceOwnerStatus(h.storage,h.user.id).status,"review-required");
  assert.equal(h.values.get(DEVICE_DATA_KEY),fixtureRaw);
  const importAction=app.slice(app.lastIndexOf("Import this backup now?"),app.lastIndexOf("toast('Backup restored"));
  assert.ok(importAction.indexOf("suspendSyncOwnerBeforeNativeImport()") <
    importAction.indexOf("data=restored"));
});
test("malformed device owner blocks native backup import", () => {
  const h = harness();
  h.values.set(DEVICE_OWNER_KEY,"corrupt data");
  const a=app.indexOf("function suspendSyncOwnerBeforeNativeImport()");
  const b=app.indexOf("function save(){",a);
  const suspend=new Function("localStorage",app.slice(a,b)+"\nreturn suspendSyncOwnerBeforeNativeImport")(h.storage);
  assert.throws(()=>suspend(),/damaged/);
  assert.equal(h.values.get(DEVICE_DATA_KEY),fixtureRaw);
});
test("import review guard retains the original owner and cannot be reassigned", () => {
  const h=harness();
  bindDeviceOwner({storage:h.storage,verifiedId:h.user.id,expectedData:fixtureRaw,expectedOwnerRaw:null,now:"2026-10-29T00:00:00Z"});
  suspendDeviceOwnerAfterImport({storage:h.storage,now:"2026-10-30T00:00:00Z"});
  assert.equal(deviceOwnerStatus(h.storage,"another-test-id").status,"other-account");
  assert.equal(deviceOwnerStatus(h.storage,h.user.id).status,"review-required");
});
