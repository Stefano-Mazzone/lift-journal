// node --test tests/stage6b-vault-recovery.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { recoveryVaultKey, latestVault, captureVaultRecovery, requireUnchangedVaultRecovery, storeRecoveryVault } from "../stage6b-vault-recovery.mjs";
import { vaultStorageKey } from "../stage6b-vault-core.mjs";
import { DEVICE_DATA_KEY, DEVICE_OWNER_KEY } from "../stage6-device-owner.mjs";
import { readFileSync } from "node:fs";

const id = "fictional-owner", other = "fictional-admin";
const now = "2026-10-29T23:00:00.000Z";
const data = { unit:"kg", sessions:{ first:{}, second:{} }, favoriteMovements:["Squat","Curl"] };
const oldVault = '{"original":"encrypted copy"}';
const recovered = JSON.stringify({
  version:1, ownerId:id, kdf:{name:"PBKDF2"}, cipher:{name:"AES-GCM", data:"fictional-only"}
});
function fixture() {
  const store = new Map([
    [DEVICE_DATA_KEY, JSON.stringify(data)],
    [DEVICE_OWNER_KEY, JSON.stringify({version:1,userId:id,state:"active",createdAt:now,updatedAt:now})],
    [vaultStorageKey(id), oldVault]
  ]);
  return {
    store,
    getItem(key){return store.has(key) ? store.get(key) : null},
    setItem(key, value){store.set(key,value)}
  };
}
test("recovery copies stay separate, preserving original encrypted and plaintext data", () => {
  const browser = fixture(), before = browser.getItem(DEVICE_DATA_KEY);
  const captured = captureVaultRecovery(browser,id);
  assert.equal(captured.workoutCount,2);
  assert.equal(captured.favoriteCount,2);
  assert.deepEqual(requireUnchangedVaultRecovery(browser,captured,id),data);
  const key = storeRecoveryVault(browser,captured,id,recovered);
  assert.equal(key,recoveryVaultKey(id,1));
  assert.equal(browser.getItem(vaultStorageKey(id)),oldVault);
  assert.equal(browser.getItem(DEVICE_DATA_KEY),before);
  assert.equal(latestVault(browser,id)?.raw,recovered);
});
test("Admin account cannot create a recovery from Test User history", () => {
  assert.throws(() => captureVaultRecovery(fixture(),other),/LOCKED/);
});
test("must have an existing original encrypted test copy", () => {
  const browser = fixture(); browser.store.delete(vaultStorageKey(id));
  assert.throws(() => captureVaultRecovery(browser,id),/No original/);
});
test("changing local workouts between safety backup and recovery blocks writes", () => {
  const browser=fixture(), captured=captureVaultRecovery(browser,id);
  browser.setItem(DEVICE_DATA_KEY,JSON.stringify({...data,sessions:{}}));
  assert.throws(() => storeRecoveryVault(browser,captured,id,recovered),/changed/);
});
test("changing ownership between safety backup and recovery blocks writes", () => {
  const browser=fixture(), captured=captureVaultRecovery(browser,id);
  browser.setItem(DEVICE_OWNER_KEY, "bad");
  assert.throws(() => storeRecoveryVault(browser,captured,id,recovered),/LOCKED/);
});
test("changing original encrypted copy blocks stale writes", () => {
  const browser=fixture(), captured=captureVaultRecovery(browser,id);
  browser.setItem(vaultStorageKey(id),"other");
  assert.throws(() => storeRecoveryVault(browser,captured,id,recovered),/changed/);
});
test("existing recovery records cannot be overwritten", () => {
  const browser=fixture(), captured=captureVaultRecovery(browser,id);
  browser.setItem(captured.targetKey,"precious encrypted record");
  assert.throws(() => storeRecoveryVault(browser,captured,id,recovered),/changed/);
  assert.equal(browser.getItem(captured.targetKey),"precious encrypted record");
});
test("other-account ciphertext cannot be stored", () => {
  const browser=fixture(), captured=captureVaultRecovery(browser,id);
  assert.throws(() => storeRecoveryVault(browser,captured,id,
    JSON.stringify({...JSON.parse(recovered),ownerId:other})),/verified account/);
});
test("up to three sequential add-only slots; no old ciphertext removed", () => {
  const browser=fixture();
  for(let i=1;i<=3;i++) {
    const captured=captureVaultRecovery(browser,id);
    assert.equal(captured.targetKey,recoveryVaultKey(id,i));
    storeRecoveryVault(browser,captured,id,recovered);
  }
  assert.throws(()=>captureVaultRecovery(browser,id),/slots are used/);
  assert.equal(browser.getItem(vaultStorageKey(id)),oldVault);
});
test("invalid recovery payload is rejected without storage writes", () => {
  const browser=fixture(), captured=captureVaultRecovery(browser,id);
  assert.throws(()=>storeRecoveryVault(browser,captured,id,"{invalid"),/invalid/);
  assert.equal(browser.getItem(captured.targetKey),null);
});
test("Settings has recovery UI; never modifies legacy workout key or deletes encrypted records", () => {
  const preview=readFileSync(new URL("../stage6b-vault-preview.mjs",import.meta.url),"utf8");
  assert.match(preview,/Cannot unlock\? Prepare a fresh encrypted test copy/);
  assert.match(preview,/Download original encrypted copy/);
  assert.match(preview,/storeRecoveryVault\(localStorage, capture, id, encrypted\)/);
  assert.match(preview,/getClient\(\)\.auth\.getUser\(\)/);
  assert.doesNotMatch(preview,/localStorage\.(?:clear|removeItem)\s*\(/);
  assert.doesNotMatch(preview,/\.from\(["']workouts["']\)/);
});
