// Run: node --test tests/cloud-sync-core.test.mjs
// Pure Stage 4 tests; no Supabase network or real browser storage.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSyncPlan, makeSafetyBackup, planSelectedSync } from "../cloud-sync-core.mjs";
const file = n => JSON.parse(readFileSync(new URL("./fixtures/" + n, import.meta.url), "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));
const local = file("lift-journal-stage3-device-backup.json").data;
const origin = file("lift-journal-backup-sample.json");
const cloudId = "lj-session:stage1-fixture-workout-001";
const localId = "lj-session:device-only-workout-001";
const at = "2026-10-27T02:00:00.000Z";
const fromCloud = () => ({
  client_workout_id: cloudId,
  workout_data: {
    ...clone(origin.data.sessions["stage1-fixture-workout-001"]),
    name: "TEST - Imported From Backup", source: "lift-journal-backup",
    backupSessionId: "stage1-fixture-workout-001"
  }
});
const placeholder = () => ({ client_workout_id: "preview-incomplete", workout_data: {
  name: "TEST - Preview only", exercises: [], test_record: true
} });

test("finds one upload, one download and ignores cloud preview records", () => {
  const plan = buildSyncPlan(local, [fromCloud(), placeholder()]);
  assert.equal(plan.localCount, 1);
  assert.equal(plan.cloudCount, 2);
  assert.equal(plan.uploadCounts.eligible, 1);
  assert.equal(plan.downloadCounts.eligible, 1);
  assert.equal(plan.downloadCounts.unsupported, 1);
});

test("pure sync plan does not mutate either side", () => {
  const device = clone(local), cloud = [fromCloud(), placeholder()];
  const beforeDevice = clone(device), beforeCloud = clone(cloud);
  buildSyncPlan(device, cloud);
  assert.deepEqual(device, beforeDevice);
  assert.deepEqual(cloud, beforeCloud);
});

test("completes only explicitly selected changes without touching other fields", () => {
  const device = clone(local), cloud = [fromCloud(), placeholder()];
  const beforeDevice = clone(device), beforeCloud = clone(cloud);
  const result = planSelectedSync(device, cloud, [localId], [cloudId]);
  assert.equal(result.uploadCount, 1);
  assert.equal(result.downloadCount, 1);
  assert.equal(result.upload[0].client_workout_id, localId);
  assert.equal(result.upload[0].workout_data.backupSessionId, "device-only-workout-001");
  assert.equal(result.nextLocal.sessions["stage1-fixture-workout-001"].unit, "lb");
  assert.equal(result.nextLocal.sessions["device-only-workout-001"].unit, "kg");
  for (const key of Object.keys(device)) {
    if (key !== "sessions") assert.deepEqual(result.nextLocal[key], device[key], key);
  }
  assert.deepEqual(device, beforeDevice);
  assert.deepEqual(cloud, beforeCloud);
});

test("upload-only never changes locally saved data", () => {
  const result = planSelectedSync(local, [fromCloud()], [localId], []);
  assert.deepEqual(result.nextLocal, local);
  assert.equal(result.uploadCount, 1);
  assert.equal(result.downloadCount, 0);
});

test("download-only never creates cloud inserts", () => {
  const result = planSelectedSync(local, [fromCloud()], [], [cloudId]);
  assert.deepEqual(result.upload, []);
  assert.equal(result.downloadCount, 1);
});

test("same ID with semantically identical JSONB but reordered keys is already synced", () => {
  const downloaded = planSelectedSync(local, [fromCloud()], [], [cloudId]).nextLocal;
  const rewritten = JSON.parse(JSON.stringify(fromCloud().workout_data));
  const reversed = Object.fromEntries(Object.keys(rewritten).reverse().map(k => [k, rewritten[k]]));
  const plan = buildSyncPlan(downloaded, [{ client_workout_id: cloudId, workout_data: reversed }]);
  assert.equal(plan.downloadCounts.already, 1);
  assert.equal(plan.uploadCounts.already, 1);
  assert.equal(plan.downloadCounts.conflict || 0, 0);
});

test("same ID with different workout performance is a conflict and can't be overwritten", () => {
  const row = fromCloud(), device = clone(local);
  device.sessions["stage1-fixture-workout-001"] = clone(row.workout_data);
  row.workout_data.exercises[0].sets[0].weight = "999";
  const plan = buildSyncPlan(device, [row]);
  assert.equal(plan.uploadCounts.conflict, 1);
  assert.equal(plan.downloadCounts.conflict, 1);
  assert.throws(() => planSelectedSync(device, [row], [], [cloudId]), /no longer eligible/);
});

test("does not upload in-progress local sessions", () => {
  const device = clone(local);
  device.sessions["device-only-workout-001"].finished = null;
  const plan = buildSyncPlan(device, [fromCloud()]);
  assert.equal(plan.uploadCounts.unfinished, 1);
  assert.equal(plan.uploadCounts.eligible || 0, 0);
});

test("marks a different ID with an identical started/finished time as potential duplicate", () => {
  const device = clone(local), row = fromCloud();
  device.sessions["new-local-id"] = clone(origin.data.sessions["stage1-fixture-workout-001"]);
  const plan = buildSyncPlan(device, [row]);
  assert.equal(plan.uploadCounts["possible-duplicate"], 1);
});

test("rejects selection of cloud-only placeholder test records", () => {
  assert.throws(() => planSelectedSync(local, [fromCloud(), placeholder()], [], ["preview-incomplete"]), /no longer eligible/);
});

test("rejects repeated IDs and unconfirmed zero-change syncs", () => {
  assert.throws(() => planSelectedSync(local, [fromCloud()], [], []), /Choose/);
  assert.throws(() => planSelectedSync(local, [fromCloud()], [localId, localId], []), /Choose/);
});

test("rejects a stale selection that became present after another device synced", () => {
  const device = clone(local);
  device.sessions["stage1-fixture-workout-001"] = clone(fromCloud().workout_data);
  assert.throws(() => planSelectedSync(device, [fromCloud()], [], [cloudId]), /no longer eligible/);
});

test("rejects mismatched origin/provenance metadata", () => {
  const device = clone(local);
  device.sessions["device-only-workout-001"].backupSessionId = "somebody-else";
  assert.throws(() => planSelectedSync(device, [fromCloud()], [localId], []), /provenance/);
});

test("safety backup fully preserves local content without mutating source", () => {
  const device = clone(local), before = clone(device);
  const json = makeSafetyBackup(device, at);
  const archive = JSON.parse(json);
  assert.equal(archive.format, "lift-journal-v1");
  assert.equal(archive.exported, at);
  assert.deepEqual(archive.data, device);
  assert.deepEqual(device, before);
});

test("rejects prototype-polluting original IDs", () => {
  const device = clone(local);
  Object.defineProperty(device.sessions, "__proto__", { value: clone(device.sessions["device-only-workout-001"]), enumerable: true, configurable: true });
  const plan = buildSyncPlan(device, [fromCloud()]);
  assert.equal(plan.uploadCounts.unsupported, 1);
});
