// Lift Journal 2.0 — Stage 3: safe, offline-file merge preview.
// No localStorage reads/writes, no Supabase writes, no automatic restore.
// A user supplies a device's EXISTING full Lift Journal backup. Only completed,
// valid cloud sessions missing from that backup may be added to a NEW download.
import { fetchCloudWorkouts } from "./cloud-workout-download.mjs";

const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
const MAX_SESSIONS = 10000;
const MAX_NEW_WORKOUTS = 250;
const MAX_SESSION_CHARS = 128 * 1024;
const object = x => x !== null && typeof x === "object" && !Array.isArray(x);
const date = x => typeof x === "string" && !Number.isNaN(Date.parse(x));
const month = x => typeof x === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(x);
const owns = (o, key) => Object.prototype.hasOwnProperty.call(o, key);

// Mirror the production importer's core workout checks. No coercive repair:
// malformed records abort a merge or get flagged as non-restorable.
function validPlan(plan) {
  return object(plan) && Array.isArray(plan.days) &&
    plan.days.length >= 1 && plan.days.length <= 7 &&
    plan.days.every(day => Array.isArray(day) &&
      typeof day[0] === "string" && Array.isArray(day[1]) &&
      day[1].every(ex => object(ex) && typeof ex.name === "string" &&
        Number.isFinite(Number(ex.sets)) && Number(ex.sets) >= 1));
}

function checkSession(s) {
  if (!object(s) || !Number.isInteger(s.day) || s.day < 0 || s.day > 6 ||
      !month(s.month) || !date(s.started) ||
      !Array.isArray(s.exercises) || s.exercises.length > 100 ||
      (s.unit !== undefined && !["lb", "kg"].includes(s.unit)) ||
      (s.finished != null && !date(s.finished)) ||
      (s.planSnapshot && !validPlan(s.planSnapshot))) {
    return false;
  }
  for (const ex of s.exercises) {
    if (!object(ex) || typeof ex.name !== "string" || !ex.name.trim() ||
        !Array.isArray(ex.sets) || ex.sets.length > 100) return false;
    for (const set of ex.sets) {
      if (!object(set) ||
          !["string", "number", "undefined"].includes(typeof set.reps) ||
          !["string", "number", "undefined"].includes(typeof set.weight)) return false;
    }
  }
  return JSON.stringify(s).length <= MAX_SESSION_CHARS;
}

export function validateDeviceBackup(backup) {
  if (!object(backup) || backup.format !== "lift-journal-v1" ||
      !object(backup.data) || !object(backup.data.sessions) ||
      !["lb", "kg"].includes(backup.data.unit)) {
    throw new Error("Choose a full backup exported from Lift Journal → Settings → Export backup (.json).");
  }
  const entries = Object.entries(backup.data.sessions);
  if (entries.length > MAX_SESSIONS) throw new Error("The device backup has too many workouts.");
  for (const [id, session] of entries) {
    if (!id || !checkSession(session)) {
      throw new Error("The device backup contains an invalid workout. Nothing was changed.");
    }
  }
  if (backup.data.customPlan && !validPlan(backup.data.customPlan)) {
    throw new Error("The device backup has an invalid custom training plan.");
  }
  if (backup.data.schedule !== undefined && !object(backup.data.schedule)) {
    throw new Error("The device backup has an invalid schedule.");
  }
  if (backup.data.nutrition !== undefined &&
      (!object(backup.data.nutrition) || !object(backup.data.nutrition.entries))) {
    throw new Error("The device backup has an invalid nutrition log.");
  }
  return backup.data;
}

function originalKey(row) {
  const cloudId = row?.client_workout_id;
  if (typeof cloudId !== "string" || !cloudId.startsWith("lj-session:")) return null;
  const id = cloudId.slice("lj-session:".length);
  // Avoid unsafe object keys and malformed/overlong identifiers.
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,139}$/.test(id) ||
      ["__proto__", "constructor", "prototype"].includes(id)) return null;
  return id;
}

