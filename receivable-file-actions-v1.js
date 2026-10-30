/* BIG BROTHER A/R generated file actions — web/PWA + trusted Android bridge.
   No network upload, no automatic Telegram recipient and no database writes.
   The Android app confirms share/save via native chooser; PWA uses Web Share.
 */
(function(){
'use strict';
const MAX_FILE=18*1024*1024,MAX_TOTAL=24*1024*1024,MAX_COUNT=12;
// Android's origin-scoped bridge may be attached to the trusted top frame
// rather than a nested A/R iframe. Use an accessible same-origin ancestor.
function findNativeBridge(){
 const candidates=[window];
 try{if(window.parent&&window.parent!==window)candidates.push(window.parent)}catch(_){}
 try{if(window.top&&window.top!==window)candidates.push(window.top)}catch(_){}
 for(const frame of candidates){
  try{
   if(frame.location.origin!==window.location.origin)continue;
   if(typeof frame.BBNativeFiles?.postMessage==='function')return frame.BBNativeFiles;
  }catch(_){}
 }
 return null;
}
const native=()=>!!findNativeBridge();
function inInstalledApk(){
  if(!/Android/i.test(navigator.userAgent||''))return false;
  try{
    const topUrl=new URL(window.top.location.href);
    const isDashboard=topUrl.pathname.startsWith('/big-brother-dashboard/');
    const params=topUrl.searchParams;
    return isDashboard&&(params.get('source')==='android-online'||params.get('localbrain')==='1')&&
      window.top!==window;
  }catch(_){return false;}
}
function requireApkBridge(){
  if(inInstalledApk()&&!native())throw Error(
    'The APK native file handler is unavailable. Install the latest signed BIG BROTHER APK, run Local Brain Code Sync if using Local, then reopen the app. Your invoice data is unchanged.'
  );
}
function filename(v){return String(v||'BIG-BROTHER-export').replace(/[\\/\\x00-\\x1f:*?"<>|]/g,'_').slice(0,145)}
function readBase64(blob){
 return new Promise((resolve,reject)=>{
  const fr=new FileReader();
  fr.onload=()=>{const data=String(fr.result||'');const comma=data.indexOf(',');comma<0?reject(Error('Cannot encode file for Android.')):resolve(data.slice(comma+1))};
  fr.onerror=()=>reject(Error('Cannot read generated file.'));
  fr.readAsDataURL(blob);
 });
}
// The Android chooser must ACK before we report success. A sent WebMessage
// is not proof that Android received the file or opened the Save/Share picker.
let bbNextNativeRequest=0;
const bbNativePending=new Map();
function bbNativeReply(event){
  let response;
  try{response=JSON.parse(String(event?.data||''))}catch(_){return}
  const entry=bbNativePending.get(response?.requestId);
  if(!entry)return;
  bbNativePending.delete(response.requestId);
  clearTimeout(entry.timer);
  if(response.ok)entry.resolve(true);
  else entry.reject(Error('Android could not open the file chooser. '+String(response.message||'Try the signed APK update.')));
}

async function sendNative(action,files){
 if(!native())return false;
 if(!['save','share','open'].includes(action))throw Error('Unsupported Android file action');
 if(!Array.isArray(files)||!files.length||files.length>MAX_COUNT)throw Error('Select fewer invoice files to export (maximum 12).');
 const total=files.reduce((n,f)=>n+f.size,0);
 if(total>MAX_TOTAL||files.some(f=>f.size>MAX_FILE))throw Error('Files exceed the Android share limit. Split your invoice package into smaller groups.');
 const packaged=[];
 for(const file of files){
  packaged.push({name:filename(file.name),type:String(file.type||'application/octet-stream'),data:await readBase64(file)});
 }
 const bridge=findNativeBridge();
 if(!bridge)throw Error('Native Android file bridge is unavailable in this A/R frame.');
 const requestId=++bbNextNativeRequest;
 // The native WebMessageListener delivers replies to this SAME source frame,
 // including the nested My/All Receivables iframe.
 bridge.onmessage=bbNativeReply;
 return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{
     bbNativePending.delete(requestId);
     reject(Error('Android did not confirm the file chooser. Install the latest signed Online/Local APK, run Code Sync for Local Brain, then reopen Summary Invoice.'));
   },22000);
   bbNativePending.set(requestId,{resolve,reject,timer});
   try{bridge.postMessage(JSON.stringify({action,files:packaged,requestId}))}
   catch(error){
     clearTimeout(timer);bbNativePending.delete(requestId);
     reject(Error('Android file handoff failed: '+String(error?.message||error)));
   }
 });
}
async function ping(){
 const bridge=findNativeBridge();
 if(!bridge)return {ok:false,message:'No native JavaScript bridge detected in this frame or a same-origin parent.'};
 const requestId=++bbNextNativeRequest;
 bridge.onmessage=bbNativeReply;
 try{
   await new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>{
       bbNativePending.delete(requestId);
       reject(Error('No Android response after 7 seconds. The APK is outdated or rejected this frame.'));
     },7000);
     bbNativePending.set(requestId,{resolve,reject,timer});
     try{bridge.postMessage(JSON.stringify({action:'ping',requestId}))}
     catch(e){clearTimeout(timer);bbNativePending.delete(requestId);reject(e)}
   });
   return {ok:true,message:'Native listener accepted this screen origin and replied.'};
 }catch(error){
   return {ok:false,message:String(error?.message||error)};
 }
}

function browserDownload(file){
 const url=URL.createObjectURL(file),anchor=document.createElement('a');
 anchor.href=url;anchor.download=filename(file.name);
 document.body.append(anchor);anchor.click();anchor.remove();
 setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function save(file){
 requireApkBridge();
 if(await sendNative('save',[file]))return 'native';
 browserDownload(file);return 'browser';
}
async function share(files,title,text){
 requireApkBridge();
 if(!Array.isArray(files))files=[files];
 if(native()){
   await sendNative('share',files);
   return 'native';
 }
 if(typeof navigator.share!=='function'||typeof navigator.canShare!=='function'||!navigator.canShare({files}))
  throw Error('File sharing is unavailable here. Use Save to Device and attach the saved file in Telegram.');
 // The native browser API MUST start in the original button click task.
 const request=navigator.share({files,title:title||'BIG BROTHER',text:text||''});
 await request;
 return 'browser';
}
async function open(file){
 requireApkBridge();
 if(await sendNative('open',[file]))return 'native';
 browserDownload(file);return 'browser';
}
function diagnostics(){
 let topOrigin='different-origin',mode='browser';
 try{
  topOrigin=window.top.location.origin;
  const search=new URLSearchParams(window.top.location.search);
  if(search.get('source')==='android-online')mode='online-app';
  else if(search.get('localbrain')==='1')mode='local-brain';
 }catch(_){}
 return {
  version:'BB-AR-FILE-ACTIONS-V2',
  pageOrigin:location.origin,topOrigin,mode,
  adapterReady:true,nativeBridgeReady:native(),
  webShareReady:typeof navigator.share==='function',
  pdfToolsReady:typeof window.BBARAuditPdfExport?.save==='function',
  rendererReady:typeof window.html2canvas==='function'||typeof window.html2pdf==='function',
  summaryReady:!!document.getElementById('summarySheet')
 };
}
window.BBARFileActionsV1=Object.freeze({isNative:native,inInstalledApk,save,share,open,diagnostics,ping});
})();