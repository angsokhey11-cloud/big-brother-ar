/* BIG BROTHER Your Receivable real-function asset cache pilot V1.
   Scope restricted to this static GitHub Pages repository path.
   No interception of Supabase, authentication, financial RPC or writes. */
const NAME='bb-ar-real-ui-v4', PREFIX=new URL('./',self.registration.scope).pathname;
const MAIN=['your-receivable-mobile.html','your-receivable.html','all-receivable-mobile.html','all-receivable-engine-mobile.html','legacy-google-v3.html','supabase-ar-adapter.js','receivable-smart-cache-v1.js'];
const OTHER=['your-receivable-mobile-cards-v1.html','receivable-telegram-v1.js','receivable-backup-v1.js',
  'receivable-original-photo-cache-v1.js','receivable-real-invoice-view-v1.js',
  'ar-bank-wallet-picker-v1.js','receivable-batch-real-invoice-v1.js','receivable-audit-pdf-v1.js',
  'receivable-customer-excel-v1.js','receivable-notification-focus-v1.js'];
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(NAME);
    await Promise.all(MAIN.map(name=>cache.add(new Request(new URL(name,self.registration.scope),{cache:'reload'}))));
    await Promise.allSettled(OTHER.map(name=>cache.add(new Request(new URL(name,self.registration.scope),{cache:'reload'}))));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith('bb-ar-real-ui-')&&k!==NAME).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
// A static path is one asset even when the URL contains view or version params.
// Canonical keys prevent an old ?v=... entry shadowing a newer downloaded file.
const lastChecked=new Map(), CHECK_MS=5*60*1000;
self.addEventListener('fetch',event=>{
  const request=event.request;if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin||!url.pathname.startsWith(PREFIX)||
      !/\.(?:html|js|css)$/.test(url.pathname))return;
  const key=new Request(url.origin+url.pathname);
  const cachePromise=caches.open(NAME);
  const now=Date.now();
  const check=now-(lastChecked.get(url.pathname)||0)>=CHECK_MS;
  if(check)lastChecked.set(url.pathname,now);
  // Register refresh lifetime while the fetch event is still dispatching.
  const refresh=check?cachePromise.then(cache=>
    fetch(request,{cache:'no-store'}).then(async response=>{
      if(response.ok&&response.type==='basic')await cache.put(key,response.clone());
      return response;
    }).catch(()=>null)
  ):Promise.resolve(null);
  if(check)event.waitUntil(refresh.then(()=>undefined));
  event.respondWith((async()=>{
    const cache=await cachePromise;
    const saved=await cache.match(key);
    if(saved)return saved;
    const response=await refresh;
    if(response?.ok)return response;
    // A throttled request whose cache entry was evicted must still attempt live.
    if(!check){
      try{
        const next=await fetch(request);
        if(next.ok)await cache.put(key,next.clone());
        return next;
      }catch(_){}
    }
    return new Response('BIG BROTHER function not yet cached.',{status:503});
  })());
});