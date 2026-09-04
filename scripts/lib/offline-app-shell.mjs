import { createHash } from "node:crypto";

/** Only the public build output belongs in the offline cache, never API data. */
export function createOfflineAppShell(releaseSha, files) {
  const precache = ["/", ...files.filter((name) => !name.endsWith(".map") && name !== "sw.js").sort().map((name) => `/${name}`)];
  const fingerprint = createHash("sha256").update(JSON.stringify(precache)).digest("hex").slice(0, 12);
  return `const CACHE_NAME=${JSON.stringify(`liftlog-shell-${releaseSha}-${fingerprint}`)};
const PRECACHE=${JSON.stringify(precache)};
const ASSETS=new Set(PRECACHE.filter(path=>path!=="/"));
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(PRECACHE)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("liftlog-shell-")&&key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  if(request.mode==="navigate"){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE_NAME);
      try {
        const response=await fetch(request);
        if(response.ok&&response.headers.get("content-type")?.includes("text/html")){
          // Keep the installed HTML paired with its precached build assets.
          // A newer online deployment belongs to the next worker's cache.
          return response;
        }
        return await cache.match("/")||response;
      } catch {
        return await cache.match("/")||Response.error();
      }
    })());
    return;
  }
  if(!ASSETS.has(url.pathname))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME);
    const cached=await cache.match(url.pathname);
    if(cached)return cached;
    const response=await fetch(request);
    if(response.ok)event.waitUntil(cache.put(url.pathname,response.clone()).catch(()=>{}));
    return response;
  })());
});
`;
}
