// Run: node --test tests/stage6b-vault-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { sealVault, openVault, storeNewVault, vaultStorageKey } from '../stage6b-vault-core.mjs';
const owner = 'test-user-1';
const admin = 'admin-test-2';
const passphrase = 'fictional test passphrase that is not a login password';
const data = { unit: 'kg', sessions: { fictional1: { name: 'Squat 🏋️', reps: 8, weight: 75 } }, favoriteMovements: ['Goblet Squat'], nutrition: { lunch: 'rice' } };
const seal = (id = owner, obj = data) => sealVault({ userId: id, passphrase, data: obj, cryptoProvider: webcrypto });
const open = (record, id = owner, secret = passphrase) => openVault({ userId: id, passphrase: secret, encryptedRecord: record, cryptoProvider: webcrypto });

test('round trip keeps workouts, nutrition, units, favorites and Unicode', async () => {
  const encrypted = await seal();
  assert.deepEqual(await open(encrypted), data);
  assert.doesNotMatch(encrypted, /Goblet Squat|Squat|fictional1|lunch/);
});
test('different account is rejected even with same passphrase', async () => {
  const encrypted = await seal();
  await assert.rejects(() => open(encrypted, admin), /another account/);
});
test('wrong passphrase fails without returning any workout data', async () => {
  const encrypted = await seal();
  await assert.rejects(() => open(encrypted, owner, 'incorrect passphrase'), /Unable to unlock/);
});
test('tampered ciphertext fails AES-GCM authentication', async () => {
  const record = JSON.parse(await seal());
  const encoded = record.cipher.data;
  record.cipher.data = (encoded[0] === 'A' ? 'B' : 'A') + encoded.slice(1);
  await assert.rejects(() => open(JSON.stringify(record)), /Unable to unlock/);
});
test('record with invalid parameters is rejected', async () => {
  const record = JSON.parse(await seal());
  record.kdf.iterations = 1;
  await assert.rejects(() => open(JSON.stringify(record)), /invalid/);
});
test('weak passphrases and malformed histories fail closed', async () => {
  await assert.rejects(() => sealVault({ userId: owner, passphrase: 'short', data, cryptoProvider: webcrypto }), /at least 12/);
  await assert.rejects(() => seal(owner, { sessions: {}, unit: 'invalid' }), /invalid/);
});
test('vault storage keys isolate separate verified account IDs', () => {
  assert.notEqual(vaultStorageKey(owner), vaultStorageKey(admin));
  assert.throws(() => vaultStorageKey('../bad'), /verified/);
});
test('add-only storage does not touch legacy history and rejects overwrites', async () => {
  const encrypted = await seal();
  const records = new Map([['lift-journal-v1', JSON.stringify(data)]]);
  const storage = {getItem:key=>records.has(key)?records.get(key):null, setItem:(key,val)=>records.set(key,val)};
  const key = storeNewVault(storage, owner, encrypted);
  assert.equal(key, vaultStorageKey(owner));
  assert.equal(records.get('lift-journal-v1'), JSON.stringify(data));
  assert.throws(() => storeNewVault(storage, owner, encrypted), /already has/);
  assert.equal(records.get(key), encrypted);
});
test('cross-account record cannot be stored under another account', async () => {
  const records = new Map();
  const storage = {getItem:key=>records.get(key)??null, setItem:(key,val)=>records.set(key,val)};
  const encrypted = await seal();
  assert.throws(() => storeNewVault(storage, admin, encrypted), /does not belong/);
  assert.equal(records.size, 0);
});
