// Lift Journal 2.0 — Stage 6A sync ownership guard.
// Explicitly ties ONE browser-origin's existing local workout history to ONE
// authorized Supabase test-user ID. Prevents accidental cross-account sync.
// IMPORTANT: browser localStorage is NOT encryption or access control. Other
// users of the same browser profile may still view the local workout history.
// The association intentionally cannot be reassigned from the app.
export const DEVICE_OWNER_KEY = "lift-journal-sync-device-owner-v1";
export const DEVICE_DATA_KEY = "lift-journal-v1";
const STATES = new Set(["active", "review-required"]);
const validId = id => typeof id === "string" && id.length > 0 && id.length <= 160 &&
  /^[a-zA-Z0-9_-]+$/.test(id);
const validTime = time => typeof time === "string" && !Number.isNaN(Date.parse(time)) &&
  time.length <= 40;
const record = x => x !== null && typeof x === "object" && !Array.isArray(x);

export function parseDeviceOwner(raw) {
  if (raw === null) return { status: "unclaimed", owner: null };
  try {
    const value = JSON.parse(raw);
    if (!record(value) || value.version !== 1 || !validId(value.userId) ||
      !STATES.has(value.state) || !validTime(value.createdAt) ||
      !validTime(value.updatedAt)) throw new Error("Invalid device-ownership record.");
    return { status: "valid", owner: value };
  } catch {
    // Fail CLOSED, never silently reset or reassign a malformed record.
    return { status: "damaged", owner: null };
  }
}

export function deviceOwnerStatus(storage, userId) {
  if (!storage || typeof storage.getItem !== "function") throw new Error("Device storage unavailable.");
  let parsed;
  try { parsed = parseDeviceOwner(storage.getItem(DEVICE_OWNER_KEY)); }
  catch { return { status: "damaged", owner: null }; }
  if (parsed.status !== "valid") return parsed;
  if (!validId(userId)) return { status: "signed-out", owner: parsed.owner };
  if (parsed.owner.userId !== userId) return { status: "other-account", owner: parsed.owner };
  return { status: parsed.owner.state === "active" ? "linked" : "review-required", owner: parsed.owner };
}

export function isDeviceOwnedBy(storage, userId) {
  return deviceOwnerStatus(storage, userId).status === "linked";
}

export function bindDeviceOwner({ storage, verifiedId, expectedData, expectedOwnerRaw, now }) {
  if (!validId(verifiedId) || typeof expectedData !== "string" || !expectedData ||
      !validTime(now)) throw new Error("Cannot verify device ownership.");
  if (!storage || typeof storage.getItem !== "function" ||
      typeof storage.setItem !== "function") throw new Error("Browser storage unavailable.");
  if (storage.getItem(DEVICE_DATA_KEY) !== expectedData) {
    throw new Error("Workout data changed after the safety backup. Restart account linking.");
  }
  if (storage.getItem(DEVICE_OWNER_KEY) !== expectedOwnerRaw) {
    throw new Error("Device ownership changed. Restart account linking.");
  }
  const parsed = parseDeviceOwner(expectedOwnerRaw);
  if (parsed.status === "damaged") throw new Error("Device ownership is damaged. No changes were made.");
  if (parsed.status === "valid" && parsed.owner.userId !== verifiedId) {
    throw new Error("This device is already linked to a different account.");
  }
  if (parsed.status === "valid" && parsed.owner.state === "active") {
    throw new Error("This device is already linked to this account.");
  }
  const next = Object.freeze({
    version: 1,
    userId: verifiedId,
    state: "active",
    createdAt: parsed.status === "valid" ? parsed.owner.createdAt : now,
    updatedAt: now
  });
  const raw = JSON.stringify(next);
  storage.setItem(DEVICE_OWNER_KEY, raw);
  if (storage.getItem(DEVICE_OWNER_KEY) !== raw) {
    throw new Error("Device ownership could not be verified after saving.");
  }
  return { status: "linked", owner: next };
}

export function suspendDeviceOwnerAfterImport({ storage, now }) {
  if (!storage || typeof storage.getItem !== "function" ||
      typeof storage.setItem !== "function") throw new Error("Browser storage unavailable.");
  const raw = storage.getItem(DEVICE_OWNER_KEY);
  const parsed = parseDeviceOwner(raw);
  if (parsed.status === "unclaimed") return { status: "unclaimed", owner: null };
  if (parsed.status !== "valid") {
    throw new Error("Device ownership record is damaged. Import was blocked to protect sync ownership.");
  }
  if (!validTime(now)) throw new Error("Invalid ownership review time.");
  const next = {
    ...parsed.owner,
    state: "review-required",
    updatedAt: now
  };
  const value = JSON.stringify(next);
  storage.setItem(DEVICE_OWNER_KEY, value);
  if (storage.getItem(DEVICE_OWNER_KEY) !== value) {
    throw new Error("Could not lock cloud sync before importing. Import was blocked.");
  }
  return { status: "review-required", owner: next };
}
