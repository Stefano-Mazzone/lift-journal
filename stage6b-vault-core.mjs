// Lift Journal 2.0 — Stage 6B1 EXPERIMENTAL per-account encrypted vault.
// Dormant module: NOT wired into the app, its localStorage data or cloud sync.
// This is a building block, NOT shared-browser privacy protection until the
// plaintext legacy key and live in-memory data are safely migrated/locked.
export const VAULT_PREFIX = 'lift-journal-private-v1:';
export const VAULT_VERSION = 1;
const ITERATIONS = 310000;
const MAX_PLAINTEXT = 20 * 1024 * 1024;
const MAX_RECORD = 32 * 1024 * 1024;
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
const validUser = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(id);
const plainObject = x => x && typeof x === 'object' && !Array.isArray(x);
const fail = message => { throw new Error(message); };

export function vaultStorageKey(userId) {
  if (!validUser(userId)) fail('A verified account ID is required.');
  return VAULT_PREFIX + userId;
}
function toBase64(bytes) {
  let result = '';
  for (let i = 0; i < bytes.length; i += 32768) {
    result += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  return btoa(result);
}
function fromBase64(value, expectedLength = null) {
  if (typeof value !== 'string' || !value || value.length > MAX_RECORD * 2 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail('Invalid encrypted vault encoding.');
  }
  let raw;
  try { raw = atob(value); } catch { fail('Invalid encrypted vault encoding.'); }
  if (expectedLength !== null && raw.length !== expectedLength) fail('Invalid encrypted vault parameters.');
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}
function requireData(data) {
  if (!plainObject(data) || !plainObject(data.sessions) ||
    !['kg', 'lb'].includes(data.unit)) fail('Workout backup structure is invalid.');
  return data;
}
function checkPassphrase(passphrase, creating) {
  if (typeof passphrase !== 'string' || (creating && passphrase.length < 12) ||
    passphrase.length > 1024 || passphrase.length === 0) {
    fail(creating ? 'Use a unique passphrase of at least 12 characters.' : 'A vault passphrase is required.');
  }
}
function provider(api) {
  if (!api?.subtle || typeof api.getRandomValues !== 'function') fail('Secure browser cryptography is unavailable.');
  return api;
}
function aadFor(userId) { return enc.encode('Lift Journal 2.0 vault v1\n' + userId); }
async function keyFor(api, passphrase, salt) {
  const raw = await api.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return api.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

// No plaintext is stored by this function. Caller must explicitly decide where
// to put the returned encrypted JSON; it never touches lift-journal-v1.
export async function sealVault({ userId, passphrase, data, cryptoProvider = globalThis.crypto }) {
  vaultStorageKey(userId);
  checkPassphrase(passphrase, true);
  const bytes = enc.encode(JSON.stringify(requireData(data)));
  if (!bytes.length || bytes.length > MAX_PLAINTEXT) fail('Workout data exceeds the encrypted-vault test limit.');
  const api = provider(cryptoProvider);
  const salt = api.getRandomValues(new Uint8Array(16));
  const iv = api.getRandomValues(new Uint8Array(12));
  const key = await keyFor(api, passphrase, salt);
  const ciphertext = new Uint8Array(await api.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadFor(userId), tagLength: 128 }, key, bytes
  ));
  return JSON.stringify({
    version: VAULT_VERSION, ownerId: userId,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv), data: toBase64(ciphertext) }
  });
}

// Refuse other-account ciphertext *before* decrypting. Never fall back to
// unencrypted data if authentication, metadata or ciphertext verification fail.
export async function openVault({ userId, passphrase, encryptedRecord, cryptoProvider = globalThis.crypto }) {
  vaultStorageKey(userId);
  checkPassphrase(passphrase, false);
  if (typeof encryptedRecord !== 'string' || encryptedRecord.length > MAX_RECORD) {
    fail('Encrypted vault is missing or too large.');
  }
  let value;
  try { value = JSON.parse(encryptedRecord); } catch { fail('Encrypted vault is invalid.'); }
  if (!plainObject(value) || value.version !== VAULT_VERSION || value.ownerId !== userId ||
    !plainObject(value.kdf) || value.kdf.name !== 'PBKDF2' ||
    value.kdf.hash !== 'SHA-256' || value.kdf.iterations !== ITERATIONS ||
    !plainObject(value.cipher) || value.cipher.name !== 'AES-GCM') {
    fail('Encrypted vault is invalid or belongs to another account.');
  }
  const salt = fromBase64(value.kdf.salt, 16);
  const iv = fromBase64(value.cipher.iv, 12);
  const ciphertext = fromBase64(value.cipher.data);
  if (ciphertext.length < 17 || ciphertext.length > MAX_PLAINTEXT + 16) {
    fail('Encrypted vault size is invalid.');
  }
  const api = provider(cryptoProvider);
  const key = await keyFor(api, passphrase, salt);
  let plain;
  try {
    plain = await api.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aadFor(userId), tagLength: 128 }, key, ciphertext
    );
  } catch { fail('Unable to unlock vault. Check account and passphrase; no data was changed.'); }
  let data;
  try { data = JSON.parse(dec.decode(plain)); } catch { fail('Decrypted workout data is invalid.'); }
  return requireData(data);
}

// Add-only test storage: never replace another encrypted record or touch the
// current plaintext Lift Journal key. Future migration requires explicit UI.
export function storeNewVault(storage, userId, encryptedRecord) {
  const key = vaultStorageKey(userId);
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    fail('Browser storage is unavailable.');
  }
  if (storage.getItem(key) !== null) fail('This account already has an encrypted vault. Nothing was overwritten.');
  if (typeof encryptedRecord !== 'string' || encryptedRecord.length > MAX_RECORD) fail('Invalid encrypted record.');
  let envelope;
  try { envelope = JSON.parse(encryptedRecord); } catch { fail('Encrypted vault is invalid.'); }
  if (!plainObject(envelope) || envelope.version !== VAULT_VERSION || envelope.ownerId !== userId) {
    fail('Vault record does not belong to this account.');
  }
  storage.setItem(key, encryptedRecord);
  if (storage.getItem(key) !== encryptedRecord) fail('Encrypted vault was not saved reliably.');
  return key;
}
