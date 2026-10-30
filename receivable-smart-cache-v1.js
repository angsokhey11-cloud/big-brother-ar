/* BIG BROTHER — Real A/R Cache-First Pilot V1.
   User-scoped IndexedDB snapshot, display-only until Supabase confirms live access.
   Never intercepts/mutates payment, approval, bank or invoice write operations. */
(function(){
'use strict';
const DB='BB_MOBILE_OFFLINE_WORKSPACE_V1', STORE='snapshots', KEY='BB_SUPABASE_DEV_SESSION_V1';
// Separate location-scoped and company-scoped datasets. Never mix the two.
const SCOPE=new URLSearchParams(location.search).get('view')==='all'?'all':'your';
const MAX_AGE=7*86400000, SNAP=SCOPE==='all'?'offline-ar-all':'offline-ar-your',
  ACCESS=SCOPE==='all'?'bb-ar-all-access-v1':'bb-ar-your-access-v1';
function userId(){
  try{return String(JSON.parse(localStorage.getItem(KEY)||'null')?.user?.id||'').trim()}
  catch(_){return ''}
}
function db(){
  return new Promise(resolve=>{
    try{
      const request=indexedDB.open(DB,1);
      request.onupgradeneeded=()=>{
        if(!request.result.objectStoreNames.contains(STORE))
          request.result.createObjectStore(STORE,{keyPath:'key'});
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>resolve(null);
      request.onblocked=()=>resolve(null);
    }catch(_){resolve(null)}
  });
}
async function readKey(key){
  const id=userId();if(!id)return null;
  const conn=await db();if(!conn)return null;
  return new Promise(resolve=>{
    try{
      const req=conn.transaction(STORE,'readonly').objectStore(STORE).get(id+'::'+key);
      req.onsuccess=()=>{
        const record=req.result;
        resolve(record?.userId===id&&Number.isFinite(record?.syncedAt)&&
          record.syncedAt<=Date.now()+60000&&Date.now()-record.syncedAt<=MAX_AGE?record:null);
      };
      req.onerror=()=>resolve(null);
    }catch(_){resolve(null)}
  });
}
async function writeKey(key,value){
  const id=userId();if(!id||!value)return false;
  const conn=await db();if(!conn||id!==userId())return false;
  return new Promise(resolve=>{
    try{
      const tx=conn.transaction(STORE,'readwrite');
      tx.objectStore(STORE).put({key:id+'::'+key,userId:id,syncedAt:Date.now(),value});
      tx.oncomplete=()=>resolve(true);
      tx.onerror=()=>resolve(false);
      tx.onabort=()=>resolve(false);
    }catch(_){resolve(false)}
  });
}
function snapshot(data){
  if(!data?.success||!Array.isArray(data.receivables))return null;
  return {success:true,receivables:data.receivables.map(r=>({
    invoiceId:r.invoiceId,invoiceNo:r.invoiceNo,invoiceDate:r.invoiceDate,
    dueDate:r.dueDate,customer:r.customer,customerId:r.customerId,
    locationCode:r.locationCode,locationName:r.locationName,currency:r.currency,
    grandTotal:r.grandTotal,amountPaid:r.amountPaid,outstanding:r.outstanding,
    arStatus:r.arStatus,requestId:r.requestId,requestedBy:r.requestedBy
  }))};
}
async function read(){
  const [data,profile]=await Promise.all([readKey(SNAP),readKey(ACCESS)]);
  if(!data?.value?.success||!Array.isArray(data.value.receivables))return null;
  return {receivables:data.value.receivables,access:profile?.value||null,syncedAt:data.syncedAt};
}
function label(when){
  try{return new Date(when).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}
  catch(_){return 'an earlier sync'}
}
function setPending(when){
  document.documentElement.classList.add('bb-ar-cache-pending');
  let style=document.getElementById('bb-ar-cache-safety');
  if(!style){
    style=document.createElement('style');style.id='bb-ar-cache-safety';
    style.textContent='html.bb-ar-cache-pending #arBody button,html.bb-ar-cache-pending #arBody input.rowcheck,html.bb-ar-cache-pending #summaryBtn,html.bb-ar-cache-pending #batchBtn,html.bb-ar-cache-pending #selectAllBox{pointer-events:none!important;opacity:.45!important}';
    document.head.appendChild(style);
  }
  const status=document.getElementById('syncStatus');
  if(status)status.textContent='Saved '+label(when)+' · verifying live data · read-only';
}
function setLive(){
  document.documentElement.classList.remove('bb-ar-cache-pending');
}
function isNetworkFailure(error){
  return error instanceof TypeError || /failed to fetch|networkerror|network request failed|load failed|offline|timeout/i.test(String(error?.message||error||''));
}
window.BBARSmartCacheV1={
  read,saveAccess:access=>writeKey(ACCESS,access),
  saveData:data=>{const value=snapshot(data);return value?writeKey(SNAP,value):Promise.resolve(false)},
  setPending,setLive,isNetworkFailure
};
})();