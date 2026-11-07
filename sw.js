/* BIG BROTHER Your Receivable real-function asset cache pilot V1.
   Scope restricted to this static GitHub Pages repository path.
   No interception of Supabase, authentication, financial RPC or writes. */
const NAME='bb-ar-real-ui-v24', PREFIX=new URL('./',self.registration.scope).pathname;
const MAIN=['your-receivable-mobile.html','your-receivable.html','all-receivable-mobile.html','all-receivable-engine-mobile.html','legacy-google-v3.html','supabase-ar-adapter.js','receivable-smart-cache-v1.js','receivable-file-actions-v1.js'];
// Pin new summary source to its actual version. An old canonical cache must not
// shadow a new ?v=... A/R page on a phone or Android WebView.
const CURRENT_SUMMARY_VERSION='20261107-ar-mobile-customer-totals-v2';
const SUMMARY_ASSETS=[
  'your-receivable-mobile.html','your-receivable.html',
  'all-receivable-mobile.html','all-receivable-engine-mobile.html','legacy-google-v3.html'
];
const OTHER=['your-receivable-mobile-cards-v1.html','receivable-telegram-v1.js','receivable-backup-v1.js',
  'receivable-original-photo-cache-v1.js','receivable-real-invoice-view-v1.js',
  'ar-bank-wallet-picker-v1.js','receivable-batch-real-invoice-v1.js','receivable-audit-pdf-v1.js',
  'receivable-customer-excel-v1.js','receivable-notification-focus-v1.js',
  'vendor/pdf-lib.min.js','vendor/html2pdf.bundle.min.js'];
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(NAME);
    await Promise.all(MAIN.map(name=>cache.add(new Request(new URL(name,self.registration.scope),{cache:'reload'}))));
    await Promise.all(SUMMARY_ASSETS.map(name=>cache.add(
      new Request(new URL(name+'?v='+CURRENT_SUMMARY_VERSION,self.registration.scope),{cache:'reload'})
    )));
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
// A versioned URL needs its own cache key. The old canonical-only cache would
// return 64 invoice lines from the PREVIOUS release even when ?v=... changed.
// Keep the canonical cache as an offline fallback for any yet-unseen revision.
const lastChecked=new Map(), CHECK_MS=5*60*1000;
self.addEventListener('fetch',event=>{
  const request=event.request;if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin||!url.pathname.startsWith(PREFIX)||
      !/\.(?:html|js|css)$/.test(url.pathname))return;
  const canonical=new Request(url.origin+url.pathname);
  const version=url.searchParams.get('v');
  const key=version
    ?new Request(url.origin+url.pathname+'?v='+encodeURIComponent(version))
    :canonical;
  const cachePromise=caches.open(NAME);
  const now=Date.now();
  const check=now-(lastChecked.get(key.url)||0)>=CHECK_MS;
  if(check)lastChecked.set(key.url,now);
  // Background refresh keeps a known release fast, while the first visit to
  // a NEW release must fetch its version instead of serving an older version.
  const refresh=check?cachePromise.then(cache=>
    fetch(request,{cache:'no-store'}).then(async response=>{
      if(response.ok&&response.type==='basic'){
        await cache.put(canonical,response.clone());
        if(version)await cache.put(key,response.clone());
      }
      return response;
    }).catch(()=>null)
  ):Promise.resolve(null);
  if(check)event.waitUntil(refresh.then(()=>undefined));
  event.respondWith((async()=>{
    const cache=await cachePromise;
    const saved=await cache.match(key);
    if(saved)return saved;
    // The exact revision isn't cached. Fetch it rather than returning the
    // previously cached revision. No Supabase/API requests are intercepted.
    const response=await refresh;
    if(response?.ok)return response;
    if(!check){
      try{
        const next=await fetch(request,{cache:'no-store'});
        if(next.ok){
          if(next.type==='basic'){
            await cache.put(canonical,next.clone());
            if(version)await cache.put(key,next.clone());
          }
          return next;
        }
      }catch(_){}
    }
    // Offline-first fallback: the latest canonical version remains readable
    // when this device has never downloaded the newly requested revision.
    const offline=await cache.match(canonical);
    if(offline)return offline;
    return new Response('BIG BROTHER function not yet cached.',{status:503});
  })());
});