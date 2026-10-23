/* Lift Journal offline app shell. User records remain in browser localStorage. */
const CACHE_NAME='lift-journal-shell-v1.29.1';
const SHELL=['./','./index.html','./coach-config.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
const SCOPE=new URL(self.registration.scope);
const HOME=new URL('./index.html',SCOPE).href;
const ASSETS=new Set(SHELL.map(path=>new URL(path,SCOPE).href));
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(Promise.all([
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('lift-journal-shell-')&&key!==CACHE_NAME).map(key=>caches.delete(key)))),
  self.clients.claim()
 ]));
});
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 const url=new URL(request.url);
 if(url.origin!==SCOPE.origin||!url.pathname.startsWith(SCOPE.pathname))return;
 if(request.mode==='navigate'){
  event.respondWith(fetch(request).then(response=>{
   if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.put(HOME,copy)));}
   return response;
  }).catch(async()=>await caches.match(HOME)||Response.error()));
 }else if(url.href===new URL('./coach-config.js',SCOPE).href){
  // Always fetch the latest public Cloudflare configuration when online.
  // Keep the cached copy only for offline use; never clear local workout storage.
  event.respondWith(fetch(request,{cache:'no-store'}).then(response=>{
   if(response.ok){
    const copy=response.clone();
    event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.put(request,copy)));
   }
   return response;
  }).catch(async()=>await caches.match(request)||Response.error()));
 }else if(ASSETS.has(url.href)){
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request)));
 }
});
