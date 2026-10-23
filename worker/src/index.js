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
const FEEDBACK_TYPES=new Set(['Bug report','Feature request','Workout feedback','Other feedback']);
async function submitPublicFeedback(input,request,env){
 if(!env.GITHUB_FEEDBACK_TOKEN||!env.TURNSTILE_SECRET||!env.FEEDBACK_RATE_LIMIT)
  return respond({error:'Feedback service not configured; use GitHub to submit instead.'},503);
 if(typeof input?.website==='string'&&input.website.trim())return respond({error:'Submission rejected.'},400);
 const kind=trim(input?.kind,35),title=trim(input?.title,95),details=trim(input?.details,2000);
 if(!FEEDBACK_TYPES.has(kind)||title.length<5||details.length<10||String(input?.title||'').length>95||
  String(input?.details||'').length>2000)return respond({error:'Please provide a valid title and description.'},400);
 const ip=trim(request.headers.get('cf-connecting-ip'),80)||'unknown';
 const limited=await env.FEEDBACK_RATE_LIMIT.limit({key:'feedback:'+ip});
 if(!limited.success)return respond({error:'Feedback limit reached. Please try again later.'},429);
 try{
  if(!await verify(trim(input.turnstileToken,2049),env.TURNSTILE_SECRET))
   return respond({error:'Verification expired or failed. Please complete it again.'},403);
 }catch{return respond({error:'Verification unavailable.'},503)}
 const body=['**Type:** '+kind,'','**Feedback:**',details,'',
  '**Source:** Lift Journal public feedback form',
  '**App version:** '+trim(input.version,30)].join('\n');
 try{
  const response=await fetch('https://api.github.com/repos/Stefano-Mazzone/lift-journal/issues',{
   method:'POST',headers:{'Accept':'application/vnd.github+json',
    'Authorization':'Bearer '+env.GITHUB_FEEDBACK_TOKEN,
    'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json',
    'User-Agent':'Lift-Journal-Feedback'},
   body:JSON.stringify({title:'['+kind+'] '+title,body})
  });
  if(!response.ok)return respond({error:'Feedback could not be delivered. Please use the GitHub option.'},503);
  const issue=await response.json();
  if(typeof issue.html_url!=='string'||!issue.html_url.startsWith('https://github.com/Stefano-Mazzone/lift-journal/issues/'))
   return respond({error:'Feedback delivery could not be verified.'},503);
  return respond({ok:true,url:issue.html_url});
 }catch{
  return respond({error:'Feedback service unavailable. Please use the GitHub option.'},503);
 }
}
function resolveWorkoutIntent(message,prefs){
 const text=String(message||'');
 const asksDumbbells=/\b(?:dumbbells?|db only)\b/i.test(text);
 const asksCables=/\bcables?\b/i.test(text);
 const equipment=asksDumbbells&&!asksCables?'dumbbells':asksCables&&!asksDumbbells?'cables':null;
 const dayMatch=text.match(/\b([1-7])[\s-]*days?\b/i);
 const days=dayMatch?Number(dayMatch[1]):null;
 const minuteMatch=text.match(/\b(20|30|45|60)[\s-]*min(?:ute)?s?\b/i);
 const minutes=minuteMatch?Number(minuteMatch[1]):null;
 const goal=/\b(?:muscle|hypertrophy|mass)\b/i.test(text)?'muscle':
  /\bstrength\b/i.test(text)?'strength':null;
 const focus=/\bupper[\s-]*body\b/i.test(text)?'upper':
  /\blower[\s-]*body\b/i.test(text)?'lower':
  /\bfull[\s-]*body\b/i.test(text)?'full':null;
 return {equipment,days,minutes,goal,focus,prefs:{...prefs,
  ...(equipment?{equipment}:{}),...(days?{days}:{}),...(minutes?{minutes}:{}),
  ...(goal?{goal}:{}),...(focus?{focus}:{})}};
}
function planMismatch(plan,intent){
 if(!plan)return 'invalid workout structure or incompatible exercises';
 if(intent.days&&plan.days.length!==intent.days)return 'requested number of days';
 if(intent.equipment&&plan.equipment!==intent.equipment)return 'requested equipment';
 if(intent.minutes&&plan.minutes!==intent.minutes)return 'requested session length';
 if(intent.goal&&plan.goal!==intent.goal)return 'requested training goal';
 if(intent.focus&&plan.focus!==intent.focus)return 'requested workout focus';
 return null;
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
 'The latest user message overrides stored equipment, goal, focus, day count and session duration preferences.',
 'Match all explicitly requested constraints exactly. Refine the previous plan when asked.',
 'Avoid medical diagnosis, rehabilitation and promises of safety. For symptoms or unclear requests, mode=clarify.',
 'Reply briefly and politely; no more than 240 characters in reply.'
].join('\n');
export default {
 async fetch(request,env){
  if(request.headers.get('Origin')!==ORIGIN)return respond({error:'Origin not allowed'},403);
  const path=new URL(request.url).pathname;
  if(path==='/health'&&request.method==='GET')return respond({ready:!!(env.AI&&env.TURNSTILE_SECRET&&env.COACH_RATE_LIMIT),feedbackReady:!!(env.GITHUB_FEEDBACK_TOKEN&&env.FEEDBACK_RATE_LIMIT&&env.TURNSTILE_SECRET)});
  if(!['/chat','/feedback'].includes(path))return respond({error:'Not found'},404);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{
   'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'POST, OPTIONS',
   'Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'86400','Vary':'Origin'}});
  if(request.method!=='POST')return respond({error:'Method not allowed'},405);
  if(path==='/chat'&&(!env.AI||!env.TURNSTILE_SECRET||!env.COACH_RATE_LIMIT))return respond({error:'AI not configured'},503);
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))return respond({error:'JSON required'},415);
  if(Number(request.headers.get('content-length')||0)>10000)return respond({error:'Too large'},413);
  let input;try{input=await request.json()}catch{return respond({error:'Invalid JSON'},400)}
  if(path==='/feedback')return submitPublicFeedback(input,request,env);
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
  const intent=resolveWorkoutIntent(messages.at(-1).content,{
   ...prefs,equipment:old?.equipment||prefs.equipment});
  const history=messages.map(m=>({role:m.role,content:trim(m.content,500)}));
  history.push({role:'user',content:'Resolved non-medical preferences (latest user request takes priority): '+
   JSON.stringify(intent.prefs)+'\n'+
   (old?'Previous plan to refine: '+JSON.stringify(old):'No previous plan.')+'\nReturn valid JSON only.'});
  try{
   let failure='invalid workout structure';
   for(let attempt=0;attempt<2;attempt++){
    const correction=attempt?[{role:'user',content:
     'The previous proposal failed validation: '+failure+
     '. Regenerate a complete valid JSON workout. Required preferences: '+
     JSON.stringify(intent.prefs)+'. Only use allowed exercises for the requested equipment. '+
     'Match the requested days, minutes, goal and focus. Do not include explanations outside JSON.'}]:[];
    const output=await env.AI.run(MODEL,{
     messages:[{role:'system',content:SYSTEM},...history,...correction],
     max_tokens:1850,temperature:0.3,chat_template_kwargs:{enable_thinking:false}});
    let parsed;
    try{parsed=parseAI(output?.response??output?.choices?.[0]?.message?.content??output)}
    catch{failure='invalid JSON response';continue}
    if(parsed?.mode==='clarify'&&!intent.equipment&&!intent.days&&!intent.minutes)
     return respond({reply:trim(parsed.reply,420)||'Please clarify what you want to train.',plan:null});
    const proposed=validatedPlan(parsed);
    failure=planMismatch(proposed,intent);
    if(!failure)return respond({
     reply:trim(parsed.reply,420)||'Here is a workout proposal for your review.',plan:proposed});
   }
   return respond({reply:'The AI could not generate a valid workout matching your request, even after a retry. Try rephrasing or use the on-device coach.',plan:null});
  }catch{
   return respond({error:'AI is temporarily unavailable or the free daily allowance is exhausted.'},503);
  }
 }
};
