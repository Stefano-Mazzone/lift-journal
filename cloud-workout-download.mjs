// Lift Journal 2.0 — Stage 2: account-scoped, read-only cloud workout download.
// This module NEVER touches the live app's localStorage workout data.
// Cloud export is intentionally NOT the destructive Lift Journal Import Backup format.
const PAGE_SIZE = 200;
const MAX_CLOUD_ROWS = 5000;
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);

function isCloudWorkout(row) {
  return record(row) && typeof row.client_workout_id === "string" &&
    row.client_workout_id.length > 0 && row.client_workout_id.length <= 160 &&
    record(row.workout_data) && typeof row.created_at === "string" &&
    !Number.isNaN(Date.parse(row.created_at)) &&
    typeof row.updated_at === "string" &&
    !Number.isNaN(Date.parse(row.updated_at));
}

export function buildCloudWorkoutArchive(rows, exportedAt) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_CLOUD_ROWS ||
      !rows.every(isCloudWorkout) || typeof exportedAt !== "string" ||
      Number.isNaN(Date.parse(exportedAt))) {
    throw new Error("Cloud workout data is invalid or exceeds the export limit.");
  }
  const ids = new Set(rows.map(row => row.client_workout_id));
  if (ids.size !== rows.length) throw new Error("Duplicate cloud workout IDs detected. Nothing was downloaded.");
  const archive = {
    format: "lift-journal-cloud-workouts-v1",
    exported: exportedAt,
    workout_count: rows.length,
    note: "Private cloud workout archive. This is NOT a Lift Journal Import Backup file. Import Backup in the live app REPLACES local data; do not use it with this archive.",
    workouts: rows.map(row => ({
      client_workout_id: row.client_workout_id,
      workout_data: row.workout_data,
      created_at: row.created_at,
      updated_at: row.updated_at
    }))
  };
  const json = JSON.stringify(archive, null, 2);
  if (new Blob([json]).size > MAX_ARCHIVE_BYTES) {
    throw new Error("Selected cloud workout archive exceeds 20 MB. Select fewer workouts.");
  }
  return json;
}

function displayWorkout(row) {
  const workout = row.workout_data;
  const title = typeof workout.name === "string" && workout.name.trim() ?
    workout.name.trim().slice(0, 120) : "Cloud workout";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(workout.scheduledDate || "")) ?
    workout.scheduledDate : row.created_at.slice(0, 10);
  const exercises = Array.isArray(workout.exercises) ? workout.exercises.length : 0;
  return { title, date, exercises };
}

// Fetch *all* authorized cloud workouts. The small default preview only lists 25,
// so it cannot safely be used as a complete download source.
export async function fetchCloudWorkouts(client, ownerId, isCurrent = () => true) {
  if (!client || typeof ownerId !== "string" || !ownerId ||
      typeof isCurrent !== "function") throw new Error("Sign in first.");
  const all = [];
  let expectedCount = null;
  while (true) {
    if (!isCurrent()) throw new Error("Account changed; download was stopped.");
    const start = all.length;
    const { data, error, count } = await client.from("workouts")
      .select("client_workout_id,workout_data,created_at,updated_at",
        start === 0 ? { count: "exact" } : undefined)
      .eq("user_id", ownerId)
      .order("created_at", { ascending: false })
      .order("client_workout_id", { ascending: true })
      .range(start, start + PAGE_SIZE - 1);
    if (!isCurrent()) throw new Error("Account changed; download was stopped.");
    if (error) throw new Error("Cloud read failed: " + error.message);
    if (!Array.isArray(data)) throw new Error("Cloud returned an invalid response.");
    if (start === 0) {
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error("Cannot verify the full cloud workout count.");
      }
      if (count > MAX_CLOUD_ROWS) {
        throw new Error("Too many workouts for this pilot. Contact support for a safe export.");
      }
      expectedCount = count;
    }
    if (!data.every(isCloudWorkout)) {
      throw new Error("Cloud contains unexpected workout data. Nothing was downloaded.");
    }
    all.push(...data);
    if (all.length > MAX_CLOUD_ROWS || all.length > expectedCount) {
      throw new Error("Cloud workout results changed during loading. Refresh and retry.");
    }
    if (all.length === expectedCount) break;
    if (data.length !== PAGE_SIZE) {
      throw new Error("Incomplete cloud workout results. Refresh and retry.");
    }
  }
  if (new Set(all.map(row => row.client_workout_id)).size !== all.length) {
    throw new Error("Cloud workout list changed while downloading. Refresh and retry.");
  }
  return all;
}

