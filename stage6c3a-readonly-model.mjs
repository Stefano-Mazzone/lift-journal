// Stage 6C3A — pure READ-ONLY model for account-private History/Movements.
// Caller MUST independently verify linked server account and decrypt v2 compartment.
// No localStorage, network calls, side effects, plaintext persistence or DOM writes.
const rec = x => x !== null && typeof x === "object" && !Array.isArray(x);
const text = (x,max=120) => typeof x === "string" ?
 x.replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,max) : "";
const safeDate = s => text(s?.scheduledDate || s?.started || s?.month || "",40);
const safeSetNumber = x => (typeof x === "number" && Number.isFinite(x)) ?
 String(x).slice(0,40) : text(x,40);
const deepFreeze = a => Object.freeze(a);
const integerMax = 10000;
export const READ_ONLY_SESSION_LIMIT = 100;
export function buildReadOnlyPrivateAppModel(data) {
 if (!rec(data) || !rec(data.sessions) || !["kg","lb"].includes(data.unit))
   throw Error("Private workout data is invalid. No history was displayed.");
 const pairs=Object.entries(data.sessions);
 if (pairs.length>integerMax) throw Error("Private workout history exceeds safe limits.");
 const sessions=pairs.map(([id,s])=>{
   if (!rec(s) || !Array.isArray(s.exercises) || s.exercises.length>100)
     throw Error("A private workout record is malformed. Nothing was displayed.");
   const unit=["kg","lb"].includes(s.unit) ? s.unit : data.unit;
   const exercises=s.exercises.map(x=>{
     if (!rec(x) || !Array.isArray(x.sets) || x.sets.length>100)
       throw Error("A private exercise record is malformed. Nothing was displayed.");
     return deepFreeze({
       name:text(x.name,100)||"Unnamed movement",
       sets:deepFreeze(x.sets.map((set,i)=>{
         if (!rec(set)) throw Error("Private set details are malformed.");
         return deepFreeze({
           index:i+1, reps:safeSetNumber(set.reps),
           weight:safeSetNumber(set.weight), done:set.done === true
         });
       }))
     });
   });
   return deepFreeze({
     id:text(id,140), title:text(s.name,100)||"Workout",
     date:safeDate(s), completed:!!s.finished, unit,
     exercises:deepFreeze(exercises)
   });
 }).sort((a,b)=>b.date.localeCompare(a.date))
   .slice(0,READ_ONLY_SESSION_LIMIT);
 const favorites=Array.isArray(data.favoriteMovements)?
   [...new Set(data.favoriteMovements.map(x=>text(x,100)).filter(Boolean))].slice(0,400):[];
 const moveStats=new Map();
 for(const workout of sessions){
   const unique=new Set();
   for(const ex of workout.exercises){
     if(!unique.has(ex.name)){
       unique.add(ex.name);
       moveStats.set(ex.name,(moveStats.get(ex.name)||0)+1);
     }
   }
 }
 for(const favorite of favorites)if(!moveStats.has(favorite))moveStats.set(favorite,0);
 const favSet=new Set(favorites);
 const movements=[...moveStats].map(([name,workouts])=>
   deepFreeze({name,workouts,isFavorite:favSet.has(name)}))
   .sort((a,b)=>Number(b.isFavorite)-Number(a.isFavorite) || a.name.localeCompare(b.name));
 const mealEntries=rec(data.nutrition?.entries)?data.nutrition.entries:{};
 const mealCount=Object.values(mealEntries).reduce((n,v)=>
   n+(Array.isArray(v)?v.length:0),0);
 const runningCount=Array.isArray(data.running?.logs)?data.running.logs.length:0;
 return deepFreeze({
   workouts:pairs.length, favorites:favorites.length,
   meals:Math.min(mealCount,1000000), runs:Math.min(runningCount,1000000),
   unit:data.unit, shownWorkouts:sessions.length,
   history:deepFreeze(sessions), movements:deepFreeze(movements)
 });
}
