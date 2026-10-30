// Run with Node.js >= 18: node --test tests/backup-upload.test.mjs
// The backup parser itself does not require a browser or an API connection.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseBackupForUpload } from "../cloud-backup-upload.mjs";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/lift-journal-backup-sample.json", import.meta.url), "utf8")
);
const clone = value => JSON.parse(JSON.stringify(value));

test("parses exported backup with stable cloud ID and preserves original input", () => {
  const original = clone(fixture);
  const result = parseBackupForUpload(original);
  assert.equal(result.total, 1);
  assert.equal(result.unfinished, 0);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].client_workout_id, "lj-session:stage1-fixture-workout-001");
  assert.equal(result.entries[0].name, "TEST - Imported From Backup");
  assert.equal(result.entries[0].workout_data.exercises[0].sets[0].weight, "25");
  assert.equal(result.entries[0].workout_data.source, "lift-journal-backup");
  assert.deepEqual(original, fixture, "Parser must not mutate backup data");
});

test("does not include in-progress sessions", () => {
  const file = clone(fixture);
  file.data.sessions["unfinished-test"] = {
    ...clone(file.data.sessions["stage1-fixture-workout-001"]), finished: null
  };
  const result = parseBackupForUpload(file);
  assert.equal(result.total, 2);
  assert.equal(result.unfinished, 1);
  assert.equal(result.entries.length, 1);
});

test("rejects other file formats", () => {
  const file = clone(fixture);
  file.format = "unknown";
  assert.throws(() => parseBackupForUpload(file), /original Lift Journal/);
});

test("rejects malformed exercise data instead of partially importing", () => {
  const file = clone(fixture);
  file.data.sessions["stage1-fixture-workout-001"].exercises[0].sets[0].reps = { value: 5 };
  assert.throws(() => parseBackupForUpload(file), /Malformed set/);
});

test("requires a supported weight unit", () => {
  const file = clone(fixture);
  file.data.unit = "stones";
  assert.throws(() => parseBackupForUpload(file), /original Lift Journal/);
});

test("refuses excessive workout counts", () => {
  const file = clone(fixture);
  for (let i = 0; i < 251; i++) {
    file.data.sessions["extra-" + i] = clone(file.data.sessions["stage1-fixture-workout-001"]);
  }
  assert.throws(() => parseBackupForUpload(file), /pilot supports up to 250/);
});

test("uses per-session unit when present, otherwise the exported unit", () => {
  const file = clone(fixture);
  delete file.data.sessions["stage1-fixture-workout-001"].unit;
  assert.equal(parseBackupForUpload(file).entries[0].workout_data.unit, "lb");
  assert.equal(fixture.data.sessions["stage1-fixture-workout-001"].unit, "lb");
});