function comparableSignature(workout) {
  // A second workout with the same exact start/end time might be a copied
  // session with a changed key. Keep it out by default; never guess or overwrite.
  if (!workout?.finished || !workout?.started) return null;
  return workout.started + "|" + workout.finished;
}

function cloudEntryStatus(row, target, existingTimeSignatures) {
  const id = originalKey(row);
  if (!id || !checkSession(row.workout_data) || !row.workout_data.finished ||
      (row.workout_data.backupSessionId != null &&
       row.workout_data.backupSessionId !== id)) {
    return { status: "unsupported", reason: "Not a complete, compatible original Lift Journal workout." };
  }
  if (owns(target, id)) {
    return { status: "already", reason: "Session ID already exists on this device — never overwritten." };
  }
  if (existingTimeSignatures.has(comparableSignature(row.workout_data))) {
    return { status: "possible-duplicate", reason: "A device workout has the same start/end time — skipped to prevent duplication." };
  }
  return { status: "eligible", reason: "Missing on this device — available for safe addition." };
}

export function planWorkoutMerge(deviceBackup, cloudRows) {
  const base = validateDeviceBackup(deviceBackup);
  if (!Array.isArray(cloudRows) || cloudRows.length > MAX_SESSIONS) {
    throw new Error("The cloud workout list is invalid or too large.");
  }
  const existingTimeSignatures = new Set(
    Object.values(base.sessions).map(comparableSignature).filter(Boolean)
  );
  const seen = new Set();
  const entries = [];
  for (const row of cloudRows) {
    if (!object(row) || typeof row.client_workout_id !== "string" ||
        seen.has(row.client_workout_id)) {
      throw new Error("Duplicate or malformed cloud workout identifiers. Merge stopped.");
    }
    seen.add(row.client_workout_id);
    const status = cloudEntryStatus(row, base.sessions, existingTimeSignatures);
    const name = typeof row.workout_data?.name === "string" &&
      row.workout_data.name.trim() ?
      row.workout_data.name.trim().slice(0, 100) : "Cloud workout";
    const when = typeof row.workout_data?.scheduledDate === "string" ?
      row.workout_data.scheduledDate :
      typeof row.workout_data?.started === "string" ?
        row.workout_data.started.slice(0, 10) : "Date unavailable";
    entries.push({
      id: row.client_workout_id,
      originalId: originalKey(row),
      name, date: when,
      exercises: Array.isArray(row.workout_data?.exercises) ?
        row.workout_data.exercises.length : 0,
      ...status
    });
  }
  const counts = entries.reduce((obj, item) => {
    obj[item.status] = (obj[item.status] || 0) + 1;
    return obj;
  }, { eligible: 0, already: 0, unsupported: 0, "possible-duplicate": 0 });
  return {
    deviceCount: Object.keys(base.sessions).length,
    cloudCount: entries.length,
    counts, entries
  };
}

export function createMergedDeviceBackup(deviceBackup, cloudRows, selectedCloudIds, exportedAt) {
  const plan = planWorkoutMerge(deviceBackup, cloudRows);
  if (!Array.isArray(selectedCloudIds) || selectedCloudIds.length === 0 ||
      selectedCloudIds.length > MAX_NEW_WORKOUTS ||
      new Set(selectedCloudIds).size !== selectedCloudIds.length ||
      !date(exportedAt)) {
    throw new Error("Select 1–250 compatible cloud workouts and a valid export date.");
  }
  const candidates = new Map(plan.entries.filter(x => x.status === "eligible").map(x => [x.id, x]));
  const source = new Map(cloudRows.map(x => [x.client_workout_id, x]));
  const additions = [];
  for (const cloudId of selectedCloudIds) {
    const entry = candidates.get(cloudId);
    const row = source.get(cloudId);
    if (!entry || !row) {
      throw new Error("A selected cloud workout is missing, duplicated or incompatible. Nothing was merged.");
    }
    additions.push([entry.originalId, row.workout_data]);
  }
  if (plan.deviceCount + additions.length > MAX_SESSIONS) {
    throw new Error("Merged backup would exceed 10,000 workouts. Nothing was merged.");
  }
  // Deep-copy preserves ALL other sections of the destination-device backup:
  // existing sessions, program, nutrition, running logs, favorites, schedule, etc.
  const cloned = JSON.parse(JSON.stringify(deviceBackup));
  cloned.data.sessions = {
    ...cloned.data.sessions,
    ...Object.fromEntries(additions)
  };
  cloned.exported = exportedAt;
  const json = JSON.stringify(cloned, null, 2);
  if (new Blob([json]).size > MAX_BACKUP_BYTES) {
    throw new Error("Merged backup exceeds the live app's 20 MB import limit.");
  }
  // Verify the result using exactly the same core validation path as inputs.
  validateDeviceBackup(cloned);
  if (Object.keys(cloned.data.sessions).length !== plan.deviceCount + additions.length) {
    throw new Error("Mismatch in merged workout count. No file produced.");
  }
  return { json, added: additions.length, deviceCount: plan.deviceCount, total: plan.deviceCount + additions.length };
}

