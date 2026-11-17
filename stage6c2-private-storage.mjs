// Lift Journal 2.0 — Stage 6C2A EXPERIMENTAL encrypted write-through COMPARTMENT.
// Standalone localhost-only development prototype; NOT connected to index.html
// history editing, legacy imports, or any cloud syncing. No plaintext writes.
// v1 Stage 6B3 originals and lift-journal-v1 are never removed or replaced.
import { latestVault, vaultLocations } from "./stage6b-vault-recovery.mjs";
import { sealVault, openVault, vaultStorageKey } from "./stage6b-vault-core.mjs";
import { deviceOwnerStatus, DEVICE_OWNER_KEY, DEVICE_DATA_KEY } from "./stage6-device-owner.mjs";

export const PRIVATE_V2_PREFIX = "lift-journal-private-v2:";
const MAX_RECORD_SIZE = 32 * 1024 * 1024;
const MAX_REVISIONS = 1000000000;
const object = x => x !== null && typeof x === "object" && !Array.isArray(x);
const validText = x => typeof x === "string" && x.length > 0;
const fail = message => { throw Error(message); };
const ensureStorage = storage => {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function")
    fail("Browser storage is unavailable. No changes were made.");
};
const requireOwner = (storage, userId) => {
  vaultStorageKey(userId); // validates account ID
  if (deviceOwnerStatus(storage, userId).status !== "linked")
    fail("PRIVATE STORAGE LOCKED: only the linked verified test account may access this compartment.");
};
const sameOwner = (storage, userId, original) => {
  requireOwner(storage, userId);
  if (storage.getItem(DEVICE_OWNER_KEY) !== original)
    fail("Account/device ownership changed. Save stopped without updating the active compartment.");
};
const keyFor = (userId, suffix) => {
  vaultStorageKey(userId);
  return PRIVATE_V2_PREFIX + userId + ":" + suffix;
};
export const compartmentKeys = userId => Object.freeze({
  head: keyFor(userId, "head"), slots: Object.freeze([
    keyFor(userId, "slot-0"), keyFor(userId, "slot-1")
  ])
});
function validateData(data) {
  if (!object(data) || !object(data.sessions) || !["lb", "kg"].includes(data.unit))
    fail("Encrypted workout data has an invalid structure.");
  if (Object.keys(data.sessions).length > 10000) fail("Too many saved workouts.");
  return data;
}
function headRecord(userId, revision, slot) {
  return JSON.stringify({ version: 2, ownerId: userId, revision, slot });
}
function slotRecord(userId, revision, sealed) {
  if (!validText(sealed) || sealed.length > MAX_RECORD_SIZE)
    fail("Encrypted record exceeds the supported size.");
  const parsed = JSON.parse(sealed);
  if (!object(parsed) || parsed.version !== 1 || parsed.ownerId !== userId)
    fail("Encrypted record does not belong to this account.");
  return JSON.stringify({ version: 2, ownerId: userId, revision, sealed });
}
function parseHead(raw, userId) {
  let head;
  try { head = JSON.parse(raw); } catch { fail("Private storage head is unreadable; no automatic fallback."); }
  if (!object(head) || head.version !== 2 || head.ownerId !== userId ||
    !Number.isSafeInteger(head.revision) || head.revision < 1 ||
    head.revision > MAX_REVISIONS || ![0, 1].includes(head.slot))
    fail("Private storage head is damaged or belongs to another account.");
  return head;
}
function parseSlot(raw, userId, revision) {
  if (!validText(raw) || raw.length > MAX_RECORD_SIZE + 300)
    fail("Active private storage slot is missing or too large. No fallback was used.");
  let slot;
  try { slot = JSON.parse(raw); } catch { fail("Active private storage slot is damaged."); }
  if (!object(slot) || slot.version !== 2 || slot.ownerId !== userId ||
    slot.revision !== revision || !validText(slot.sealed))
    fail("Private storage revision mismatch or damaged slot. No fallback was used.");
  return slot;
}
export function inspectCompartment(storage, userId) {
  ensureStorage(storage);
  requireOwner(storage, userId);
  const keys = compartmentKeys(userId);
  const raw = storage.getItem(keys.head);
  const slots = keys.slots.map(k => storage.getItem(k));
  if (raw === null) {
    // Fail closed if interrupted creation left an orphan slot.
    if (slots.some(x => x !== null))
      fail("Incomplete private storage creation detected; preserving all existing records.");
    return Object.freeze({ exists: false, revision: 0, headRaw: null, slot: null });
  }
  const head = parseHead(raw, userId);
  parseSlot(slots[head.slot], userId, head.revision);
  return Object.freeze({ exists: true, revision: head.revision, headRaw: raw, slot: head.slot });
}
function requireHead(storage, userId, expectedHeadRaw) {
  const found = inspectCompartment(storage, userId);
  if (!found.exists || found.headRaw !== expectedHeadRaw)
    fail("Encrypted private history changed in another tab. Reload and unlock before saving.");
  return found;
}
async function verifiedCall(reverify) {
  if (typeof reverify !== "function")
    fail("Server identity re-verification is required before private storage writes.");
  const verifiedId = await reverify();
  if (!validText(verifiedId)) fail("Could not re-verify the current account.");
  return verifiedId;
}
async function withLock(userId, locks, action) {
  if (!locks || typeof locks.request !== "function")
    fail("Exclusive browser storage locks are unavailable. Nothing was written.");
  return locks.request("lj-stage6c2-private-v2-" + userId,
    { mode: "exclusive" }, action);
}
export async function openCompartment({ storage, userId, passphrase,
  decrypt = openVault, reverify }) {
  ensureStorage(storage);
  requireOwner(storage, userId);
  if (await verifiedCall(reverify) !== userId)
    fail("Current account does not match the private compartment.");
  const ownerRaw = storage.getItem(DEVICE_OWNER_KEY);
  const state = inspectCompartment(storage, userId);
  if (!state.exists) fail("This account has no Stage 6C2 encrypted compartment yet.");
  const raw = storage.getItem(compartmentKeys(userId).slots[state.slot]);
  const slot = parseSlot(raw, userId, state.revision);
  const data = validateData(await decrypt({ userId, passphrase, encryptedRecord: slot.sealed }));
  if (await verifiedCall(reverify) !== userId) fail("Account changed while decrypting.");
  sameOwner(storage, userId, ownerRaw);
  if (storage.getItem(compartmentKeys(userId).head) !== state.headRaw ||
    storage.getItem(compartmentKeys(userId).slots[state.slot]) !== raw)
    fail("Encrypted history changed while unlocking. Retry.");
  return Object.freeze({ data, headRaw: state.headRaw, revision: state.revision });
}
export async function createCompartment({ storage, userId, passphrase,
  encrypt = sealVault, decrypt = openVault, reverify, locks }) {
  ensureStorage(storage);
  requireOwner(storage, userId);
  // Fail before doing crypto if any existing v2 compartment or orphan exists.
  const first = inspectCompartment(storage, userId);
  if (first.exists) fail("Private compartment already exists. Nothing was overwritten.");
  const legacyRaw = storage.getItem(DEVICE_DATA_KEY);
  const ownerRaw = storage.getItem(DEVICE_OWNER_KEY);
  const sources = vaultLocations(userId).map(k => storage.getItem(k));
  const source = latestVault(storage, userId);
  if (!source) fail("A working Stage 6B3 encrypted copy is required.");
  const data = validateData(await decrypt({
    userId, passphrase, encryptedRecord: source.raw
  }));
  if (await verifiedCall(reverify) !== userId) fail("Account changed during encrypted source verification.");
  const sealed = await encrypt({ userId, passphrase, data });
  const check = validateData(await decrypt({ userId, passphrase, encryptedRecord: sealed }));
  if (JSON.stringify(check) !== JSON.stringify(data))
    fail("Encrypted verification failed. No private record was created.");
  return withLock(userId, locks, async () => {
    if (await verifiedCall(reverify) !== userId) fail("Account changed before creating private storage.");
    sameOwner(storage, userId, ownerRaw);
    if (storage.getItem(DEVICE_DATA_KEY) !== legacyRaw ||
      vaultLocations(userId).some((k, i) => storage.getItem(k) !== sources[i]))
      fail("Original local history or encrypted copy changed. Restart with a fresh backup.");
    if (inspectCompartment(storage, userId).exists)
      fail("Private storage was already created in another tab.");
    const keys = compartmentKeys(userId);
    const record = slotRecord(userId, 1, sealed);
    const headRaw = headRecord(userId, 1, 0);
    // Publish data in inactive slot BEFORE head. Never overwrite any prior slot.
    storage.setItem(keys.slots[0], record);
    if (storage.getItem(keys.slots[0]) !== record)
      fail("Encrypted record write failed verification. Existing backups were preserved.");
    storage.setItem(keys.head, headRaw);
    if (storage.getItem(keys.head) !== headRaw)
      fail("Encrypted head write failed verification. Existing backups were preserved.");
    return Object.freeze({ headRaw, revision: 1,
      workouts: Object.keys(data.sessions).length,
      favorites: Array.isArray(data.favoriteMovements) ? data.favoriteMovements.length : 0 });
  });
}
export async function commitCompartment({ storage, userId, passphrase, data,
  expectedHeadRaw, encrypt = sealVault, decrypt = openVault, reverify, locks }) {
  ensureStorage(storage);
  requireOwner(storage, userId);
  validateData(data);
  if (await verifiedCall(reverify) !== userId) fail("Current account changed.");
  const ownerRaw = storage.getItem(DEVICE_OWNER_KEY);
  // Never save against a stale head, even if the decrypted data is otherwise valid.
  requireHead(storage, userId, expectedHeadRaw);
  const sealed = await encrypt({ userId, passphrase, data });
  const roundtrip = validateData(await decrypt({ userId, passphrase, encryptedRecord: sealed }));
  if (JSON.stringify(roundtrip) !== JSON.stringify(data))
    fail("Encrypted save verification failed. No changes were committed.");
  return withLock(userId, locks, async () => {
    if (await verifiedCall(reverify) !== userId) fail("Account changed before the save.");
    sameOwner(storage, userId, ownerRaw);
    const current = requireHead(storage, userId, expectedHeadRaw);
    if (current.revision >= MAX_REVISIONS) fail("Private storage revision limit reached.");
    const inactive = 1 - current.slot;
    const keys = compartmentKeys(userId);
    const activeRaw = storage.getItem(keys.slots[current.slot]);
    const newRevision = current.revision + 1;
    const record = slotRecord(userId, newRevision, sealed);
    const headRaw = headRecord(userId, newRevision, inactive);
    storage.setItem(keys.slots[inactive], record);
    if (storage.getItem(keys.slots[inactive]) !== record ||
        storage.getItem(keys.head) !== expectedHeadRaw ||
        storage.getItem(keys.slots[current.slot]) !== activeRaw)
      fail("Save verification failed. The previous committed version remains active.");
    // The LAST step switches the authoritative revision. Interrupted writes
    // cannot silently remove the previous active ciphertext.
    storage.setItem(keys.head, headRaw);
    if (storage.getItem(keys.head) !== headRaw)
      fail("Private save could not be confirmed. Previous version may still be active.");
    return Object.freeze({ headRaw, revision: newRevision });
  });
}
