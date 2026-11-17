// Lift Journal 2.0 — Stage 6C2B private workout-entry adapter (fictional data).
// Pure transformer. No browser storage, authentication, cloud, or DOM access.
// The caller must verify account ownership and write ONLY via the encrypted
// Stage 6C2 compartment's compare-and-commit protocol.
export const TEST_MOVEMENTS = Object.freeze([
  "Goblet Squat", "Lat Pulldown", "Dumbbell Bench Press"
]);
const object = x => x !== null && typeof x === "object" && !Array.isArray(x);
const assertDate = value => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw Error("Choose a valid workout date.");
  const timestamp = Date.parse(value + "T12:00:00.000Z");
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value)
    throw Error("Workout date is not valid.");
  return value;
};
const assertPositiveInteger = (value, max, label) => {
  if (typeof value !== "string" || !/^\d+$/.test(value))
    throw Error(label + " must be a whole number.");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max)
    throw Error(label + " is outside the safe test range.");
  return number;
};
const assertWeight = value => {
  if (typeof value !== "string" || !/^(?:\d{1,4})(?:\.\d{1,2})?$/.test(value))
    throw Error("Weight must be a non-negative number with at most two decimals.");
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 9999)
    throw Error("Weight is outside the safe test range.");
  return String(number);
};
export function buildFictionalPrivateWorkout({
  data, date, movement, weight, reps, setCount, id, now
}) {
  if (!object(data) || !object(data.sessions) || !["lb", "kg"].includes(data.unit))
    throw Error("Existing private workout data is invalid; no changes were prepared.");
  if (Object.keys(data.sessions).length >= 10000)
    throw Error("Private history is at the safe workout limit.");
  const selectedDate = assertDate(date);
  if (!TEST_MOVEMENTS.includes(movement))
    throw Error("Select one of the available fictional test movements.");
  const validReps = assertPositiveInteger(reps, 100, "Reps");
  const validSets = assertPositiveInteger(setCount, 5, "Sets");
  const validWeight = assertWeight(weight);
  if (typeof id !== "string" || !/^test-6c2b-[a-f0-9-]{16,64}$/.test(id))
    throw Error("Unable to generate a safe fictional workout identifier.");
  if (Object.prototype.hasOwnProperty.call(data.sessions, id))
    throw Error("Workout ID already exists. No existing workout will be replaced.");
  if (typeof now !== "string" || Number.isNaN(Date.parse(now)))
    throw Error("Unable to timestamp fictional workout.");
  const copy = JSON.parse(JSON.stringify(data));
  const cycleIndex = Number.isInteger(copy.program?.index) && copy.program.index >= 0
    ? copy.program.index : 0;
  const programNumber = Number.isInteger(copy.program?.number) && copy.program.number >= 1
    ? copy.program.number : 1;
  const session = {
    month: selectedDate.slice(0, 7),
    day: 0,
    cycleIndex,
    programNumber,
    scheduledDate: selectedDate,
    started: now,
    finished: now,
    unit: copy.unit,
    name: "TEST - Stage 6C2B Private Workout",
    exercises: [{
      name: movement,
      sets: Array.from({ length: validSets }, () => ({
        reps: String(validReps), weight: validWeight, done: true
      }))
    }]
  };
  copy.sessions[id] = session;
  // The returned record is suitable for the app's existing session schema,
  // but it remains a SEPARATE encrypted Stage 6C2 test copy until migration.
  return { data: copy, id, session };
}
