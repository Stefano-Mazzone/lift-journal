// Lift Journal 2.0 — Stage 4 opt-in sync planning (pure functions).
// NO networking or storage access here. Sync decisions are recomputed before mutations.
import { validateDeviceBackup, planWorkoutMerge } from "./cloud-safe-merge.mjs";

const SIZE_LIMIT = 20 * 1024 * 1024;
const BATCH_LIMIT = 25;
const record = x => x !== null && typeof x === "object" && !Array.isArray(x);
const safeId = x => typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,139}$/.test(x) &&
  !["__proto__", "constructor", "prototype"].includes(x);
const has = (o, key) => Object.prototype.hasOwnProperty.call(o, key);
const signature = session => session?.finished && session?.started ?
  session.started + "|" + session.finished : null;
const name = session => typeof session?.name === "string" && session.name.trim() ?
  session.name.trim().slice(0, 100) : "Recorded workout";
const date = session => typeof session?.scheduledDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(session.scheduledDate) ?
  session.scheduledDate : String(session?.started || "").slice(0, 10);
const clone = obj => JSON.parse(JSON.stringify(obj));
const payloadFingerprint = session => {
  // Server-only upload annotations do not count as a user edit.
  const copy = clone(session);
  delete copy.backupSessionId;
  if (copy.source === "lift-journal-device-sync" || copy.source === "lift-journal-backup") {
    delete copy.source;
  }
  return JSON.stringify(copy);
};

export function makeSafetyBackup(localData, exportedAt) {
  if (typeof exportedAt !== "string" || Number.isNaN(Date.parse(exportedAt))) {
    throw new Error("Invalid backup time.");
  }
  validateDeviceBackup({ format: "lift-journal-v1", data: localData });
  const json = JSON.stringify({ format: "lift-journal-v1", exported: exportedAt, data: localData }, null, 2);
  if (new Blob([json]).size > SIZE_LIMIT) throw new Error("The safety backup exceeds 20 MB.");
  return json;
}

export function buildSyncPlan(localData, cloudRows) {
  if (!record(localData) || !Array.isArray(cloudRows) || cloudRows.length > 5000) {
    throw new Error("Missing device data or invalid cloud data.");
  }
  const deviceBackup = { format: "lift-journal-v1", data: localData };
  const validated = validateDeviceBackup(deviceBackup);
  const cloudPlan = planWorkoutMerge(deviceBackup, cloudRows);
  const cloudById = new Map();
  const cloudTimeSignatures = new Set();
  for (const row of cloudRows) {
    if (!record(row) || typeof row.client_workout_id !== "string" ||
        cloudById.has(row.client_workout_id)) {
      throw new Error("Cloud workout IDs are incomplete or duplicated.");
    }
    cloudById.set(row.client_workout_id, row);
    if (row.client_workout_id.startsWith("lj-session:") && signature(row.workout_data)) {
      cloudTimeSignatures.add(signature(row.workout_data));
    }
  }
  const down = cloudPlan.entries.map(entry => {
    let status = entry.status;
    if (status === "already") {
      const local = validated.sessions[entry.originalId];
      const remote = cloudById.get(entry.id)?.workout_data;
      status = local && remote && payloadFingerprint(local) === payloadFingerprint(remote) ?
        "already" : "conflict";
    }
    return {
      direction: "download", id: entry.id, sessionId: entry.originalId,
      name: entry.name, date: entry.date, status,
      reason: status === "conflict" ? "Same ID has different data. Never automatically overwrite." : entry.reason
    };
  });

  const up = [];
  for (const [sessionId, session] of Object.entries(validated.sessions)) {
    const id = "lj-session:" + sessionId;
    let status, reason;
    const remote = cloudById.get(id);
    if (!safeId(sessionId)) {
      status = "unsupported"; reason = "Session identifier isn't supported by this pilot.";
    } else if (!session.finished) {
      status = "unfinished"; reason = "In-progress session remains local until complete.";
    } else if (remote) {
      status = payloadFingerprint(session) === payloadFingerprint(remote.workout_data) ?
        "already" : "conflict";
      reason = status === "already" ? "This session is already in cloud." :
        "Same session ID differs in cloud. Never automatically overwrite.";
    } else if (cloudTimeSignatures.has(signature(session))) {
      status = "possible-duplicate";
      reason = "Cloud has a session with the same start/end time.";
    } else {
      status = "eligible"; reason = "Completed locally, missing in cloud.";
    }
    up.push({ direction: "upload", id, sessionId, name: name(session), date: date(session), status, reason });
  }
  const summarize = items => items.reduce((counts, entry) => {
    counts[entry.status] = (counts[entry.status] || 0) + 1;
    return counts;
  }, {});
  return {
    localCount: Object.keys(validated.sessions).length,
    cloudCount: cloudRows.length, download: down, upload: up,
    uploadCounts: summarize(up), downloadCounts: summarize(down)
  };
}

export function planSelectedSync(localData, cloudRows, requestedUploadIds, requestedDownloadIds) {
  if (!Array.isArray(requestedUploadIds) || !Array.isArray(requestedDownloadIds) ||
      requestedUploadIds.length + requestedDownloadIds.length < 1 ||
      requestedUploadIds.length + requestedDownloadIds.length > BATCH_LIMIT ||
      new Set(requestedUploadIds).size !== requestedUploadIds.length ||
      new Set(requestedDownloadIds).size !== requestedDownloadIds.length) {
    throw new Error("Choose 1–25 unique safe changes per sync.");
  }
  const plan = buildSyncPlan(localData, cloudRows);
  const eligible = (direction, ids) => {
    const source = plan[direction];
    const possible = new Map(source.filter(x => x.status === "eligible").map(x => [x.id, x]));
    for (const id of ids) {
      if (!possible.has(id)) throw new Error("Selection is no longer eligible. Compare again.");
    }
  };
  eligible("upload", requestedUploadIds);
  eligible("download", requestedDownloadIds);
  const up = requestedUploadIds.map(id => {
    const key = id.slice("lj-session:".length);
    const session = clone(localData.sessions[key]);
    if (session.backupSessionId != null && session.backupSessionId !== key) {
      throw new Error("Local session provenance conflicts with its ID.");
    }
    // Only add provenance metadata. Never change exercise/performance data.
    if (!session.backupSessionId) session.backupSessionId = key;
    if (!session.source) session.source = "lift-journal-device-sync";
    return { client_workout_id: id, workout_data: session };
  });

  // Explicit non-destructive local merge; no conflicting or other sections replaced.
  const next = clone(localData);
  const cloudMap = new Map(cloudRows.map(row => [row.client_workout_id, row]));
  for (const id of requestedDownloadIds) {
    const key = id.slice("lj-session:".length);
    if (has(next.sessions, key)) throw new Error("Local workout appeared after comparison. Refusing overwrite.");
    next.sessions[key] = clone(cloudMap.get(id).workout_data);
  }
  validateDeviceBackup({ format: "lift-journal-v1", data: next });
  const nextJson = JSON.stringify(next);
  if (new Blob([nextJson]).size > SIZE_LIMIT) throw new Error("Combined local data exceeds 20 MB.");
  return { upload: up, nextLocal: next, downloadCount: requestedDownloadIds.length, uploadCount: requestedUploadIds.length };
}
