/* BIG BROTHER Your Receivable real-function asset cache pilot V1.
   Scope restricted to this static GitHub Pages repository path.
   No interception of Supabase, authentication, financial RPC or writes. */
const NAME='bb-ar-real-ui-v1', PREFIX=new URL('./',self.registration.scope).pathname;
const MAIN=['your-receivable-mobile.html','your-receivable.html','legacy-google-v3.html','supabase-ar-adapter.js','receivable-smart-cache-v1.js'];
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
self.addEventListener('fetch',event=>{
  const request=event.request;if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin||!url.pathname.startsWith(PREFIX)||
      !/\.(?:html|js|css)$/.test(url.pathname))return;
  event.respondWith((async()=>{
    const cache=await caches.open(NAME);
    const cached=await cache.match(request,{ignoreSearch:true});
    const fresh=fetch(request,{cache:'no-store'}).then(async response=>{
      if(response.ok&&response.type==='basic')await cache.put(request,response.clone());
      return response;
    }).catch(()=>null);
    // Real code appears instantly. New GitHub code is stored for the next opening.
    if(cached){event.waitUntil(fresh.then(()=>undefined));return cached}
    const response=await fresh;
    if(response?.ok)return response;
    return new Response('BIG BROTHER function not yet cached.',{status:503});
  })());
});