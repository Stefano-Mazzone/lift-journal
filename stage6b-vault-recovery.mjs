// Lift Journal 2.0 Stage 6B3 — non-destructive recovery slots.
// Recovery re-encrypts ONLY the existing fictional plaintext history. It cannot
// decrypt/recover an old vault with an unknown passphrase and NEVER removes it.
// This module does not alter the legacy history or cloud storage.
import { DEVICE_DATA_KEY, DEVICE_OWNER_KEY, isDeviceOwnedBy } from "./stage6-device-owner.mjs";
import { vaultStorageKey } from "./stage6b-vault-core.mjs";

const MAX_SLOTS = 3;
const MAX_LOCAL_BYTES = 20 * 1024 * 1024;
const MAX_VAULT_BYTES = 32 * 1024 * 1024;
const object = x => x !== null && typeof x === "object" && !Array.isArray(x);

export function recoveryVaultKey(userId, slot) {
  const original = vaultStorageKey(userId); // validates the ID
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_SLOTS) throw Error("Invalid recovery slot.");
  return original + ":recovery-" + slot;
}
export function vaultLocations(userId) {
  return [vaultStorageKey(userId), ...Array.from({ length: MAX_SLOTS }, (_, i) => recoveryVaultKey(userId, i + 1))];
}
export function latestVault(storage, userId) {
  if (!storage || typeof storage.getItem !== "function") throw Error("Browser storage unavailable.");
  const keys = vaultLocations(userId);
  // The newest slot is authoritative. Never silently fall back if it is
  // damaged or the passphrase is incorrect; disclose that failure.
  for (let i = keys.length - 1; i >= 0; i--) {
    const raw = storage.getItem(keys[i]);
    if (raw !== null) return Object.freeze({ key: keys[i], slot: i, raw });
  }
  return null;
}
function verifiedHistory(storage, userId) {
  if (!isDeviceOwnedBy(storage, userId)) throw Error("SYNC LOCKED: only the linked test account may recover its preview.");
  const raw = storage.getItem(DEVICE_DATA_KEY);
  if (typeof raw !== "string" || !raw || new Blob([raw]).size > MAX_LOCAL_BYTES) {
    throw Error("Valid fictional local history under 20 MB is required.");
  }
  let data;
  try { data = JSON.parse(raw); } catch { throw Error("Local history is unreadable. Stop without changing data."); }
  if (!object(data) || !object(data.sessions) || !["lb", "kg"].includes(data.unit)) {
    throw Error("Local history has an invalid workout structure.");
  }
  return { raw, data };
}
export function captureVaultRecovery(storage, userId) {
  const { raw, data } = verifiedHistory(storage, userId);
  const keys = vaultLocations(userId);
  const records = keys.map(key => storage.getItem(key));
  if (records[0] === null) throw Error("No original encrypted test copy exists to recover.");
  const targetIndex = records.findIndex((value, index) => index > 0 && value === null);
  if (targetIndex < 0) throw Error("All encrypted recovery slots are used. Nothing was overwritten.");
  const ownerRaw = storage.getItem(DEVICE_OWNER_KEY);
  return Object.freeze({
    userId, dataRaw: raw, ownerRaw, keys, records, targetIndex,
    targetKey: keys[targetIndex], workoutCount: Object.keys(data.sessions).length,
    favoriteCount: Array.isArray(data.favoriteMovements) ? data.favoriteMovements.length : 0
  });
}
export function requireUnchangedVaultRecovery(storage, captured, userId) {
  if (!captured || captured.userId !== userId) throw Error("Recovery account changed.");
  const { raw } = verifiedHistory(storage, userId);
  if (raw !== captured.dataRaw || storage.getItem(DEVICE_OWNER_KEY) !== captured.ownerRaw ||
    captured.keys.some((key, i) => storage.getItem(key) !== captured.records[i])) {
    throw Error("Account, history, ownership or an encrypted copy changed. Save a fresh safety backup and restart.");
  }
  return JSON.parse(raw);
}
export function storeRecoveryVault(storage, captured, userId, encryptedRecord) {
  requireUnchangedVaultRecovery(storage, captured, userId);
  if (typeof encryptedRecord !== "string" || encryptedRecord.length > MAX_VAULT_BYTES) {
    throw Error("Recovery ciphertext invalid or too large.");
  }
  let value;
  try { value = JSON.parse(encryptedRecord); } catch { throw Error("Encrypted recovery record invalid."); }
  if (!object(value) || value.version !== 1 || value.ownerId !== userId ||
    !object(value.kdf) || !object(value.cipher) || value.cipher.name !== "AES-GCM") {
    throw Error("Encrypted recovery does not belong to the verified account.");
  }
  storage.setItem(captured.targetKey, encryptedRecord);
  if (storage.getItem(captured.targetKey) !== encryptedRecord) {
    throw Error("Recovered encrypted copy could not be verified after saving.");
  }
  return captured.targetKey;
}
