// Stage 6B2 — purely functional safety checks for a non-destructive
// account-specific encrypted PREVIEW copy. Never migrates or deletes legacy data.
import { DEVICE_DATA_KEY, DEVICE_OWNER_KEY, isDeviceOwnedBy } from "./stage6-device-owner.mjs";
import { vaultStorageKey } from "./stage6b-vault-core.mjs";

export function captureVaultPreview(storage, verifiedId) {
  if (!isDeviceOwnedBy(storage, verifiedId)) {
    throw new Error("SYNC LOCKED: this local history is not linked to the signed-in test account.");
  }
  const raw = storage.getItem(DEVICE_DATA_KEY);
  if (typeof raw !== "string" || !raw || new Blob([raw]).size > 20 * 1024 * 1024) {
    throw new Error("A valid local history under 20 MB is required.");
  }
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error("Local history cannot be parsed."); }
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      !data.sessions || typeof data.sessions !== "object" || Array.isArray(data.sessions) ||
      !["kg", "lb"].includes(data.unit)) throw new Error("Local workout history failed validation.");
  const ownerRaw = storage.getItem(DEVICE_OWNER_KEY);
  const key = vaultStorageKey(verifiedId);
  if (storage.getItem(key) !== null) {
    throw new Error("An encrypted preview already exists for this account; it cannot be overwritten.");
  }
  return Object.freeze({ userId: verifiedId, raw, ownerRaw, key, workoutCount: Object.keys(data.sessions).length });
}

export function requireUnchangedVaultPreview(storage, snapshot, verifiedId) {
  if (!snapshot || snapshot.userId !== verifiedId || !isDeviceOwnedBy(storage, verifiedId) ||
      storage.getItem(DEVICE_DATA_KEY) !== snapshot.raw ||
      storage.getItem(DEVICE_OWNER_KEY) !== snapshot.ownerRaw ||
      storage.getItem(snapshot.key) !== null) {
    throw new Error("Account, workout data, ownership or vault changed. No copy created. Download a new safety backup.");
  }
  return JSON.parse(snapshot.raw);
}
