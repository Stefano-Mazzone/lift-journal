// Lift Journal 2.0 — opt-in, backup-file-to-cloud upload preview.
// This module NEVER reads or writes the live app's localStorage workout data.
// Import is completed workouts only; never upsert, update, delete or auto-sync.
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_SESSIONS = 10000;
const MAX_UPLOAD_WORKOUTS = 250;
const MAX_SESSION_BYTES = 128 * 1024;
const BATCH_SIZE = 10;

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const validDate = value => typeof value === "string" && !Number.isNaN(Date.parse(value));
const validMonth = value => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

function validateSession(id, session) {
  if (!id || id.length > 140 || /[\u0000-\u001f]/.test(id)) {
    throw new Error("Invalid or overly long workout identifier in backup.");
  }
  if (!object(session) || !Number.isInteger(session.day) ||
      session.day < 0 || session.day > 6 ||
      !validMonth(session.month) || !validDate(session.started) ||
      !Array.isArray(session.exercises) || session.exercises.length > 100) {
    throw new Error("Malformed workout session in the backup: " + id.slice(0, 40));
  }
  if (session.finished != null && !validDate(session.finished)) {
    throw new Error("Invalid completion timestamp for workout: " + id.slice(0, 40));
  }
  if (session.unit != null && !["lb", "kg"].includes(session.unit)) {
    throw new Error("Invalid weight unit in workout: " + id.slice(0, 40));
  }
  for (const exercise of session.exercises) {
    if (!object(exercise) || typeof exercise.name !== "string" ||
        !exercise.name.trim() || exercise.name.length > 150 ||
        !Array.isArray(exercise.sets) || exercise.sets.length > 100) {
      throw new Error("Malformed exercise in workout: " + id.slice(0, 40));
    }
    for (const set of exercise.sets) {
      if (!object(set) || !["number", "string", "undefined"].includes(typeof set.reps) ||
          !["number", "string", "undefined"].includes(typeof set.weight)) {
        throw new Error("Malformed set in workout: " + id.slice(0, 40));
      }
    }
  }
  if (JSON.stringify(session).length > MAX_SESSION_BYTES) {
    throw new Error("A workout exceeds the per-workout safety size limit.");
  }
}

function sessionDisplayName(session, date) {
  const fromPlan = session.planSnapshot?.days?.[session.day]?.[0];
  const name = session.name || fromPlan;
  return typeof name === "string" && name.trim() ? name.trim().slice(0, 120) :
    "Workout on " + date;
}

// A pure parser, independent of the page and credentials, to make fixture tests possible.
export function parseBackupForUpload(parsed) {
  if (!object(parsed) || parsed.format !== "lift-journal-v1" ||
      !object(parsed.data) || !object(parsed.data.sessions) ||
      !["lb", "kg"].includes(parsed.data.unit)) {
    throw new Error("Select an original Lift Journal Export backup (.json).");
  }
  const all = Object.entries(parsed.data.sessions);
  if (all.length > MAX_SESSIONS) throw new Error("This backup has too many sessions.");
  const entries = [];
  let unfinished = 0;
  for (const [id, session] of all) {
    validateSession(id, session);
    if (!session.finished) {
      unfinished++;
      continue; // Do not upload in-progress workouts during this pilot.
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(session.scheduledDate || "")) ?
      session.scheduledDate : session.started.slice(0, 10);
    const name = sessionDisplayName(session, date);
    // Preserve original completed-workout fields for a future opt-in restore.
    // This may include workout notes, check-ins, and training preferences.
    const workoutData = {
      ...session,
      name,
      unit: session.unit || parsed.data.unit,
      source: "lift-journal-backup",
      backupSessionId: id
    };
    entries.push({
      client_workout_id: "lj-session:" + id, date, name,
      exercises: session.exercises.length, workout_data: workoutData
    });
  }
  if (entries.length > MAX_UPLOAD_WORKOUTS) {
    throw new Error("This pilot supports up to " + MAX_UPLOAD_WORKOUTS +
      " completed workouts per backup. Nothing was uploaded.");
  }
  entries.sort((a, b) => b.date.localeCompare(a.date) ||
    a.client_workout_id.localeCompare(b.client_workout_id));
  return { entries, unfinished, total: all.length };
}

