// Run: node --test tests/stage5-manual-sync.test.mjs
// Browser-like isolated harness. Does NOT access a real account or real storage.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSyncPlan, makeSafetyBackup, planSelectedSync } from "../cloud-sync-core.mjs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const clone = value => JSON.parse(JSON.stringify(value));
const localFixture = JSON.parse(read("tests/fixtures/lift-journal-stage3-device-backup.json")).data;
const cloudFixture = JSON.parse(read("tests/fixtures/lift-journal-backup-sample.json"))
  .data.sessions["stage1-fixture-workout-001"];
const cloudId = "lj-session:stage1-fixture-workout-001";
const localId = "lj-session:device-only-workout-001";
const cloudRow = () => ({
  client_workout_id: cloudId,
  workout_data: {
    ...clone(cloudFixture), name: "TEST - Imported From Backup",
    backupSessionId: "stage1-fixture-workout-001", source: "lift-journal-backup"
  }
});

class MockElement {
  constructor(tag = "div", id = "") {
    this.tag = tag;
    this.id = id;
    this.dataset = {};
    this.children = [];
    this.disabled = false;
    this.checked = false;
    this.textContent = "";
  }
  append(...items) { this.children.push(...items); }
  replaceChildren() { this.children = []; }
  click() {}
  remove() {}
}

function mockRoot() {
  const root = new MockElement("div", "lj-stage5-sync-root");
  root.isConnected = true;
  root.events = {};
  root.addEventListener = (name, handler) => { root.events[name] = handler; };
  root.querySelector = selector => selector.startsWith("#") ? root.nodes?.[selector.slice(1)] || null : null;
  root.querySelectorAll = selector => {
    if (selector !== "input[data-sync-id]") return [];
    const found = [];
    const visit = item => {
      if (item.dataset?.syncId) found.push(item);
      for (const child of item.children || []) visit(child);
    };
    for (const child of Object.values(root.nodes || {})) {
      if (child.tag === "ul") visit(child);
    }
    return found;
  };
  Object.defineProperty(root, "innerHTML", {
    get() { return root.markup || ""; },
    set(html) {
      root.markup = html;
      root.nodes = {};
      for (const match of html.matchAll(/<([a-z0-9]+)[^>]*id="([^"]+)"[^>]*>/g)) {
        root.nodes[match[2]] = new MockElement(match[1], match[2]);
      }
    }
  });
  return root;
}

const source = read("stage5-manual-sync.mjs");
const sourceNoImports = source.replace(/^import [^\n]*\n/gm, "").replace(/\bexport\s+/g, "");
const anchor = "return { mount, reset: () => { clear(); root = null; ownerId = null; } };";
assert.ok(sourceNoImports.includes(anchor), "test harness must track the exact public widget interface");
const inspectedSource = sourceNoImports.replace(anchor,
  "return { mount, reset: () => { clear(); root = null; ownerId = null; }, " +
  "_inspect: {compare, selectDownloads, backup, apply, update, setBusy: value=>{busy=value}, get:()=>({snapshot,busy,backupRequested,ownerId,downloads:[...downloads],uploads:[...uploads]})} };");

