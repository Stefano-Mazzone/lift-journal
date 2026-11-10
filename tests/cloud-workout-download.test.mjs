// Run with Node.js >=18: node --test tests/cloud-workout-download.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { buildCloudWorkoutArchive, fetchCloudWorkouts } from "../cloud-workout-download.mjs";

const row = (id, extra = {}) => ({
  id: "internal-id-" + id,
  user_id: "user-123",
  client_workout_id: id,
  workout_data: { name: "Workout " + id, exercises: [{ name: "Pushup", sets: [] }] },
  created_at: "2026-10-26T14:00:00.000Z",
  updated_at: "2026-10-26T14:00:00.000Z",
  ...extra
});
const date = "2026-10-26T22:00:00.000Z";

test("exports selected workouts without changing input or exposing auth/database IDs", () => {
  const input = [row("lj-session:one")];
  const before = structuredClone(input);
  const archive = JSON.parse(buildCloudWorkoutArchive(input, date));
  assert.equal(archive.format, "lift-journal-cloud-workouts-v1");
  assert.notEqual(archive.format, "lift-journal-v1", "Must not accidentally be importable as destructive live backup.");
  assert.equal(archive.workout_count, 1);
  assert.equal(archive.workouts[0].client_workout_id, "lj-session:one");
  assert.deepEqual(archive.workouts[0].workout_data, input[0].workout_data);
  assert.equal(archive.workouts[0].user_id, undefined);
  assert.equal(archive.workouts[0].id, undefined);
  assert.deepEqual(input, before, "Export must not mutate downloaded cloud rows.");
});

test("refuses empty or malformed cloud results", () => {
  assert.throws(() => buildCloudWorkoutArchive([], date), /invalid/);
  assert.throws(() => buildCloudWorkoutArchive([row("")], date), /invalid/);
  assert.throws(() => buildCloudWorkoutArchive([row("one", { workout_data: null })], date), /invalid/);
});

test("refuses duplicate client IDs to prevent ambiguous archives", () => {
  assert.throws(() => buildCloudWorkoutArchive([row("one"), row("one")], date), /Duplicate/);
});

test("export reflects only explicitly supplied selection", () => {
  const all = [row("a"), row("b"), row("c")];
  const selected = all.filter(x => x.client_workout_id === "b");
  const archive = JSON.parse(buildCloudWorkoutArchive(selected, date));
  assert.equal(archive.workout_count, 1);
  assert.equal(archive.workouts[0].client_workout_id, "b");
});

function fakeClient(rows, custom = () => ({})) {
  const calls = [];
  const api = {
    calls,
    from(table) {
      assert.equal(table, "workouts");
      const state = { table, selected: null, options: null, owner: null, sorts: [] };
      const query = {
        select(fields, options) { state.selected = fields; state.options = options; return query; },
        eq(field, value) { assert.equal(field, "user_id"); state.owner = value; return query; },
        order(key) { state.sorts.push(key); return query; },
        async range(start, end) {
          calls.push({ ...state, start, end });
          const override = custom({ ...state, start, end, calls }) || {};
          return {
            data: rows.slice(start, end + 1),
            error: null,
            count: state.options?.count === "exact" ? rows.length : null,
            ...override
          };
        }
      };
      return query;
    }
  };
  return api;
}

test("fetches more than one page, scoped to the user, never truncating at 25/200", async () => {
  const rows = Array.from({ length: 204 }, (_, i) => row("workout-" + i));
  const client = fakeClient(rows);
  const result = await fetchCloudWorkouts(client, "user-123");
  assert.equal(result.length, 204);
  assert.equal(client.calls.length, 2);
  assert.deepEqual(client.calls.map(c => [c.start, c.end]), [[0,199], [200,399]]);
  assert.ok(client.calls.every(c => c.owner === "user-123"));
});

test("returns an empty list for an account with no workouts", async () => {
  assert.deepEqual(await fetchCloudWorkouts(fakeClient([]), "user-123"), []);
});

test("fails closed if a page returns an error", async () => {
  const client = fakeClient([row("one")], () => ({ error: { message: "Permission denied" } }));
  await assert.rejects(() => fetchCloudWorkouts(client, "user-123"), /Permission denied/);
});

test("fails closed on inconsistent total counts", async () => {
  const client = fakeClient([row("one")], () => ({ count: 2 }));
  await assert.rejects(() => fetchCloudWorkouts(client, "user-123"), /Incomplete/);
});

test("stops if account identity is lost while awaiting a page", async () => {
  let verified = true;
  const client = fakeClient([row("one")], () => { verified = false; return {}; });
  await assert.rejects(() => fetchCloudWorkouts(client, "user-123", () => verified), /Account changed/);
});

test("refuses unexpected duplicate IDs returned by the cloud", async () => {
  const client = fakeClient([row("same"), row("same")]);
  await assert.rejects(() => fetchCloudWorkouts(client, "user-123"), /changed while downloading/);
});
