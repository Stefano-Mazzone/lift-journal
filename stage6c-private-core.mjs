// Stage 6C1 — pure encrypted-vault READ ONLY summary conversion.
// Never reads legacy localStorage, writes anything, or returns the full
// decrypted data object to application/global state.
const cleanText = (value, limit = 130) =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit) : "";
const record = x => x !== null && typeof x === "object" && !Array.isArray(x);

export function buildPrivateSnapshot(data) {
  if (!record(data) || !record(data.sessions) || !["kg", "lb"].includes(data.unit)) {
    throw Error("Encrypted workout data is malformed. No information was displayed.");
  }
  const allSessions = Object.entries(data.sessions);
  if (allSessions.length > 10000) throw Error("Encrypted workout history exceeds the safe preview limit.");
  const sessions = allSessions.map(([id, s]) => {
    if (!record(s)) throw Error("Encrypted workout record is malformed.");
    const exerciseNames = Array.isArray(s.exercises)
      ? s.exercises.filter(record).slice(0, 30).map(x => cleanText(x.name, 80)).filter(Boolean)
      : [];
    const date = cleanText(s.scheduledDate || s.started || s.month || "", 40);
    return Object.freeze({
      id: cleanText(id, 140),
      name: cleanText(s.name, 100) || "Workout",
      date, exercises: Object.freeze(exerciseNames)
    });
  }).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
  const favorites = Array.isArray(data.favoriteMovements) ?
    [...new Set(data.favoriteMovements.map(x => cleanText(x, 100)).filter(Boolean))] : [];
  const mealEntries = record(data.nutrition?.entries) ? data.nutrition.entries : {};
  const meals = Object.values(mealEntries).reduce((sum, value) =>
    sum + (Array.isArray(value) ? value.length : 0), 0);
  const runs = Array.isArray(data.running?.logs) ? data.running.logs.length : 0;
  return Object.freeze({
    workoutCount: allSessions.length,
    favoriteCount: favorites.length,
    mealCount: Math.min(meals, 1000000),
    runningCount: Math.min(runs, 1000000),
    unit: data.unit,
    sessions: Object.freeze(sessions),
    favorites: Object.freeze(favorites.slice(0, 40))
  });
}

// Takes only an already-verified user ID. Does not authenticate: always check
// Supabase getUser and Stage 6A owner marker before calling openVault.
export function canOpenPrivateVault({ verifiedId, displayedId, linkedToDevice, encryptedOwnerId }) {
  return typeof verifiedId === "string" && !!verifiedId &&
    verifiedId === displayedId && linkedToDevice === true &&
    encryptedOwnerId === verifiedId;
}
