// node --test tests/stage6b-vault-preview-guard.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { captureVaultPreview, requireUnchangedVaultPreview } from "../stage6b-vault-preview-guard.mjs";
import { DEVICE_DATA_KEY, DEVICE_OWNER_KEY } from "../stage6-device-owner.mjs";
import { vaultStorageKey } from "../stage6b-vault-core.mjs";
import { readFileSync } from "node:fs";

const id = "fictional-owner";
const admin = "fictional-admin";
const now = "2026-10-29T22:00:00.000Z";
const data = { unit: "lb", sessions: { alpha: { name: "Test" }, beta: { name: "Test 2" } }, favoriteMovements: ["Squat", "Curl"] };
const owner = (userId = id, state = "active") => JSON.stringify({
  version: 1, userId, state, createdAt: now, updatedAt: now
});
function storage() {
  const map = new Map([[DEVICE_DATA_KEY, JSON.stringify(data)], [DEVICE_OWNER_KEY, owner()]]);
  return {
    map,
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, v); }
  };
}
test("linked owner can snapshot both workouts without writing anything", () => {
  const st = storage(), original = [...st.map.entries()];
  const captured = captureVaultPreview(st, id);
  assert.equal(captured.workoutCount, 2);
  assert.deepEqual(requireUnchangedVaultPreview(st, captured, id), data);
  assert.deepEqual([...st.map.entries()], original);
});
test("wrong account cannot make a preview copy of another person's browser history", () => {
  assert.throws(() => captureVaultPreview(storage(), admin), /LOCKED/);
});
test("unclaimed browser history cannot be silently claimed by encrypted preview", () => {
  const st = storage(); st.map.delete(DEVICE_OWNER_KEY);
  assert.throws(() => captureVaultPreview(st, id), /LOCKED/);
});
test("owner under import review is blocked", () => {
  const st = storage(); st.map.set(DEVICE_OWNER_KEY, owner(id, "review-required"));
  assert.throws(() => captureVaultPreview(st, id), /LOCKED/);
});
test("changes after backup invalidate encryption consent", () => {
  const st = storage(), snapshot = captureVaultPreview(st, id);
  st.map.set(DEVICE_DATA_KEY, JSON.stringify({ ...data, sessions: {} }));
  assert.throws(() => requireUnchangedVaultPreview(st, snapshot, id), /changed/);
});
test("owner changes after backup invalidate encryption consent", () => {
  const st = storage(), snapshot = captureVaultPreview(st, id);
  st.map.set(DEVICE_OWNER_KEY, owner(admin));
  assert.throws(() => requireUnchangedVaultPreview(st, snapshot, id), /changed/);
});
test("never overwrite an existing encrypted vault", () => {
  const st = storage(); st.map.set(vaultStorageKey(id), '{"old":"vault"}');
  assert.throws(() => captureVaultPreview(st, id), /already exists/);
});
test("vault created in another tab invalidates a prior snapshot", () => {
  const st = storage(), snapshot = captureVaultPreview(st, id);
  st.map.set(vaultStorageKey(id), '{"encrypted":true}');
  assert.throws(() => requireUnchangedVaultPreview(st, snapshot, id), /changed/);
});
test("damaged legacy local data is never encrypted as if valid", () => {
  const st = storage(); st.map.set(DEVICE_DATA_KEY, "{broken");
  assert.throws(() => captureVaultPreview(st, id), /cannot be parsed/);
});
test("Settings is opt-in and does not modify the main local-save or sync code", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const account = readFileSync(new URL("../stage5-account-panel.mjs", import.meta.url), "utf8");
  const preview = readFileSync(new URL("../stage6b-vault-preview.mjs", import.meta.url), "utf8");
  assert.match(html, /id="lj6b-vault-root"/);
  assert.match(account, /createSettingsVaultPreview/);
  assert.match(account, /vaultPreview\.reset\(\)/);
  assert.match(preview, /storeNewVault\(localStorage, id, encrypted\)/);
  assert.doesNotMatch(preview, /localStorage\.(?:removeItem|clear)\s*\(/);
  assert.doesNotMatch(preview, /from\(["']workouts["']\)/);
});
