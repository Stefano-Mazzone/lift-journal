// Lift Journal Coach. Deployed on Cloudflare Workers, not GitHub Pages.
const ORIGIN='https://stefano-mazzone.github.io';
const MODEL='@cf/google/gemma-4-26b-a4b-it';
const EXERCISES=[
'Goblet Squat','Bodyweight Squat','Leg Press','Back Squat','Dumbbell Split Squat','Reverse Lunge',
'Dumbbell Romanian Deadlift','Romanian Deadlift','Glute Bridge','Barbell Hip Thrust',
'Dumbbell Bench Press','Flat Dumbbell Bench Press','Dumbbell Floor Press','Push-Up',
'Chest Press Machine','Incline Dumbbell Press','Seated Dumbbell Shoulder Press','Cable Fly',
'Dumbbell Lateral Raise','One-Arm Dumbbell Row','Seated Cable Row','Chest-Supported Dumbbell Row',
'Lat Pulldown','Cable Face Pull','Dumbbell Curl','Hammer Curl','Cable Biceps Curl',
'Cable Triceps Pushdown','Triceps Rope Pressdown','Cable Crunch','Plank','Side Plank',
'Dead Bug','Bird Dog','Pallof Press','Standing Dumbbell Calf Raise','Seated Calf Raise',
'Leg Curl Machine','Leg Extension Machine'];
const NAMES=new Map(EXERCISES.map(n=>[n.toLowerCase(),n]));
const trim=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
function respond(payload,status=200){
 return new Response(JSON.stringify(payload),{status,headers:{'Content-Type':'application/json; charset=utf-8',
 'Access-Control-Allow-Origin':ORIGIN,'Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'}});
}
const DUMBBELL_NAMES=new Set([
'Goblet Squat','Bodyweight Squat','Dumbbell Split Squat','Reverse Lunge',
'Dumbbell Romanian Deadlift','Glute Bridge','Dumbbell Bench Press','Flat Dumbbell Bench Press',
'Dumbbell Floor Press','Push-Up','Incline Dumbbell Press','Seated Dumbbell Shoulder Press',
'Dumbbell Lateral Raise','One-Arm Dumbbell Row','Chest-Supported Dumbbell Row',
'Dumbbell Curl','Hammer Curl','Plank','Side Plank','Dead Bug','Bird Dog',
'Standing Dumbbell Calf Raise'
]);
const CABLE_NAMES=new Set([
'Bodyweight Squat','Glute Bridge','Push-Up','Cable Fly','Seated Cable Row','Lat Pulldown',
'Cable Face Pull','Cable Biceps Curl','Cable Triceps Pushdown','Triceps Rope Pressdown',
'Cable Crunch','Plank','Side Plank','Dead Bug','Bird Dog','Pallof Press'
]);
function fit(name,eq){
 if(eq==='dumbbells')return DUMBBELL_NAMES.has(name);
 if(eq==='cables')return CABLE_NAMES.has(name);
 return true;
}
function validatedPlan(p){
 if(!p||!['program','session'].includes(p.mode)||!Array.isArray(p.days))return null;
 const equipment=['all','dumbbells','cables'].includes(p.equipment)?p.equipment:'all';
 const goal=['muscle','strength','general'].includes(p.goal)?p.goal:'muscle';
 const focus=['upper','lower','full'].includes(p.focus)?p.focus:'full';
 const minutes=[20,30,45,60].includes(p.minutes)?p.minutes:45;
 const count=p.mode==='session'?1:Math.min(p.days.length,7);
 if(count<1||p.days.length<count)return null;
 const days=[];
 for(const day of p.days.slice(0,count)){
  if(!day||!Array.isArray(day.exercises))return null;
  const used=new Set(),list=[];
  for(const ex of day.exercises.slice(0,12)){
   const name=NAMES.get(trim(ex?.name,100).toLowerCase()),sets=Number(ex?.sets),reps=trim(ex?.reps,20);
   if(!name||used.has(name)||!fit(name,equipment)||!Number.isInteger(sets)||sets<1||sets>5||!/^\d{1,2}(?:\s*[-–]\s*\d{1,2})?$/.test(reps))continue;
   used.add(name);list.push({name,sets,reps,rest:90});
   if(list.length===6)break;
  }
  if(list.length<2)return null;
  days.push({title:trim(day.title,65)||'Workout '+(days.length+1),exercises:list});
 }
 return {mode:p.mode,title:trim(p.title,65)||'AI Workout',equipment,goal,focus,minutes,days};
}
function parseAI(raw){
 if(raw&&typeof raw==='object'&&raw.mode)return raw;
 const value=typeof raw==='string'?raw:JSON.stringify(raw||{});
 const text=value.trim().replace(/^\x60{3}(?:json)?\s*/i,'').replace(/\s*\x60{3}$/,'');
 try{return JSON.parse(text)}catch{}
 const a=text.indexOf('{'),b=text.lastIndexOf('}');
 if(a<0||b<=a)throw Error('No JSON');return JSON.parse(text.slice(a,b+1));
}
async function verify(token,secret){
 if(!secret||!token||token.length>2048)return false;
 const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
  method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({secret,response:token})});
 if(!response.ok)return false;
 const result=await response.json();
 return result.success===true&&result.hostname==='stefano-mazzone.github.io';
}
const SYSTEM=[
 'You are Lift Journal Workout Coach. Produce only one JSON object, no markdown.',
 'Required JSON keys: reply, mode, title, goal, equipment, minutes, focus, days.',
 'mode: program, session or clarify. For clarify set days to [].',
 'goal: muscle, strength, general. equipment: all, dumbbells, cables. focus: upper, lower, full.',
 'minutes: 20,30,45,60. Days array contains objects with title and exercises.',
 'Every exercise object must have name, sets (1-5 integer), reps (e.g. 8-12).',
 'Session has 1 day. Program has 1-7 days. Use 2-6 distinct exercises each day.',
 'Exercise names must be EXACTLY from: '+EXERCISES.join('; '),
 'For dumbbells equipment, exercises must be among: '+[...DUMBBELL_NAMES].join('; '),
 'For cables equipment, exercises must be among: '+[...CABLE_NAMES].join('; '),
 'Obey the user requested equipment and focus. Refine the previous plan when asked.',
 'Avoid medical diagnosis, rehabilitation and promises of safety. For symptoms or unclear requests, mode=clarify.',
 'Reply briefly and politely; no more than 240 characters in reply.'
].join('\n');
export default {
 async fetch(request,env){
  if(request.headers.get('Origin')!==ORIGIN)return respond({error:'Origin not allowed'},403);
  const path=new URL(request.url).pathname;
  if(path==='/health'&&request.method==='GET')return respond({ready:!!(env.AI&&env.TURNSTILE_SECRET&&env.COACH_RATE_LIMIT)});
  if(path!=='/chat')return respond({error:'Not found'},404);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{
   'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'POST, OPTIONS',
   'Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'86400','Vary':'Origin'}});
  if(request.method!=='POST')return respond({error:'Method not allowed'},405);
  if(!env.AI||!env.TURNSTILE_SECRET||!env.COACH_RATE_LIMIT)return respond({error:'AI not configured'},503);
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))return respond({error:'JSON required'},415);
  if(Number(request.headers.get('content-length')||0)>10000)return respond({error:'Too large'},413);
  let input;try{input=await request.json()}catch{return respond({error:'Invalid JSON'},400)}
  const messages=Array.isArray(input?.messages)?input.messages.slice(-6):[];
  if(!messages.length||messages.at(-1)?.role!=='user'||messages.some(m=>!['user','assistant'].includes(m?.role)||!trim(m.content,501)||m.content.length>500))
   return respond({error:'Please send up to six short messages.'},400);
  const ip=trim(request.headers.get('cf-connecting-ip'),80)||'unknown';
  const limited=await env.COACH_RATE_LIMIT.limit({key:'coach:'+ip});
  if(!limited.success)return respond({error:'Rate limit reached. Try again soon.'},429);
  try{if(!await verify(trim(input.turnstileToken,2049),env.TURNSTILE_SECRET))
   return respond({error:'Verification expired; please retry.'},403)}
  catch{return respond({error:'Verification unavailable'},503)}
  if(/\b(chest pain|fainting|dizziness|injury|injured|pain|surgery|rehab|fracture)\b/i.test(messages.at(-1).content))
   return respond({reply:'For injuries or symptoms, please use the readiness check and seek qualified advice. I cannot assess medical safety.',plan:null});
  const p=input.context&&typeof input.context==='object'?input.context:{};
  const prefs={goal:['muscle','strength','general'].includes(p.goal)?p.goal:'muscle',
   equipment:['all','dumbbells','cables'].includes(p.equipment)?p.equipment:'all',
   minutes:[20,30,45,60].includes(p.minutes)?p.minutes:45,
   days:Number.isInteger(p.days)&&p.days>=1&&p.days<=7?p.days:3};
  const old=validatedPlan(input.previousPlan);
  const history=messages.map(m=>({role:m.role,content:trim(m.content,500)}));
  history.push({role:'user',content:'Non-medical preferences: '+JSON.stringify(prefs)+'\n'+
   (old?'Previous plan to refine: '+JSON.stringify(old):'No previous plan.')+'\nReturn valid JSON only.'});
  try{
   const output=await env.AI.run(MODEL,{messages:[{role:'system',content:SYSTEM},...history],
    max_tokens:1850,temperature:0.3,chat_template_kwargs:{enable_thinking:false}});
   const parsed=parseAI(output?.response??output?.choices?.[0]?.message?.content??output);
   const proposed=validatedPlan(parsed);
   const requestedDays=messages.at(-1).content.match(/\b([1-7])[\s-]*day(?:s)?\b/i);
   const asksDumbbells=/\b(dumbbell|dumbbells|db only)\b/i.test(messages.at(-1).content);
   const asksCables=/\b(cable|cables)\b/i.test(messages.at(-1).content);
   if(proposed&&requestedDays&&proposed.mode==='program'&&proposed.days.length!==Number(requestedDays[1]))
    return respond({reply:'The AI did not match the requested number of training days. Please ask it to try again.',plan:null});
   if(proposed&&((asksDumbbells&&!asksCables&&proposed.equipment!=='dumbbells')||
     (asksCables&&!asksDumbbells&&proposed.equipment!=='cables')))
    return respond({reply:'The AI did not match the requested equipment. Please ask it to retry.',plan:null});
   return respond({reply:trim(parsed.reply,420)||'Here is a workout proposal for your review.',plan:proposed});
  }catch{
   return respond({error:'AI is temporarily unavailable or the free daily allowance is exhausted.'},503);
  }
 }
};
