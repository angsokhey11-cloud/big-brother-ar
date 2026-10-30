/* BIG BROTHER A/R generated file actions — web/PWA + trusted Android bridge.
   No network upload, no automatic Telegram recipient and no database writes.
   The Android app confirms share/save via native chooser; PWA uses Web Share.
 */
(function(){
'use strict';
const MAX_FILE=18*1024*1024,MAX_TOTAL=24*1024*1024,MAX_COUNT=12;
const native=()=>typeof window.BBNativeFiles?.postMessage==='function';
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
 window.BBNativeFiles.postMessage(JSON.stringify({action,files:packaged}));
 return true;
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
window.BBARFileActionsV1=Object.freeze({isNative:native,inInstalledApk,save,share,open});
})();