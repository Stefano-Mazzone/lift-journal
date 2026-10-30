// Node: node --test tests/stage6-device-owner.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEVICE_OWNER_KEY, DEVICE_DATA_KEY, parseDeviceOwner,
  deviceOwnerStatus, isDeviceOwnedBy, bindDeviceOwner, suspendDeviceOwnerAfterImport
} from "../stage6-device-owner.mjs";

function createStorage(data = '{"sessions":{}}') {
  const values = new Map([[DEVICE_DATA_KEY, data]]);
  return {
    values, getItem: key => values.has(key) ? values.get(key) : null,
    setItem(key, value) { values.set(key, value); }
  };
}
const date = "2026-10-29T20:00:00.000Z";
function link(storage, id = "user-A", raw = storage.getItem(DEVICE_DATA_KEY)) {
  return bindDeviceOwner({
    storage, verifiedId: id, expectedData: raw,
    expectedOwnerRaw: storage.getItem(DEVICE_OWNER_KEY), now: date
  });
}
test("unclaimed browser data has no allowed cloud-sync owner", () => {
  const st = createStorage();
  assert.equal(deviceOwnerStatus(st, "user-A").status, "unclaimed");
  assert.equal(isDeviceOwnedBy(st, "user-A"), false);
  assert.equal(parseDeviceOwner(null).status, "unclaimed");
});
test("owner linking only writes its marker, never workouts", () => {
  const local = '{"sessions":{"test":{"finished":true}},"nutrition":{"goal":2200}}';
  const st = createStorage(local);
  const first = link(st);
  assert.equal(first.status, "linked");
  assert.equal(first.owner.userId, "user-A");
  assert.equal(st.getItem(DEVICE_DATA_KEY), local);
  assert.equal(isDeviceOwnedBy(st, "user-A"), true);
  assert.equal(deviceOwnerStatus(st, "user-B").status, "other-account");
});
test("another account cannot overwrite or reassign ownership", () => {
  const st = createStorage();
  link(st);
  const before = st.getItem(DEVICE_OWNER_KEY);
  assert.throws(() => link(st, "user-B"), /different account/);
  assert.equal(st.getItem(DEVICE_OWNER_KEY), before);
  assert.equal(isDeviceOwnedBy(st, "user-B"), false);
});
test("same account cannot relink active ownership", () => {
  const st = createStorage();
  link(st);
  assert.throws(() => link(st), /already linked/);
});
test("concurrent workout changes block first ownership binding", () => {
  const st = createStorage();
  const old = st.getItem(DEVICE_DATA_KEY);
  st.setItem(DEVICE_DATA_KEY, '{"sessions":{"new":{}}}');
  assert.throws(() => bindDeviceOwner({
    storage: st, verifiedId: "user-A", expectedData: old,
    expectedOwnerRaw: null, now: date
  }), /Workout data changed/);
  assert.equal(st.getItem(DEVICE_OWNER_KEY), null);
});
test("racing account claims block later stale claims", () => {
  const st = createStorage();
  const old = st.getItem(DEVICE_DATA_KEY);
  link(st);
  assert.throws(() => bindDeviceOwner({
    storage: st, verifiedId: "user-B", expectedData: old,
    expectedOwnerRaw: null, now: date
  }), /ownership changed/);
});
test("a backup import suspends existing owner while preserving owner ID", () => {
  const st = createStorage();
  link(st);
  const before = st.getItem(DEVICE_DATA_KEY);
  const ownerTime = JSON.parse(st.getItem(DEVICE_OWNER_KEY)).createdAt;
  suspendDeviceOwnerAfterImport({ storage: st, now: "2026-10-30T00:00:00Z" });
  assert.equal(deviceOwnerStatus(st, "user-A").status, "review-required");
  assert.equal(isDeviceOwnedBy(st, "user-A"), false);
  assert.equal(deviceOwnerStatus(st, "user-B").status, "other-account");
  assert.equal(st.getItem(DEVICE_DATA_KEY), before);
  const newOwner = JSON.parse(st.getItem(DEVICE_OWNER_KEY));
  assert.equal(newOwner.createdAt, ownerTime);
  assert.equal(newOwner.userId, "user-A");
});
test("after import same owner may reauthorize but a different account may not", () => {
  const st = createStorage();
  link(st);
  suspendDeviceOwnerAfterImport({ storage: st, now: "2026-10-30T00:00:00Z" });
  assert.throws(() => link(st, "user-B"), /different account/);
  assert.equal(link(st).status, "linked");
});
test("malformed or unexpected ownership never allows cloud sync", () => {
  for (const malformed of ["{}", "not JSON", "null", '{"version":2,"userId":"x"}',
    '{"version":1,"userId":"x","state":"active"}']) {
    const st = createStorage();
    st.setItem(DEVICE_OWNER_KEY, malformed);
    assert.equal(deviceOwnerStatus(st, "x").status, "damaged");
    assert.equal(isDeviceOwnedBy(st, "x"), false);
    assert.throws(() => link(st, "x"), /damaged/);
    assert.throws(() => suspendDeviceOwnerAfterImport({ storage: st, now: date }), /damaged/);
  }
});
test("no owner marker means import leaves sync unclaimed", () => {
  const st = createStorage();
  assert.equal(suspendDeviceOwnerAfterImport({ storage: st, now: date }).status, "unclaimed");
  assert.equal(st.getItem(DEVICE_OWNER_KEY), null);
});
test("storage write failure blocks owner association", () => {
  const st = createStorage();
  st.setItem = () => { throw Error("quota exceeded"); };
  assert.throws(() => link(st), /quota exceeded/);
});
test("signing out does not erase the association", () => {
  const st = createStorage();
  link(st);
  assert.equal(deviceOwnerStatus(st, null).status, "signed-out");
  assert.equal(deviceOwnerStatus(st, "user-A").status, "linked");
});
