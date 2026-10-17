/* Lift Journal — Spotify currently playing. Only enabled with a developer Client ID.
   Spotify authorization: OAuth2 Authorization Code + PKCE, read-only scope.
   Spotify tokens are kept in browser storage separately from workout backups. */
(function(){
'use strict';
const clientId=String(window.LJ_SPOTIFY_CLIENT_ID||'').trim();
const key='lj-spotify-auth-v1',pendingKey='lj-spotify-pkce-v1';
const redirect=location.origin+location.pathname;
let access=null,expires=0,refresh=null,playing=null,loading=false,nextPoll=0,pollTimer=null;
const bar=document.getElementById('lj-spotify-playing');
function read(key){try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}
function write(key,val){try{if(val)localStorage.setItem(key,JSON.stringify(val));else localStorage.removeItem(key)}catch(e){}}
function statusNote(message){
 const note=document.getElementById('lj-spotify-connect-status');
 if(note)note.textContent=message||'';
}
function authValid(){return !!(clientId&&refresh)}
function clearAuth(){
 access=null;refresh=null;expires=0;playing=null;
 write(key,null);
 if(bar){bar.hidden=true;bar.replaceChildren()}
 renderControls();
}
function restore(){
 const state=read(key);
 if(state?.clientId===clientId&&typeof state.refresh==='string'&&state.refresh){
  access=state.access||null;refresh=state.refresh;expires=Number(state.expires)||0;
 }
}
function store(){
 write(key,{clientId,access,refresh,expires});
}
function b64(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function nonce(n){const bytes=new Uint8Array(n);crypto.getRandomValues(bytes);return b64(bytes)}
async function connect(){
 if(!clientId)return;
 if(!crypto?.subtle||!crypto?.getRandomValues){statusNote('Secure authentication is unavailable in this browser.');return}
 try{
  const verifier=nonce(32),state=nonce(18),buffer=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
  const challenge=b64(new Uint8Array(buffer));
  const callback={state,verifier,redirect,created:Date.now(),clientId};
  write(pendingKey,callback);
  const url=new URL('https://accounts.spotify.com/authorize');
  url.search=new URLSearchParams({
   response_type:'code',client_id:clientId,redirect_uri:redirect,
   scope:'user-read-currently-playing',state,code_challenge_method:'S256',
   code_challenge:challenge
  }).toString();
  location.assign(url.toString());
 }catch(e){statusNote('Could not begin Spotify authorization. Try again.')}
}
async function token(body){
 const res=await fetch('https://accounts.spotify.com/api/token',{
  method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams(body),cache:'no-store'
 });
 if(!res.ok)throw Error('Spotify authorization returned HTTP '+res.status);
 return res.json();
}
async function callback(){
 const url=new URL(location.href);
 const code=url.searchParams.get('code'),state=url.searchParams.get('state');
 const error=url.searchParams.get('error');
 if(!code&&!error)return;
 url.searchParams.delete('code');url.searchParams.delete('state');url.searchParams.delete('error');
 // Never retain authorization codes in browser history.
 history.replaceState(history.state,'',url.pathname+(url.search||'')+(url.hash||''));
 const pending=read(pendingKey);write(pendingKey,null);
 if(error){statusNote('Spotify connection was declined.');return}
 if(!code||!pending||!state||state!==pending.state||pending.clientId!==clientId||
  Date.now()-pending.created>600000||pending.redirect!==redirect)return;
 try{
  const info=await token({client_id:clientId,grant_type:'authorization_code',
   code,redirect_uri:redirect,code_verifier:pending.verifier});
  if(!info.access_token||!info.refresh_token)throw Error('No Spotify authorization token');
  access=info.access_token;refresh=info.refresh_token;
  expires=Date.now()+Math.max(60,Number(info.expires_in)||3600)*1000;
  store();renderControls();await check(true);
 }catch(e){statusNote('Spotify connection failed. Try again.')}
}
async function validToken(){
 if(!refresh)return null;
 if(access&&expires>Date.now()+45000)return access;
 try{
  const info=await token({client_id:clientId,grant_type:'refresh_token',refresh_token:refresh});
  if(!info.access_token)throw Error('Spotify refresh failed');
  access=info.access_token;refresh=info.refresh_token||refresh;
  expires=Date.now()+Math.max(60,Number(info.expires_in)||3600)*1000;
  store();return access;
 }catch(e){clearAuth();return null}
}
function textElement(tag,cls,txt){
 const e=document.createElement(tag);if(cls)e.className=cls;e.textContent=txt;return e;
}
function updateBar(){
 if(!bar)return;
 bar.replaceChildren();
 if(!playing||document.hidden){bar.hidden=true;return}
 const label=textElement('span','lj-spotify-source','Spotify · Now playing');
 const title=textElement('strong','lj-spotify-track',playing.title);
 const artist=textElement('small','lj-spotify-artist',playing.artist);
 const info=document.createElement('div');info.className='lj-spotify-text';
 info.append(label,title,artist);
 const link=document.createElement('a');
 link.href=playing.url;
 link.target='_blank';link.rel='noopener noreferrer';
 link.className='lj-spotify-open';link.textContent='Open ↗';
 link.setAttribute('aria-label','Open this track in Spotify');
 bar.append(info,link);bar.hidden=false;
}
async function check(force){
 if(!authValid()||loading||document.hidden)return;
 if(!force&&Date.now()<nextPoll)return;
 loading=true;nextPoll=Date.now()+45000;
 try{
  const bearer=await validToken();
  if(!bearer)return;
  let response=await fetch('https://api.spotify.com/v1/me/player/currently-playing',{
   headers:{Authorization:'Bearer '+bearer},cache:'no-store'
  });
  if(response.status===401){
   access=null;expires=0;const retry=await validToken();
   if(!retry)return;
   response=await fetch('https://api.spotify.com/v1/me/player/currently-playing',{
    headers:{Authorization:'Bearer '+retry},cache:'no-store'
   });
  }
  if(response.status===429){nextPoll=Date.now()+120000;playing=null;updateBar();return}
  if(!response.ok&&response.status!==204)throw Error('Spotify unavailable');
  const p=response.status===204?null:await response.json();
  const item=p?.item;
  const url=item?.external_urls?.spotify;
  playing=(p?.is_playing&&p?.currently_playing_type==='track'&&
   typeof item?.name==='string'&&Array.isArray(item?.artists)&&
   typeof url==='string'&&/^https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]+/.test(url))?
   {title:item.name,artist:item.artists.map(a=>a.name).filter(Boolean).join(', ')||'Unknown artist',url}:null;
  updateBar();
 }catch(e){
  // Never show stale song details after a network or permission error.
  playing=null;updateBar();
 }finally{loading=false}
}
function renderControls(){
 const host=document.getElementById('lj-spotify-connect');
 if(!host)return;
 host.replaceChildren();
 const heading=textElement('h3','','Spotify · Now Playing');
 host.append(heading);
 if(!clientId){
  host.append(textElement('p','note','Spotify connection is not yet configured for Lift Journal. A Spotify developer Client ID is required.'));
  return;
 }
 if(!authValid()){
  const button=textElement('button','btn secondary','Connect Spotify');
  button.type='button';button.dataset.spotifyConnect='1';host.append(button);
  host.append(textElement('p','note','Read-only access to your currently playing track. No account password is shared with Lift Journal.'));
 }else{
  const button=textElement('button','btn tiny secondary','Disconnect Spotify');
  button.type='button';button.dataset.spotifyDisconnect='1';host.append(button);
  host.append(textElement('p','note','Connected. The music bar appears only while a Spotify track is actually playing. Pausing hides it.'));
 }
 const note=textElement('p','note','');note.id='lj-spotify-connect-status';host.append(note);
}
document.addEventListener('click',function(e){
 if(e.target.closest('[data-spotify-connect]')){connect();return}
 if(e.target.closest('[data-spotify-disconnect]')){clearAuth();return}
});
document.addEventListener('visibilitychange',()=>{
 if(document.hidden){if(bar)bar.hidden=true;return}
 check(true);updateBar();
});
window.addEventListener('pageshow',()=>{check(true)});
function start(){
 if(!clientId)return;
 restore();callback().then(()=>{check(true)});
 pollTimer=setInterval(()=>{if(!document.hidden)check(false)},45000);
}
window.LJSpotify={start,renderControls};
})();