// Local-only user interface: reads selected .json backup and the owner's cloud records,
// never the live app's localStorage, and never POST/PATCH/DELETE in Supabase.
export function initCloudMerge({ getClient, getUser }) {
  const $ = id => document.getElementById(id);
  const section = $("cloud-merge-section");
  const fileInput = $("merge-device-file");
  const compareButton = $("merge-compare");
  const selectButton = $("merge-select-all");
  const downloadButton = $("merge-download");
  const status = $("merge-status");
  const list = $("merge-list");
  if ([section, fileInput, compareButton, selectButton, downloadButton, status, list].some(x => !x)) {
    throw new Error("Stage 3 merge interface is incomplete.");
  }

  let owner = null;
  let fileName = "";
  let backup = null;
  let cloud = null;
  let plan = null;
  let loading = false;
  let seq = 0;
  const selected = new Set();

  function announce(message, kind = "info") {
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function buttons() {
    const available = plan?.entries.filter(x => x.status === "eligible") || [];
    const selectedCount = available.filter(x => selected.has(x.id)).length;
    fileInput.disabled = loading || !owner;
    compareButton.disabled = loading || !owner || !backup;
    selectButton.disabled = loading || !available.length;
    downloadButton.disabled = loading || !selectedCount;
    downloadButton.textContent = selectedCount ?
      "Create merged backup with " + selectedCount + " workout(s)" :
      "Create merged backup (.json)";
  }

  function clear() {
    seq++;
    loading = false;
    fileName = "";
    backup = null;
    cloud = null;
    plan = null;
    selected.clear();
    fileInput.value = "";
    list.replaceChildren();
    announce("Start by selecting an Export backup file from the destination device.");
    buttons();
  }

  function setAccount(nextId) {
    if (owner === nextId) return;
    owner = nextId || null;
    clear();
    section.hidden = !owner;
  }

  function render() {
    list.replaceChildren();
    for (const item of plan?.entries || []) {
      const li = document.createElement("li");
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.disabled = loading || item.status !== "eligible";
      checkbox.checked = item.status === "eligible" && selected.has(item.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(item.id);
        else selected.delete(item.id);
        buttons();
      });
      const content = document.createElement("span");
      const name = document.createElement("strong");
      const details = document.createElement("small");
      name.textContent = item.name;
      details.textContent = item.date + " · " + item.exercises +
        " exercise(s) · " + item.reason;
      content.append(name, details);
      label.append(checkbox, content);
      li.append(label);
      list.append(li);
    }
    buttons();
  }

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    const current = ++seq;
    backup = null;
    plan = null;
    cloud = null;
    selected.clear();
    list.replaceChildren();
    buttons();
    if (!file) return;
    if (!owner || getUser()?.id !== owner) {
      announce("Sign in first, then choose the destination device's backup.", "error");
      return;
    }
    if (file.size === 0 || file.size > MAX_BACKUP_BYTES) {
      announce("Device backup must be under 20 MB and cannot be empty.", "error");
      return;
    }
    loading = true;
    buttons();
    announce("Validating the destination-device backup locally…");
    try {
      const parsed = JSON.parse(await file.text());
      validateDeviceBackup(parsed);
      if (current !== seq || getUser()?.id !== owner) return;
      backup = parsed;
      fileName = file.name;
      announce("Device backup verified: " +
        Object.keys(backup.data.sessions).length + " workout(s). Click Compare with cloud.");
    } catch (error) {
      if (current === seq) announce("Backup rejected: " + (error?.message || "Invalid JSON"), "error");
    } finally {
      if (current === seq) {
        loading = false;
        buttons();
      }
    }
  });

  compareButton.addEventListener("click", async () => {
    if (loading || !owner || !backup || getUser()?.id !== owner || !getClient()) return;
    const request = ++seq, accountId = owner, originalBackup = backup;
    cloud = null;
    plan = null;
    selected.clear();
    loading = true;
    list.replaceChildren();
    buttons();
    announce("Comparing the device backup against all your private cloud workouts…");
    try {
      const records = await fetchCloudWorkouts(getClient(), accountId,
        () => request === seq && getUser()?.id === accountId);
      if (request !== seq || getUser()?.id !== accountId || backup !== originalBackup) return;
      cloud = records;
      plan = planWorkoutMerge(backup, cloud);
      render();
      announce("Device has " + plan.deviceCount + " workout(s). Cloud has " +
        plan.cloudCount + ": " + plan.counts.eligible + " missing and compatible; " +
        plan.counts.already + " already on device; " +
        plan.counts["possible-duplicate"] + " possible duplicate(s); " +
        plan.counts.unsupported + " incompatible/sample record(s). " +
        "Select only missing workouts to add.", "success");
    } catch (error) {
      if (request === seq) {
        cloud = null;
        plan = null;
        list.replaceChildren();
        announce("Comparison stopped: " + (error?.message || "Cloud read failed"), "error");
      }
    } finally {
      if (request === seq) {
        loading = false;
        buttons();
      }
    }
  });

  selectButton.addEventListener("click", () => {
    if (loading || !plan) return;
    for (const item of plan.entries) {
      if (item.status === "eligible") selected.add(item.id);
    }
    render();
  });

  downloadButton.addEventListener("click", () => {
    if (loading || !plan || !backup || !cloud || !owner || getUser()?.id !== owner) return;
    const chosen = plan.entries.filter(item => item.status === "eligible" && selected.has(item.id));
    if (!chosen.length) return;
    const email = getUser()?.email || "this account";
    if (!window.confirm(
      "CREATE A NEW MERGED BACKUP FOR REVIEW?\n\n" +
      "Cloud account: " + email + "\n" +
      "Destination backup: " + fileName + "\n" +
      "Original device workouts: " + plan.deviceCount + "\n" +
      "Additional workouts selected: " + chosen.length + "\n\n" +
      "The new backup retains existing workouts, running logs, nutrition, favorites, and settings.\n" +
      "It does not change this device, the original backup, or Supabase.\n\n" +
      "IMPORTANT: The live Lift Journal Import Backup feature REPLACES local data. " +
      "Do NOT import this merged file into your real app during this test."
    )) return;
    if (getUser()?.id !== owner) return;
    try {
      const now = new Date().toISOString();
      const merged = createMergedDeviceBackup(backup, cloud, chosen.map(x => x.id), now);
      const blob = new Blob([merged.json], { type: "application/json" });
      const link = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = link;
      anchor.download = "lift-journal-MERGED-PREVIEW-" + now.slice(0, 10) + ".json";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(link), 10000);
      announce("Generated a NEW review-only merged backup: " + merged.deviceCount +
        " original + " + merged.added + " selected cloud = " + merged.total +
        " workout(s). No existing device or cloud data was changed. " +
        "Do not import into the live app yet.", "success");
    } catch (error) {
      announce("No merged file created: " + (error?.message || "Merge failed"), "error");
    }
  });

  section.hidden = true;
  buttons();
  return { setAccount, clear };
}