function chunks(values, size) {
  const result = [];
  for (let start = 0; start < values.length; start += size) {
    result.push(values.slice(start, start + size));
  }
  return result;
}

// Account-scoped, read-only duplicate discovery. A failed check blocks all uploads.
async function lookupExisting(client, userId, ids) {
  const seen = new Set();
  for (const part of chunks(ids, 50)) {
    if (!part.length) continue;
    const { data, error } = await client.from("workouts")
      .select("client_workout_id").eq("user_id", userId)
      .in("client_workout_id", part);
    if (error) throw new Error("Cannot check existing workouts: " + error.message);
    for (const row of data || []) seen.add(row.client_workout_id);
  }
  return seen;
}

export function initBackupUploader({ getClient, getUser, afterUpload }) {
  const pick = document.getElementById("backup-upload-file");
  const list = document.getElementById("backup-workouts-list");
  const summary = document.getElementById("backup-upload-summary");
  const upload = document.getElementById("backup-upload-button");
  const selectAll = document.getElementById("backup-select-all");
  const section = document.getElementById("backup-upload-section");
  if (!pick || !list || !summary || !upload || !selectAll || !section) {
    throw new Error("Backup uploader UI elements are missing.");
  }
  let accountId = null;
  let generation = 0;
  let busy = false;
  let snapshot = null;
  let existing = new Set();
  const chosen = new Set();

  function message(text, kind = "info") {
    summary.textContent = text;
    summary.dataset.kind = kind;
  }

  function updateButtons() {
    const selectable = (snapshot?.entries || []).filter(e => !existing.has(e.client_workout_id));
    const selected = selectable.filter(e => chosen.has(e.client_workout_id)).length;
    upload.disabled = busy || !accountId || selected === 0;
    upload.textContent = selected ? "Upload " + selected + " selected workout(s)" : "Upload selected workouts";
    selectAll.disabled = busy || !accountId || selectable.length === 0;
    pick.disabled = busy || !accountId;
  }

  function clear() {
    generation++;
    snapshot = null;
    existing = new Set();
    chosen.clear();
    pick.value = "";
    list.replaceChildren();
    message("Select a Lift Journal backup file to review workouts before uploading.");
    updateButtons();
  }

  function setAccount(nextUserId) {
    if (accountId === nextUserId) return;
    accountId = nextUserId || null;
    clear(); // Never leave one user's selected file visible under another account.
    section.hidden = !accountId;
  }

  function render() {
    list.replaceChildren();
    if (!snapshot) { updateButtons(); return; }
    for (const entry of snapshot.entries) {
      const isDuplicate = existing.has(entry.client_workout_id);
      const item = document.createElement("li");
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.disabled = busy || isDuplicate;
      checkbox.checked = !isDuplicate && chosen.has(entry.client_workout_id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) chosen.add(entry.client_workout_id);
        else chosen.delete(entry.client_workout_id);
        updateButtons();
      });
      const content = document.createElement("span");
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      title.textContent = entry.name;
      detail.textContent = entry.date + " · " + entry.exercises + " exercise(s)" +
        (isDuplicate ? " · ALREADY IN CLOUD — skipped" : "");
      content.append(title, detail);
      label.append(checkbox, content);
      item.append(label);
      list.append(item);
    }
    const skipped = snapshot.entries.filter(e => existing.has(e.client_workout_id)).length;
    message("Backup: " + snapshot.total + " total session(s); " +
      snapshot.unfinished + " unfinished excluded; " +
      skipped + " already in cloud; " +
      (snapshot.entries.length - skipped) + " completed workout(s) available to select.");
    updateButtons();
  }

  pick.addEventListener("change", async () => {
    const file = pick.files?.[0];
    const owner = accountId;
    const currentGeneration = ++generation;
    snapshot = null;
    existing = new Set();
    chosen.clear();
    list.replaceChildren();
    updateButtons();
    if (!file) { message("No backup selected."); return; }
    if (!owner || !getClient() || getUser()?.id !== owner) {
      message("Sign in to the correct test account before selecting a backup.", "error");
      return;
    }
    if (file.size > MAX_FILE_BYTES || file.size === 0) {
      message("Backup must be a non-empty JSON file under 20 MB.", "error");
      return;
    }
    busy = true;
    updateButtons();
    message("Reading the backup locally and checking cloud duplicates…");
    try {
      const parsed = JSON.parse(await file.text());
      const result = parseBackupForUpload(parsed);
      if (currentGeneration !== generation || accountId !== owner) return;
      const cloudIds = result.entries.map(e => e.client_workout_id);
      const duplicates = await lookupExisting(getClient(), owner, cloudIds);
      if (currentGeneration !== generation || accountId !== owner) return;
      snapshot = result;
      existing = duplicates;
      render();
    } catch (error) {
      if (currentGeneration === generation && accountId === owner) {
        snapshot = null;
        message("Backup not accepted: " + (error?.message || "Invalid JSON file"), "error");
      }
    } finally {
      if (currentGeneration === generation) {
        busy = false;
        render();
      }
    }
  });

  selectAll.addEventListener("click", () => {
    if (!snapshot || busy) return;
    for (const entry of snapshot.entries) {
      if (!existing.has(entry.client_workout_id)) chosen.add(entry.client_workout_id);
    }
    render();
  });

  upload.addEventListener("click", async () => {
    if (busy || !snapshot || !accountId) return;
    const owner = accountId;
    const user = getUser();
    if (!user || user.id !== owner || !getClient()) {
      message("The current account changed. Choose the backup again.", "error");
      return;
    }
    const selected = snapshot.entries.filter(e =>
      !existing.has(e.client_workout_id) && chosen.has(e.client_workout_id));
    if (!selected.length) return;
    const confirmed = window.confirm(
      "Upload " + selected.length + " completed workout(s) to " +
      (user.email || "your account") + "?\n\n" +
      "Workout data can include dates, exercises, weights, notes, check-ins and preferences.\n" +
      "Other backup sections (nutrition, running logs, favorites) are NOT uploaded.\n\n" +
      "Existing cloud records will NEVER be overwritten. Local data is unchanged. " +
      "This test version cannot automatically undo an upload."
    );
    if (!confirmed) return;
    const currentGeneration = generation;
    busy = true;
    render();
    let uploaded = 0, skipped = 0;
    try {
      // Recheck after confirmation to avoid accidental repeat uploads from old previews.
      const already = await lookupExisting(getClient(), owner,
        selected.map(e => e.client_workout_id));
      if (currentGeneration !== generation || getUser()?.id !== owner) return;
      const pending = selected.filter(e => !already.has(e.client_workout_id));
      skipped = selected.length - pending.length;
      for (const batch of chunks(pending, BATCH_SIZE)) {
        if (currentGeneration !== generation || getUser()?.id !== owner) {
          throw new Error("Account changed during upload. No further records were sent.");
        }
        const rows = batch.map(e => ({
          user_id: owner,
          client_workout_id: e.client_workout_id,
          workout_data: e.workout_data
        }));
        // Plain INSERT. Not UPSERT: never replace an existing workout.
        const { error } = await getClient().from("workouts").insert(rows);
        if (error) throw new Error(error.message + ". No existing records were overwritten.");
        uploaded += batch.length;
        message("Uploaded " + uploaded + " of " + pending.length + " new workout(s)…");
      }
      if (currentGeneration !== generation || getUser()?.id !== owner) return;
      chosen.clear();
      existing = await lookupExisting(getClient(), owner,
        snapshot.entries.map(e => e.client_workout_id));
      render();
      message("Upload finished: " + uploaded + " new, " + skipped +
        " already present. Original backup and device data unchanged.", "success");
      if (uploaded && typeof afterUpload === "function") await afterUpload(owner);
    } catch (error) {
      if (currentGeneration !== generation || accountId !== owner) return;
      message("Upload stopped after " + uploaded + " record(s): " +
        (error?.message || "Unknown error") +
        ". The source backup is safe. Re-select the file to check which rows were saved.", "error");
    } finally {
      if (currentGeneration === generation) {
        busy = false;
        updateButtons();
      }
    }
  });

  section.hidden = true;
  updateButtons();
  return { setAccount, clear };
}