function harness({ rows = [cloudRow()], origin = "127.0.0.1" } = {}) {
  const cloudRows = clone(rows);
  let user = { id: "test-user-id", email: "test@example.com" };
  const root = mockRoot();
  const document = {
    root, body: new MockElement("body"),
    createElement: tag => new MockElement(tag),
    getElementById: id => id === "lj-stage5-sync-root" ? this.root : null
  };
  // Arrow-based document lookup also works when the fixture root gets replaced.
  document.getElementById = id => id === "lj-stage5-sync-root" ? document.root : null;
  const state = {
    bytes: JSON.stringify(localFixture),
    writes: 0, reloads: 0, inserts: [], downloads: [], confirms: []
  };
  const localStorage = {
    getItem: key => key === "lift-journal-v1" ? state.bytes : null,
    setItem(key, value) {
      assert.equal(key, "lift-journal-v1");
      state.bytes = value;
      state.writes++;
    }
  };
  const window = {
    confirm: message => { state.confirms.push(message); return true; },
    setTimeout() {},
    location: { reload: () => { state.reloads++; } }
  };
  const URL = { createObjectURL: () => "blob:test", revokeObjectURL() {} };
  document.createElement = tag => {
    const element = new MockElement(tag);
    if (tag === "a") {
      element.click = () => state.downloads.push(element.download);
    }
    return element;
  };
  const client = {
    auth: { async getUser() { return { data: { user }, error: null }; } },
    from(name) {
      assert.equal(name, "workouts");
      return {
        async insert(payload) {
          state.inserts.push(clone(payload));
          cloudRows.push({
            client_workout_id: payload.client_workout_id,
            workout_data: clone(payload.workout_data)
          });
          return { error: null };
        }
      };
    }
  };
  const create = new Function(
    "location","document","localStorage","window","URL",
    "fetchCloudWorkouts","buildSyncPlan","makeSafetyBackup","planSelectedSync",
    inspectedSource + "\nreturn createSettingsManualSync;"
  )({ hostname: origin }, document, localStorage, window, URL,
    async () => clone(cloudRows), buildSyncPlan, makeSafetyBackup, planSelectedSync);
  const widget = create({ getClient: () => client, getUser: () => user });
  widget.mount();
  return {
    widget, state, document, root, getUser: () => user, setUser: next => { user = next; },
    cloudRows, localStorage, makeNewRoot() { root.isConnected = false; document.root = mockRoot(); widget.mount(); }
  };
}

test("mount is opt-in and starts without reading or writing cloud/device changes", () => {
  const h = harness();
  assert.match(h.root.innerHTML, /Manual Workout Sync/);
  assert.equal(h.state.writes, 0);
  assert.equal(h.state.inserts.length, 0);
  assert.equal(h.state.reloads, 0);
  assert.equal(h.widget._inspect.get().snapshot, null);
});

test("compare enables the right eligible download, preserving already-synced statuses", async () => {
  const h = harness();
  await h.widget._inspect.compare();
  const plan = h.widget._inspect.get().snapshot.plan;
  assert.equal(plan.localCount, 1);
  assert.equal(plan.cloudCount, 1);
  assert.equal(plan.uploadCounts.eligible, 1);
  assert.equal(plan.downloadCounts.eligible, 1);
  assert.equal(h.root.nodes["lj5-sync-select-down"].disabled, false);
  assert.equal(h.root.nodes["lj5-sync-apply"].disabled, true);
  assert.equal(h.state.writes, 0);
});

test("safe cloud download requires explicit backup and ownership, then reloads the in-memory app", async () => {
  const h = harness();
  await h.widget._inspect.compare();
  h.widget._inspect.selectDownloads();
  assert.deepEqual(h.widget._inspect.get().downloads, [cloudId]);
  assert.equal(h.root.nodes["lj5-sync-apply"].disabled, true);
  h.widget._inspect.backup();
  assert.equal(h.state.downloads.length, 1);
  assert.match(h.state.downloads[0], /^lift-journal-SAFETY-BACKUP-/);
  assert.equal(h.widget._inspect.get().backupRequested, true);
  h.root.nodes["lj5-sync-backup-ack"].checked = true;
  h.widget._inspect.update();
  assert.equal(h.root.nodes["lj5-sync-apply"].disabled, true, "owner consent still required");
  h.root.nodes["lj5-sync-owner-ack"].checked = true;
  h.widget._inspect.update();
  assert.equal(h.root.nodes["lj5-sync-apply"].disabled, false);
  await h.widget._inspect.apply();
  const next = JSON.parse(h.state.bytes);
  assert.equal(Object.keys(next.sessions).length, 2);
  assert.equal(next.sessions["stage1-fixture-workout-001"].unit, "lb");
  assert.equal(next.sessions["device-only-workout-001"].unit, "kg");
  for (const key of Object.keys(localFixture)) {
    if (key !== "sessions") assert.deepEqual(next[key], localFixture[key], key);
  }
  assert.equal(h.state.writes, 1);
  assert.equal(h.state.inserts.length, 0);
  assert.equal(h.state.reloads, 1);
  assert.match(h.state.confirms[0], /Upload 0/);
  assert.match(h.state.confirms[0], /Download 1/);
});

