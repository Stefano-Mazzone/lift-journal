// Lift Journal 2.0 — Stage 5B: MANUAL, backup-gated cloud sync inside Settings.
// Runs exclusively for verified existing TEST accounts at localhost/127.0.0.1.
// No background sync, no cloud overwrites/deletions, and no automatic uploads.
// Reuses Stage 4's production-compatible session validation and RLS cloud reads.
import { fetchCloudWorkouts } from "./cloud-workout-download.mjs";
import { buildSyncPlan, makeSafetyBackup, planSelectedSync } from "./cloud-sync-core.mjs";
import { isDeviceOwnedBy } from "./stage6-device-owner.mjs";

const KEY = "lift-journal-v1";
const MAX_DATA_BYTES = 20 * 1024 * 1024;
const MAX_CHANGES = 25;
const localTestHost = location.hostname === "127.0.0.1" || location.hostname === "localhost";

function saveFile(json, name) {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function createSettingsManualSync({ getClient, getUser }) {
  if (typeof getClient !== "function" || typeof getUser !== "function") {
    throw new Error("A verified test account provider is required.");
  }
  let root = null;
  let ownerId = null;
  let snapshot = null;
  let requestId = 0;
  let busy = false;
  let backupRequested = false;
  const uploads = new Set(), downloads = new Set();
  const el = id => root?.querySelector("#" + id) || null;
  const isMounted = () => localTestHost && !!root?.isConnected &&
    document.getElementById("lj-stage5-sync-root") === root &&
    !!getClient() && !!ownerId && getUser()?.id === ownerId;
  // Ownership is checked live before every fetch, upload and local save.
  // The same browser history cannot be silently synced under a new account.
  const isOwned = () => isMounted() && isDeviceOwnedBy(localStorage, ownerId);

  function message(content, kind = "info") {
    const status = el("lj5-sync-status");
    if (!status) return;
    status.textContent = content;
    status.dataset.kind = kind;
  }

  function clear() {
    requestId++;
    // A Settings rerender or account switch can invalidate an in-flight fetch.
    // Release the busy latch immediately, otherwise the new account may
    // remain permanently unable to compare until a full page reload.
    busy = false;
    snapshot = null;
    backupRequested = false;
    uploads.clear();
    downloads.clear();
    const backupCheck = el("lj5-sync-backup-ack");
    const ownerCheck = el("lj5-sync-owner-ack");
    if (backupCheck) backupCheck.checked = false;
    if (ownerCheck) ownerCheck.checked = false;
    for (const id of ["lj5-sync-upload-list", "lj5-sync-download-list"]) el(id)?.replaceChildren();
    for (const id of ["lj5-sync-local", "lj5-sync-cloud", "lj5-sync-up-count", "lj5-sync-down-count", "lj5-sync-conflicts"]) {
      const node = el(id);
      if (node) node.textContent = "—";
    }
    update();
  }

  function update() {
    if (!root) return;
    const count = uploads.size + downloads.size;
    const eligibleDownloads = snapshot?.plan.download.filter(x => x.status === "eligible") || [];
    for (const [id, disabled] of [
      ["lj5-sync-compare", busy || !isOwned()],
      ["lj5-sync-select-down", busy || !snapshot || !isOwned() || eligibleDownloads.length === 0],
      ["lj5-sync-backup", busy || !snapshot || !isOwned()],
      ["lj5-sync-backup-ack", busy || !snapshot || !backupRequested || !isOwned()],
      ["lj5-sync-owner-ack", busy || !snapshot || !isOwned()],
      ["lj5-sync-apply", busy || !snapshot || !isOwned() || !backupRequested ||
        !el("lj5-sync-backup-ack")?.checked || !el("lj5-sync-owner-ack")?.checked ||
        count === 0 || count > MAX_CHANGES]
    ]) {
      const node = el(id);
      if (node) node.disabled = !!disabled;
    }
    const button = el("lj5-sync-apply");
    if (button) button.textContent = count ?
      "Sync " + count + " selected change(s) — manual test" : "Sync selected workouts";
    const selected = el("lj5-sync-selected");
    if (selected) selected.textContent = count > MAX_CHANGES ?
      "Select no more than 25 changes per sync." :
      uploads.size + " upload(s) + " + downloads.size + " download(s) selected.";
    for (const box of root.querySelectorAll('input[data-sync-id]')) {
      const set = box.dataset.syncDirection === "upload" ? uploads : downloads;
      box.checked = set.has(box.dataset.syncId);
      box.disabled = busy || !snapshot || !isOwned() || box.dataset.eligible !== "true";
    }
  }

  function listItems(listId, entries, direction) {
    const list = el(listId);
    if (!list) return;
    list.replaceChildren();
    for (const entry of entries) {
      const item = document.createElement("li");
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.syncId = entry.id;
      checkbox.dataset.syncDirection = direction;
      checkbox.dataset.eligible = entry.status === "eligible" ? "true" : "false";
      const body = document.createElement("span");
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      title.textContent = entry.name || "Workout";
      detail.textContent = (entry.date || "Date unavailable") + " · " +
        entry.status.toUpperCase() + " — " + (entry.reason || "");
      body.append(title, detail);
      label.append(checkbox, body);
      item.append(label);
      list.append(item);
    }
  }

  function displayPlan(plan) {
    const summary = {
      "lj5-sync-local": plan.localCount,
      "lj5-sync-cloud": plan.cloudCount,
      "lj5-sync-up-count": plan.uploadCounts.eligible || 0,
      "lj5-sync-down-count": plan.downloadCounts.eligible || 0,
      "lj5-sync-conflicts": (plan.uploadCounts.conflict || 0) +
        (plan.downloadCounts.conflict || 0) +
        (plan.uploadCounts["possible-duplicate"] || 0) +
        (plan.downloadCounts["possible-duplicate"] || 0)
    };
    for (const [id, number] of Object.entries(summary)) el(id).textContent = String(number);
    listItems("lj5-sync-upload-list", plan.upload, "upload");
    listItems("lj5-sync-download-list", plan.download, "download");
    update();
  }

  function readRaw() {
    const raw = localStorage.getItem(KEY);
    if (!raw) throw new Error(
      "No saved device history found here. Open Lift Journal and create a disposable test backup before comparing."
    );
    if (new Blob([raw]).size > MAX_DATA_BYTES) throw new Error("Local history exceeds the 20 MB test limit.");
    return raw;
  }

  async function verified(id) {
    if (!isOwned() || id !== ownerId) return false;
    const { data: { user }, error } = await getClient().auth.getUser();
    return !error && isOwned() && user?.id === id;
  }

  async function compare() {
    if (busy || !isOwned()) return;
    clear();
    const thisRequest = ++requestId;
    const id = ownerId, currentRoot = root;
    busy = true;
    update();
    message("Checking the saved workouts on this device and retrieving your private cloud history…");
    try {
      if (!await verified(id)) throw new Error("Could not verify the signed-in account.");
      const raw = readRaw();
      const local = JSON.parse(raw);
      const cloud = await fetchCloudWorkouts(getClient(), id, () =>
        thisRequest === requestId && root === currentRoot && isOwned()
      );
      if (thisRequest !== requestId || !isOwned() || currentRoot !== root) return;
      if (readRaw() !== raw) throw new Error("Local workout history changed. Compare again.");
      const plan = buildSyncPlan(local, cloud);
      snapshot = { raw, local, cloud, plan, ownerId: id, root: currentRoot };
      busy = false; // Do not render eligible inputs disabled after completing the query.
      displayPlan(plan);
      message("Comparison complete. Select only missing completed workouts, save a full backup, and approve manually.", "success");
    } catch (error) {
      if (thisRequest === requestId && root === currentRoot) {
        busy = false;
        clear();
        message("Comparison stopped: " + (error?.message || "Unknown error"), "error");
      }
    } finally {
      if (thisRequest === requestId && root === currentRoot) {
        busy = false;
        update();
      }
    }
  }

  function toggleSelected(box) {
    if (busy || !snapshot || !isOwned()) return;
    const direction = box.dataset.syncDirection;
    const id = box.dataset.syncId;
    const choices = direction === "upload" ? uploads : downloads;
    const valid = snapshot.plan[direction]?.some(row => row.id === id && row.status === "eligible");
    if (!valid) { box.checked = false; update(); return; }
    if (box.checked) choices.add(id); else choices.delete(id);
    update();
  }

  function selectDownloads() {
    if (busy || !snapshot || !isOwned()) return;
    const eligible = snapshot.plan.download.filter(row => row.status === "eligible");
    const newIds = eligible.filter(row => !downloads.has(row.id));
    if (newIds.length + downloads.size + uploads.size > MAX_CHANGES) {
      message("Select 25 or fewer changes per manual sync.", "error");
      return;
    }
    for (const row of newIds) downloads.add(row.id);
    update();
    message("Selected " + newIds.length +
      " missing cloud workout(s). Nothing was written. Save a full device backup before continuing.", "success");
  }

  function backup() {
    if (busy || !snapshot || !isOwned() || snapshot.ownerId !== ownerId || snapshot.root !== root) return;
    try {
      if (readRaw() !== snapshot.raw) throw new Error("Local history changed. Compare again.");
      const now = new Date().toISOString();
      const json = makeSafetyBackup(snapshot.local, now);
      saveFile(json, "lift-journal-SAFETY-BACKUP-" + now.slice(0, 10) + ".json");
      backupRequested = true;
      message("Safety backup download requested. Confirm the JSON exists in Downloads before acknowledging.", "success");
      update();
    } catch (error) {
      message("Safety backup could not be saved: " + (error?.message || "Unknown error"), "error");
    }
  }

  async function apply() {
    if (busy || !snapshot || !isOwned() || !backupRequested ||
      !el("lj5-sync-backup-ack")?.checked || !el("lj5-sync-owner-ack")?.checked) return;
    const up = [...uploads], down = [...downloads];
    if (!up.length && !down.length || up.length + down.length > MAX_CHANGES) return;
    const prior = snapshot, id = ownerId, currentRoot = root;
    const email = getUser()?.email || "your test account";
    if (!window.confirm(
      "MANUAL TEST SYNC — FICTIONAL DATA ONLY\n\n" +
      "Signed-in account: " + email + "\n" +
      "Upload " + up.length + " missing completed workout(s) to Supabase.\n" +
      "Download " + down.length + " missing cloud workout(s) to this test browser.\n\n" +
      "Existing workouts, nutrition, favorites and programs will not be overwritten or deleted.\n" +
      "A full safety backup must already be saved.\n" +
      (down.length ? "\nLift Journal will reload automatically after local downloads to refresh its in-memory history.\n" : "") +
      "\nContinue?"
    )) return;
    const thisRequest = ++requestId;
    busy = true;
    update();
    let successfulUploads = 0;
    try {
      if (!await verified(id)) throw new Error("Account changed or could not be verified.");
      if (readRaw() !== prior.raw) throw new Error("Local workouts changed after comparison.");
      const latestCloud = await fetchCloudWorkouts(getClient(), id, () =>
        thisRequest === requestId && root === currentRoot && isOwned()
      );
      if (thisRequest !== requestId || !isOwned() || currentRoot !== root) return;
      if (readRaw() !== prior.raw) throw new Error("Device workouts changed during cloud refresh.");
      // Rebuild the plan from fresh cloud records. Refuse stale/invalid picks.
      const planned = planSelectedSync(prior.local, latestCloud, up, down);
      for (const workout of planned.upload) {
        if (thisRequest !== requestId || !await verified(id) || readRaw() !== prior.raw) {
          throw new Error("Account or local device state changed during sync.");
        }
        // Plain INSERT only — never UPSERT, UPDATE or DELETE cloud workouts.
        const { error } = await getClient().from("workouts").insert({
          user_id: id,
          client_workout_id: workout.client_workout_id,
          workout_data: workout.workout_data
        });
        if (error) throw new Error("Cloud upload stopped: " + error.message);
        successfulUploads++;
      }
      if (planned.downloadCount) {
        if (thisRequest !== requestId || !await verified(id) || readRaw() !== prior.raw) {
          throw new Error("Account or device changed; no local workout was applied.");
        }
        // The app's workout data also lives in an in-memory closure. Reload
        // immediately after saving so old in-memory sessions cannot later
        // overwrite freshly downloaded workouts on navigation or save.
        const next = JSON.stringify(planned.nextLocal);
        try {
          localStorage.setItem(KEY, next);
          if (localStorage.getItem(KEY) !== next) throw new Error("Local workout save could not be verified.");
        } catch (error) {
          try {
            if (localStorage.getItem(KEY) !== prior.raw) localStorage.setItem(KEY, prior.raw);
          } catch { /* Preserve available backup; never clear storage. */ }
          throw new Error("Local workout save failed: " + (error?.message || "Storage unavailable"));
        }
        window.location.reload();
        return;
      }
      busy = false;
      clear();
      message("Manual sync complete: " + successfulUploads +
        " cloud upload(s), 0 local additions. Compare again to verify no duplicate uploads.", "success");
    } catch (error) {
      if (root === currentRoot) {
        busy = false;
        clear();
        message("Sync stopped after " + successfulUploads + " cloud upload(s): " +
          (error?.message || "Unknown error") +
          ". Do not retry blindly. Compare again; successful inserts will be detected. " +
          "Your downloaded safety backup remains available.", "error");
      }
    } finally {
      if (thisRequest === requestId && root === currentRoot) {
        busy = false;
        update();
      }
    }
  }

  function wire(currentRoot) {
    currentRoot.addEventListener("click", event => {
      const button = event.target.closest?.("button[data-lj5-action]");
      if (!button || button.disabled || currentRoot !== root) return;
      switch (button.dataset.lj5Action) {
        case "compare": void compare(); break;
        case "select-down": selectDownloads(); break;
        case "backup": backup(); break;
        case "apply": void apply(); break;
      }
    });
    currentRoot.addEventListener("change", event => {
      const input = event.target;
      if (!input || currentRoot !== root) return;
      if (input.matches('input[data-sync-id]')) toggleSelected(input);
      else if (input.id === "lj5-sync-backup-ack" || input.id === "lj5-sync-owner-ack") update();
    });
  }

  const markup = () => '<div class="lj5-sync-box">' +
    '<h3>Manual Workout Sync <small class="lj5-sync-test-label">Test only</small></h3>' +
    '<p class="note">Compare workouts without changing data. Sync is optional and remains OFF until you explicitly review and approve each change.</p>' +
    '<p id="lj5-sync-status" class="lj5-sync-status" role="status" aria-live="polite">Press Compare to review this device and your cloud account.</p>' +
    '<button type="button" class="btn secondary" id="lj5-sync-compare" data-lj5-action="compare">Compare this device with my cloud</button>' +
    '<div class="lj5-sync-summary" role="group" aria-label="Manual sync comparison">' +
    '<div><strong id="lj5-sync-local">—</strong><small>Local workouts</small></div>' +
    '<div><strong id="lj5-sync-cloud">—</strong><small>Cloud workouts</small></div>' +
    '<div><strong id="lj5-sync-up-count">—</strong><small>Safe uploads</small></div>' +
    '<div><strong id="lj5-sync-down-count">—</strong><small>Safe downloads</small></div>' +
    '</div>' +
    '<p class="note">Conflicts or possible duplicates (never overwritten): <strong id="lj5-sync-conflicts">—</strong></p>' +
    '<div class="lj5-sync-columns">' +
    '<section aria-label="Upload missing workouts"><h4>Upload missing local workouts</h4>' +
    '<p class="note">Only completed, compatible sessions are eligible.</p><ul id="lj5-sync-upload-list" class="lj5-sync-list"></ul></section>' +
    '<section aria-label="Download missing workouts"><h4>Download missing cloud workouts</h4>' +
    '<button type="button" class="btn secondary tiny" id="lj5-sync-select-down" data-lj5-action="select-down" disabled>Select eligible cloud workouts</button>' +
    '<ul id="lj5-sync-download-list" class="lj5-sync-list"></ul></section>' +
    '</div>' +
    '<p class="note" id="lj5-sync-selected">0 upload(s) + 0 download(s) selected.</p>' +
    '<div class="lj5-sync-confirm">' +
    '<h4>Review &amp; protect this device</h4>' +
    '<p class="note">Save your complete local backup before any cloud or device changes.</p>' +
    '<button type="button" class="btn secondary" id="lj5-sync-backup" data-lj5-action="backup" disabled>Download full local safety backup (.json)</button>' +
    '<label><input id="lj5-sync-backup-ack" type="checkbox" disabled><span>I checked that the full safety backup file was saved.</span></label>' +
    '<label><input id="lj5-sync-owner-ack" type="checkbox" disabled><span>These fictional device workouts belong to my signed-in test account, not another user.</span></label>' +
    '<button type="button" class="btn" id="lj5-sync-apply" data-lj5-action="apply" disabled>Sync selected workouts</button>' +
    '<p class="note">Manual sync rechecks your account, your saved device data and cloud history before writes. Existing cloud workouts are never updated or deleted. Automatic sync is OFF.</p>' +
    '</div></div>';

  function mount() {
    const currentRoot = document.getElementById("lj-stage5-sync-root");
    const signedUser = getUser();
    const nextOwner = signedUser?.id || null;
    if (!currentRoot || !localTestHost || !nextOwner || !getClient()) {
      if (root || ownerId) {
        clear();
        root = null;
        ownerId = null;
      }
      return;
    }
    if (currentRoot === root && ownerId === nextOwner) {
      update();
      return;
    }
    clear();
    root = currentRoot;
    ownerId = nextOwner;
    root.innerHTML = markup(); // Static trusted markup; workout names use textContent only.
    wire(root);
    message(isOwned() ?
      "This device is linked to your test account. Press Compare to review missing workouts." :
      "SYNC LOCKED: Link this browser's workout history to your verified test account using the backup and ownership controls above.");
    update();
  }

  return { mount, reset: () => { clear(); root = null; ownerId = null; } };
}
