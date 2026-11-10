// Run with Node.js 18+: node --test tests/cloud-safe-merge.test.mjs
// All tests are pure; no real Supabase account or device storage is accessed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validateDeviceBackup, planWorkoutMerge, createMergedDeviceBackup
} from "../cloud-safe-merge.mjs";

const fixture = name => JSON.parse(readFileSync(
  new URL("./fixtures/" + name, import.meta.url), "utf8"
));
const device = fixture("lift-journal-stage3-device-backup.json");
const source = fixture("lift-journal-backup-sample.json");
const key = "stage1-fixture-workout-001";
const clientId = "lj-session:" + key;
const clone = x => JSON.parse(JSON.stringify(x));
const cloudOriginal = () => ({
  client_workout_id: clientId,
  workout_data: {
    ...clone(source.data.sessions[key]),
    name: "TEST - Imported From Backup",
    source: "lift-journal-backup",
    backupSessionId: key
  }
});
const otherSample = () => ({
  client_workout_id: "preview-12345",
  workout_data: { name: "TEST - Preview only", exercises: [], test_record: true }
});
const when = "2026-10-26T23:00:00.000Z";

test("recognizes the full device backup", () => {
  assert.equal(Object.keys(validateDeviceBackup(device).sessions).length, 1);
});

test("marks a completed original cloud workout as eligible", () => {
  const plan = planWorkoutMerge(device, [cloudOriginal(), otherSample()]);
  assert.equal(plan.deviceCount, 1);
  assert.equal(plan.cloudCount, 2);
  assert.equal(plan.counts.eligible, 1);
  assert.equal(plan.counts.unsupported, 1);
  assert.equal(plan.entries.find(x => x.id === clientId).status, "eligible");
});

test("merges just the selected workout, retaining all device metadata and source inputs", () => {
  const beforeDevice = clone(device);
  const cloud = [cloudOriginal(), otherSample()];
  const beforeCloud = clone(cloud);
  const merged = createMergedDeviceBackup(device, cloud, [clientId], when);
  const restored = JSON.parse(merged.json);
  assert.equal(restored.format, "lift-journal-v1");
  assert.equal(restored.exported, when);
  assert.deepEqual(restored.data.sessions["device-only-workout-001"],
    device.data.sessions["device-only-workout-001"]);
  assert.deepEqual(restored.data.sessions[key], cloud[0].workout_data);
  assert.equal(restored.data.sessions[key].unit, "lb");
  assert.equal(restored.data.unit, "kg", "Destination device unit stays the same");
  assert.deepEqual(restored.data.nutrition, device.data.nutrition);
  assert.deepEqual(restored.data.running, device.data.running);
  assert.deepEqual(restored.data.favoriteMovements, device.data.favoriteMovements);
  assert.deepEqual(restored.data.schedule, device.data.schedule);
  assert.deepEqual(restored.data.program, device.data.program);
  assert.deepEqual(device, beforeDevice, "Device source backup must remain unchanged");
  assert.deepEqual(cloud, beforeCloud, "Cloud rows must remain unchanged");
  assert.equal(merged.added, 1);
  assert.equal(merged.deviceCount, 1);
  assert.equal(merged.total, 2);
  validateDeviceBackup(restored);
});

test("does not replace an existing session with same original ID", () => {
  const already = clone(device);
  already.data.sessions[key] = {
    ...clone(device.data.sessions["device-only-workout-001"]),
    name: "Do not overwrite this!"
  };
  const plan = planWorkoutMerge(already, [cloudOriginal()]);
  assert.equal(plan.counts.already, 1);
  assert.equal(plan.counts.eligible, 0);
  assert.throws(
    () => createMergedDeviceBackup(already, [cloudOriginal()], [clientId], when),
    /missing, duplicated or incompatible/
  );
  assert.equal(already.data.sessions[key].name, "Do not overwrite this!");
});

test("skips workouts with matching start and finish time under a different ID", () => {
  const similar = cloudOriginal();
  similar.client_workout_id = "lj-session:another-key";
  similar.workout_data.backupSessionId = "another-key";
  similar.workout_data.started = device.data.sessions["device-only-workout-001"].started;
  similar.workout_data.finished = device.data.sessions["device-only-workout-001"].finished;
  const plan = planWorkoutMerge(device, [similar]);
  assert.equal(plan.counts["possible-duplicate"], 1);
  assert.equal(plan.counts.eligible, 0);
});

test("rejects incorrect backup format, rather than merging a Stage 2 archive", () => {
  assert.throws(
    () => planWorkoutMerge({ format: "lift-journal-cloud-workouts-v1", workouts: [] }, [cloudOriginal()]),
    /full backup/
  );
});

test("rejects cloud placeholders missing native session fields", () => {
  const result = planWorkoutMerge(device, [otherSample()]);
  assert.equal(result.counts.unsupported, 1);
  assert.throws(() =>
    createMergedDeviceBackup(device, [otherSample()], ["preview-12345"], when), /missing, duplicated/);
});

test("rejects malformed or dangerous identifiers", () => {
  const item = cloudOriginal();
  item.client_workout_id = "lj-session:__proto__";
  assert.equal(planWorkoutMerge(device, [item]).counts.unsupported, 1);
});

test("rejects duplicate cloud IDs and duplicate chosen IDs", () => {
  assert.throws(() => planWorkoutMerge(device, [cloudOriginal(), cloudOriginal()]), /Duplicate/);
  assert.throws(
    () => createMergedDeviceBackup(device, [cloudOriginal()], [clientId, clientId], when),
    /Select 1/
  );
});

test("rejects malformed destination workouts without altering source", () => {
  const corrupt = clone(device);
  corrupt.data.sessions["device-only-workout-001"].exercises[0].sets[0].weight = { nope: true };
  const original = clone(corrupt);
  assert.throws(() => planWorkoutMerge(corrupt, [cloudOriginal()]), /invalid workout/);
  assert.deepEqual(corrupt, original);
});

test("refuses an invalid cloud backupSessionId mapping", () => {
  const row = cloudOriginal();
  row.workout_data.backupSessionId = "different-session";
  assert.equal(planWorkoutMerge(device, [row]).counts.unsupported, 1);
});

test("preserves existing running/nutrition records even when no cloud workouts were in those sections", () => {
  const merged = JSON.parse(createMergedDeviceBackup(device, [cloudOriginal()], [clientId], when).json);
  for (const name of Object.keys(device.data)) {
    if (name === "sessions") continue;
    assert.deepEqual(merged.data[name], device.data[name], "Preserve all destination field: " + name);
  }
});