export function initCloudDownloader({ getClient, getUser }) {
  const section = document.getElementById("cloud-download-section");
  const loadButton = document.getElementById("cloud-download-load");
  const selectAllButton = document.getElementById("cloud-download-select-all");
  const downloadButton = document.getElementById("cloud-download-button");
  const status = document.getElementById("cloud-download-status");
  const list = document.getElementById("cloud-download-list");
  if (!section || !loadButton || !selectAllButton || !downloadButton || !status || !list) {
    throw new Error("Cloud download UI is missing.");
  }
  let accountId = null;
  let generation = 0;
  let loading = false;
  let rows = null;
  const chosen = new Set();

  function announce(message, kind = "info") {
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function refreshButtons() {
    const selected = (rows || []).filter(row => chosen.has(row.client_workout_id)).length;
    loadButton.disabled = loading || !accountId;
    selectAllButton.disabled = loading || !rows?.length;
    downloadButton.disabled = loading || selected === 0;
    downloadButton.textContent = selected ?
      "Download " + selected + " selected workout(s) (.json)" : "Download selected workouts (.json)";
  }

  function clear() {
    generation++;
    rows = null;
    chosen.clear();
    list.replaceChildren();
    announce("Load your cloud workouts to review and choose which ones to download.");
    refreshButtons();
  }

  function setAccount(ownerId) {
    if (accountId === ownerId) return;
    accountId = ownerId || null;
    clear();
    section.hidden = !accountId;
  }

  function render() {
    list.replaceChildren();
    for (const row of rows || []) {
      const view = displayWorkout(row);
      const item = document.createElement("li");
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.disabled = loading;
      checkbox.checked = chosen.has(row.client_workout_id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) chosen.add(row.client_workout_id);
        else chosen.delete(row.client_workout_id);
        refreshButtons();
      });
      const content = document.createElement("span");
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      title.textContent = view.title;
      detail.textContent = view.date + " · " + view.exercises + " exercise(s)";
      content.append(title, detail);
      label.append(checkbox, content);
      item.append(label);
      list.append(item);
    }
    refreshButtons();
  }

  loadButton.addEventListener("click", async () => {
    if (!accountId || loading || getUser()?.id !== accountId || !getClient()) return;
    const owner = accountId;
    const request = ++generation;
    rows = null;
    chosen.clear();
    loading = true;
    list.replaceChildren();
    refreshButtons();
    announce("Checking and loading all your cloud workouts…");
    try {
      const data = await fetchCloudWorkouts(getClient(), owner,
        () => request === generation && getUser()?.id === owner);
      if (request !== generation || getUser()?.id !== owner) return;
      rows = data;
      render();
      announce(data.length ? "Loaded " + data.length + " cloud workout(s). Select the ones to download." :
        "No cloud workouts found in this account.",
        data.length ? "success" : "info");
    } catch (error) {
      if (request === generation && accountId === owner) {
        rows = null;
        list.replaceChildren();
        announce("Nothing downloaded: " + (error?.message || "Unable to read cloud workouts."), "error");
      }
    } finally {
      if (request === generation) {
        loading = false;
        refreshButtons();
      }
    }
  });

  selectAllButton.addEventListener("click", () => {
    if (!rows?.length || loading) return;
    for (const row of rows) chosen.add(row.client_workout_id);
    render();
  });

  downloadButton.addEventListener("click", () => {
    if (!rows?.length || loading || !accountId || getUser()?.id !== accountId) return;
    const selected = rows.filter(row => chosen.has(row.client_workout_id));
    if (!selected.length) return;
    const email = getUser()?.email || "your account";
    if (!window.confirm(
      "Download " + selected.length + " cloud workout(s) from " + email + " as a private JSON archive?\n\n" +
      "The file may contain personal workout notes, check-ins, dates, sets and weights.\n" +
      "This does NOT add workouts to this device's Lift Journal history, and does NOT change anything in Supabase.\n\n" +
      "IMPORTANT: Do not use Lift Journal's existing Import Backup action with this file; that action REPLACES local data. " +
      "A safe cloud-to-device merge will be developed separately."
    )) return;
    if (getUser()?.id !== accountId) return;
    try {
      const exportedAt = new Date().toISOString();
      const json = buildCloudWorkoutArchive(selected, exportedAt);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "lift-journal-cloud-workouts-" + exportedAt.slice(0, 10) + ".json";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      announce("Your browser was asked to save " + selected.length +
        " workout(s) as a private JSON file. Keep it somewhere secure; cloud and device data were not modified.", "success");
    } catch (error) {
      announce("Export failed: " + (error?.message || "Unknown error"), "error");
    }
  });

  section.hidden = true;
  refreshButtons();
  return { setAccount, clear };
}