test("manual cloud upload uses only INSERT without mutating local storage", async () => {
  const h = harness({ rows: [] });
  await h.widget._inspect.compare();
  const input = h.root.querySelectorAll("input[data-sync-id]")
    .find(box => box.dataset.syncId === localId);
  assert.ok(input);
  input.checked = true;
  const event = {
    target: { ...input, matches: query => query === "input[data-sync-id]" }
  };
  h.root.events.change(event);
  assert.deepEqual(h.widget._inspect.get().uploads, [localId]);
  h.widget._inspect.backup();
  h.root.nodes["lj5-sync-backup-ack"].checked = true;
  h.root.nodes["lj5-sync-owner-ack"].checked = true;
  h.widget._inspect.update();
  await h.widget._inspect.apply();
  assert.equal(h.state.inserts.length, 1);
  assert.equal(h.state.inserts[0].client_workout_id, localId);
  assert.equal(h.state.writes, 0);
  assert.equal(h.state.reloads, 0);
  await h.widget._inspect.compare();
  assert.equal(h.widget._inspect.get().snapshot.plan.uploadCounts.eligible || 0, 0);
});

test("local history changed since comparison blocks synchronization without writes", async () => {
  const h = harness();
  await h.widget._inspect.compare();
  h.widget._inspect.selectDownloads();
  h.widget._inspect.backup();
  h.root.nodes["lj5-sync-backup-ack"].checked = true;
  h.root.nodes["lj5-sync-owner-ack"].checked = true;
  h.widget._inspect.update();
  const edited = JSON.parse(h.state.bytes);
  edited.unit = "lb";
  h.state.bytes = JSON.stringify(edited);
  await h.widget._inspect.apply();
  assert.equal(h.state.writes, 0);
  assert.equal(h.state.inserts.length, 0);
  assert.equal(h.state.reloads, 0);
  assert.match(h.root.nodes["lj5-sync-status"].textContent, /changed after comparison/i);
});

test("account switching and rerenders invalidate stale selection", async () => {
  const h = harness();
  await h.widget._inspect.compare();
  h.widget._inspect.selectDownloads();
  h.setUser({ id: "different-user-id", email: "other@example.com" });
  h.widget.mount();
  assert.equal(h.widget._inspect.get().ownerId, "different-user-id");
  assert.equal(h.widget._inspect.get().snapshot, null);
  assert.deepEqual(h.widget._inspect.get().downloads, []);
  h.setUser({ id: "test-user-id", email: "test@example.com" });
  h.makeNewRoot();
  assert.equal(h.widget._inspect.get().snapshot, null);
  assert.equal(h.state.writes, 0);
});

test("public website host never mounts test controls or touches data", async () => {
  const h = harness({ origin: "stefano-mazzone.github.io" });
  assert.equal(h.root.innerHTML, "");
  await h.widget._inspect.compare();
  assert.equal(h.widget._inspect.get().snapshot, null);
  assert.equal(h.state.writes, 0);
});


test("account switch resets an in-flight busy latch so the next account can compare", async () => {
  const h = harness();
  await h.widget._inspect.compare();
  h.widget._inspect.setBusy(true);
  h.setUser({ id: "new-test-user", email: "new@example.com" });
  h.widget.mount();
  assert.equal(h.widget._inspect.get().busy, false);
  assert.equal(h.widget._inspect.get().snapshot, null);
  assert.equal(h.root.nodes["lj5-sync-compare"].disabled, false);
});
