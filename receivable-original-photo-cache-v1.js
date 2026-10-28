/* BIG BROTHER — Real Invoice photo cache, device-only, account-scoped.
 * 7 days since last view; 200 MB maximum across local accounts.
 * No storage bucket writes, no service worker interception, no background
 * download. Photos are cached only AFTER an authorized user opens them.
 */
(function(){
'use strict';
if(window.BBAROriginalPhotoCacheV1)return;
const DB='BB_AR_ORIGINAL_PHOTO_CACHE_V1',STORE='photos',VERSION=1;
const AGE=7*24*60*60*1000,MAX=200*1024*1024,SESSION='BB_SUPABASE_DEV_SESSION_V1';
let opening=null,cleaning=null;
const now=()=>Date.now();
const validId=id=>typeof id==='string'&&id.length>0&&id.length<=200;
function user(){
 try{return String(JSON.parse(localStorage.getItem(SESSION)||'null')?.user?.id||'').trim()}catch(_){return''}
}
function openDb(){
 if(!('indexedDB' in window))return Promise.resolve(null);
 if(opening)return opening;
 opening=new Promise(resolve=>{
  try{
   const request=indexedDB.open(DB,VERSION);
   request.onupgradeneeded=()=>{
    const db=request.result;
    if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'key'});
   };
   request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db)};
   request.onerror=()=>resolve(null);
   request.onblocked=()=>resolve(null);
  }catch(_){resolve(null)}
 });
 return opening;
}
const key=(uid,id)=>uid+'::'+id;
function valid(entry,uid,id){
 return !!(entry&&entry.userId===uid&&entry.invoiceId===id&&entry.blob instanceof Blob&&
   Number.isFinite(entry.lastViewed)&&entry.lastViewed>0&&now()-entry.lastViewed<AGE&&
   entry.lastViewed<=now()+60000&&Number(entry.bytes)>0);
}
async function get(id){
 const uid=user();id=String(id||'').trim();
 if(!uid||!validId(id))return null;
 const db=await openDb();if(!db||user()!==uid)return null;
 return new Promise(resolve=>{
  try{
   const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),req=store.get(key(uid,id));
   let result=null;
   req.onsuccess=()=>{
    const item=req.result;
    if(!valid(item,uid,id)){if(item)store.delete(key(uid,id));return}
    item.lastViewed=now();
    store.put(item);
    result={invoiceId:item.invoiceId,path:item.path,blob:item.blob,bytes:item.bytes,verifiedAt:item.verifiedAt||0};
   };
   tx.oncomplete=()=>resolve(user()===uid?result:null);
   tx.onabort=()=>resolve(null);tx.onerror=()=>resolve(null);
  }catch(_){resolve(null)}
 });
}
async function put(id,path,blob){
 const uid=user();id=String(id||'').trim();path=String(path||'').trim();
 if(!uid||!validId(id)||!path||!(blob instanceof Blob)||blob.size<=0||blob.size>MAX)return false;
 const db=await openDb();if(!db||user()!==uid)return false;
 const entry={key:key(uid,id),userId:uid,invoiceId:id,path,blob,bytes:blob.size,lastViewed:now(),verifiedAt:now()};
 const saved=await new Promise(resolve=>{
  try{
   const tx=db.transaction(STORE,'readwrite');
   tx.objectStore(STORE).put(entry);
   tx.oncomplete=()=>resolve(user()===uid);
   tx.onerror=()=>resolve(false);tx.onabort=()=>resolve(false);
  }catch(_){resolve(false)}
 });
 if(saved)void cleanup();
 return saved;
}
async function markVerified(id,path){
 const uid=user();id=String(id||'').trim();
 if(!uid||!validId(id))return false;
 const db=await openDb();if(!db||user()!==uid)return false;
 return new Promise(resolve=>{
  try{
   let changed=false;
   const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),req=store.get(key(uid,id));
   req.onsuccess=()=>{
    const entry=req.result;
    if(valid(entry,uid,id)&&entry.path===path){
     entry.verifiedAt=now();store.put(entry);changed=true;
    }
   };
   tx.oncomplete=()=>resolve(changed);
   tx.onerror=()=>resolve(false);tx.onabort=()=>resolve(false);
  }catch(_){resolve(false)}
 });
}
async function remove(id){
 const uid=user();id=String(id||'').trim();
 if(!uid||!validId(id))return false;
 const db=await openDb();if(!db)return false;
 return new Promise(resolve=>{
  try{
   const tx=db.transaction(STORE,'readwrite');
   tx.objectStore(STORE).delete(key(uid,id));
   tx.oncomplete=()=>resolve(true);
   tx.onerror=()=>resolve(false);tx.onabort=()=>resolve(false);
  }catch(_){resolve(false)}
 });
}
async function list(ids){
 const uid=user(),wanted=new Set((Array.isArray(ids)?ids:[]).map(String));
 const found=new Set();if(!uid||!wanted.size)return found;
 const db=await openDb();if(!db||user()!==uid)return found;
 return new Promise(resolve=>{
  try{
   const tx=db.transaction(STORE,'readonly'),req=tx.objectStore(STORE).openCursor();
   req.onsuccess=()=>{
    const cursor=req.result;if(!cursor)return;
    const v=cursor.value;
    if(v.userId===uid&&wanted.has(v.invoiceId)&&valid(v,uid,v.invoiceId))found.add(v.invoiceId);
    cursor.continue();
   };
   tx.oncomplete=()=>resolve(user()===uid?found:new Set());
   tx.onerror=()=>resolve(new Set());
  }catch(_){resolve(new Set())}
 });
}
async function stats(){
 const uid=user(),db=await openDb(),result={count:0,bytes:0,limitBytes:MAX,expiryDays:7};
 if(!db||!uid)return result;
 return new Promise(resolve=>{
  try{
   const tx=db.transaction(STORE,'readonly'),req=tx.objectStore(STORE).openCursor();
   req.onsuccess=()=>{const c=req.result;if(!c)return;
    const v=c.value;
    if(v.userId===uid&&valid(v,uid,v.invoiceId)){result.count++;result.bytes+=Number(v.bytes)||0}
    c.continue();
   };
   tx.oncomplete=()=>resolve(user()===uid?result:{...result,count:0,bytes:0});
   tx.onerror=()=>resolve(result);
  }catch(_){resolve(result)}
 });
}
async function clear(){
 const uid=user(),db=await openDb();
 if(!uid||!db)return false;
 return new Promise(resolve=>{
  try{
   const tx=db.transaction(STORE,'readwrite'),req=tx.objectStore(STORE).openCursor();
   req.onsuccess=()=>{const c=req.result;if(!c)return;
    if(c.value?.userId===uid)c.delete();
    c.continue();
   };
   tx.oncomplete=()=>resolve(true);
   tx.onerror=()=>resolve(false);tx.onabort=()=>resolve(false);
  }catch(_){resolve(false)}
 });
}
async function cleanup(){
 if(cleaning)return cleaning;
 cleaning=(async()=>{
  const db=await openDb();
  if(!db)return {removed:0};
  return new Promise(resolve=>{
   try{
    const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);
    const req=store.openCursor(),validEntries=[];
    let removed=0,total=0;
    req.onsuccess=()=>{
     const c=req.result;
     if(!c){
      // Total capacity across all accounts on this device; least-recently
      // viewed photos removed first. Never touch the cloud original.
      validEntries.sort((a,b)=>a.lastViewed-b.lastViewed);
      for(const v of validEntries){
       if(total<=MAX)break;
       store.delete(v.key);total-=v.bytes;removed++;
      }
      return;
     }
     const v=c.value;
     if(!v||!v.userId||!validId(v.invoiceId)||!valid(v,v.userId,v.invoiceId)){
      c.delete();removed++;
     }else{total+=v.bytes;validEntries.push({key:v.key,lastViewed:v.lastViewed,bytes:v.bytes})}
     c.continue();
    };
    tx.oncomplete=()=>resolve({removed});
    tx.onerror=()=>resolve({removed:0});tx.onabort=()=>resolve({removed:0});
   }catch(_){resolve({removed:0})}
  });
 })().finally(()=>{cleaning=null});
 return cleaning;
}
window.BBAROriginalPhotoCacheV1=Object.freeze({get,put,remove,markVerified,list,stats,clear,cleanup,
  maxBytes:MAX,ageMs:AGE,currentUserId:user});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>void cleanup(),{once:true});
else void cleanup();
})();
