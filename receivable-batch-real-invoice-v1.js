/* BIG BROTHER A/R — share customer summary and original invoice photos.
   Native share: groups of up to 10 photos, each launched by the user's tap.
   Non-photo originals remain separate native-file shares (never silently lost).
   No PDF generation or automatic download from the Share button.
   ZIP is available only under the explicit Download Package action. */
(function(){
'use strict';
const BASE='https://sjfhlaclgmkwwofzstok.supabase.co';
const KEY='sb_publishable_w762jR65CWwlO30fKQsYOw_6L9grx8S';
const BUCKET='bb-real-invoices';
const MAX_FILES=35, MAX_BYTES=65*1024*1024, ALBUM_SIZE=10;
let packageData=null,buildSeq=0,previousSignature='',isBuilding=false,sharePlan=null;
const $=id=>document.getElementById(id);
function safe(v){return String(v||'').trim().replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,65)||'Invoice'}
function chosen(){
 // Reuse the frozen invoice list visible in the open Summary; a 20-second
 // background refresh or filter change must not silently change this package.
 return typeof summaryExportRows==='function'?summaryExportRows():[];
}
function indicator(msg,isError=false){
 const el=$('bbBatchOriginalStatus');
 if(el){el.textContent=msg||'';el.style.color=isError?'#aa3232':'#41617f'}
}
function buttonsBusy(busy){
 for(const id of ['bbShareSummaryOriginals','bbDownloadSummaryOriginals']){
  const el=$(id);if(el)el.disabled=busy;
 }
}
function selectionKey(picked){return picked.map(r=>String(r.invoiceId||'')).sort().join('|')}
function visible(){return $('summaryOverlay')&&!$('summaryOverlay').classList.contains('hidden')}
function reset(){buildSeq++;packageData=null;previousSignature='';isBuilding=false;sharePlan=null;hidePhotoPanel();buttonsBusy(true);indicator('')}
async function storageFile(row){
 await window.BBARAdapter.ensureSession();
 const ss=JSON.parse(localStorage.getItem('BB_SUPABASE_DEV_SESSION_V1')||'null');
 if(!ss?.access_token)throw Error('Your session expired. Please sign in again.');
 const path=row.path.split('/').map(encodeURIComponent).join('/');
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),20000);
 let res;
 try{
  res=window.BBARAdapter?.authenticatedFetch
   ? await window.BBARAdapter.authenticatedFetch('/storage/v1/object/authenticated/'+BUCKET+'/'+path,{cache:'no-store',signal:controller.signal})
   : await fetch(BASE+'/storage/v1/object/authenticated/'+BUCKET+'/'+path,{
      headers:{apikey:KEY,Authorization:'Bearer '+ss.access_token},cache:'no-store',signal:controller.signal
     });
 }catch(error){
  if(error?.name==='AbortError')throw Error('Loading original '+row.invoiceNo+' timed out. Please retry.');
  throw error;
 }finally{clearTimeout(timer)}
 if(!res.ok)throw Error('Could not load original '+row.invoiceNo+'. Please refresh and retry.');
 const blob=await res.blob();
 const extension=String(row.path).split('.').pop().toLowerCase();
 const ext=['jpg','jpeg','png','webp','gif','bmp','pdf'].includes(extension)?extension:'bin';
 const fileTypes={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',
  webp:'image/webp',gif:'image/gif',bmp:'image/bmp',pdf:'application/pdf'};
 const recordedMime=String(row.mimeType||blob.type||'').toLowerCase();
 // Older invoice uploads may have a generic octet-stream MIME. Correct it
 // from the extension so Android can share real photos as photos, not files.
 const mime=(!recordedMime||recordedMime==='application/octet-stream'||recordedMime==='binary/octet-stream')
  ?(fileTypes[ext]||'application/octet-stream'):recordedMime;
 return new File([blob],'Original_'+safe(row.invoiceNo)+'_'+safe(row.invoiceId)+'.'+ext,
  {type:mime});
}
async function build(){
 const chosenRows=chosen();
 if(!chosenRows.length){indicator('Select invoices to create this package.',true);return}
 if(chosenRows.length>MAX_FILES){
  indicator('Select up to '+MAX_FILES+' invoices per package, then send another batch.',true);return
 }
 const seq=++buildSeq,signature=selectionKey(chosenRows);
 isBuilding=true;buttonsBusy(true);indicator('Preparing customer summary and checking original uploads…');
 try{
  if(typeof createSummaryImageBlob!=='function')throw Error('Customer summary image is unavailable.');
  const ids=chosenRows.map(r=>String(r.invoiceId||'')).filter(Boolean);
  if(ids.length!==chosenRows.length)throw Error('Some selected invoices have no internal Invoice ID.');
  const manifestPromise=Promise.race([
   window.BBARAdapter.rpc('bb_ar_original_manifest',{p_invoice_ids:ids}),
   new Promise((_,reject)=>setTimeout(()=>reject(Error('Checking original uploads timed out. Please retry.')),15000))
  ]);
  const summaryPromise=createSummaryImageBlob();
  const [manifest,summaryBlob]=await Promise.all([manifestPromise,summaryPromise]);
  if(!Array.isArray(manifest))throw Error('Could not read the permitted invoice originals.');
  const permitted=new Map(manifest.map(row=>[String(row.invoiceId),row]));
  const missing=chosenRows.filter(r=>!permitted.has(String(r.invoiceId))).map(r=>String(r.invoiceNo));
  const customers=[...new Set(chosenRows.map(r=>String(r.customer||'Customer').trim()))];
  const customer=customers.length===1?customers[0]:customers.length+' Customers';
  const filename='BIG_BROTHER_'+(customers.length===1?safe(customer):'Multi_Customer')+'_Summary_'+new Date().toISOString().slice(0,10);
  if(seq!==buildSeq||!visible())return;
  const files=[new File([summaryBlob],filename+'.png',{type:'image/png'})];
  let size=summaryBlob.size;
  for(let i=0;i<chosenRows.length;i++){
   const entry=permitted.get(String(chosenRows[i].invoiceId));
   if(!entry)continue;
   indicator('Preparing originals '+(files.length)+' of '+manifest.length+'…');
   const file=await storageFile(entry);
   if(seq!==buildSeq||!visible())return;
   size+=file.size;
   if(size>MAX_BYTES)throw Error('The package is over 65 MB. Select fewer invoices and send multiple batches.');
   files.push(file);
  }
  const manifestText=[
   'BIG BROTHER — Customer Invoice Summary + Real Invoices',
   'Customers: '+customers.join(', '),
   'Selected invoices: '+chosenRows.map(r=>String(r.customer||'Customer')+' - '+String(r.invoiceNo)).join(', '),
   'Originals attached: '+(files.length-1),
   'Originals not uploaded or not accessible: '+(missing.length?missing.join(', '):'None'),
   'Each original is matched using its unique internal invoice ID.'
  ].join('\n');
  packageData={files,filename,manifestText,missing,customer,signature,cachedZip:null};
  sharePlan=null;hidePhotoPanel();
  previousSignature=signature;
  buttonsBusy(files.length<=1);
  const originalCount=files.length-1;
  indicator(originalCount+' original'+(originalCount===1?'':'s')+' ready');
 }catch(e){
  if(seq!==buildSeq)return;
  packageData=null;buttonsBusy(true);indicator(e.message||'Could not prepare original invoice package.',true);
 }finally{if(seq===buildSeq)isBuilding=false}
}
// Minimal, dependency-free ZIP writer using STORE. Third-party scripts never see private invoices.
const encoder=new TextEncoder();
const crcTable=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let x=n;for(let k=0;k<8;k++)x=(x&1)?0xedb88320^(x>>>1):x>>>1;t[n]=x>>>0;}return t})();
function crc32(data){let x=0xffffffff;for(let i=0;i<data.length;i++)x=crcTable[(x^data[i])&255]^(x>>>8);return (x^0xffffffff)>>>0}
function dosTime(date){return (date.getHours()<<11)|(date.getMinutes()<<5)|(date.getSeconds()>>1)}
function dosDate(date){return ((Math.max(1980,date.getFullYear())-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate()}
async function zip(files){
 const local=[],central=[];let offset=0;
 for(const file of files){
  const data=new Uint8Array(await file.arrayBuffer());
  const name=encoder.encode(file.name);
  const date=file.lastModified?new Date(file.lastModified):new Date();
  const crc=crc32(data);
  const l=new Uint8Array(30+name.length),lv=new DataView(l.buffer);
  lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x0800,true);
  lv.setUint16(8,0,true);lv.setUint16(10,dosTime(date),true);lv.setUint16(12,dosDate(date),true);
  lv.setUint32(14,crc,true);lv.setUint32(18,data.length,true);lv.setUint32(22,data.length,true);
  lv.setUint16(26,name.length,true);l.set(name,30);
  local.push(l,data);
  const h=new Uint8Array(46+name.length),v=new DataView(h.buffer);
  v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);
  v.setUint16(8,0x0800,true);v.setUint16(10,0,true);
  v.setUint16(12,dosTime(date),true);v.setUint16(14,dosDate(date),true);
  v.setUint32(16,crc,true);v.setUint32(20,data.length,true);v.setUint32(24,data.length,true);
  v.setUint16(28,name.length,true);v.setUint32(42,offset,true);h.set(name,46);
  central.push(h);offset+=l.length+data.length;
 }
 const dirSize=central.reduce((n,b)=>n+b.length,0);
 const end=new Uint8Array(22),v=new DataView(end.buffer);
 v.setUint32(0,0x06054b50,true);v.setUint16(8,central.length,true);v.setUint16(10,central.length,true);
 v.setUint32(12,dirSize,true);v.setUint32(16,offset,true);
 return new Blob([...local,...central,end],{type:'application/zip'});
}
async function packageZip(pkg){
 const readme=new File([pkg.manifestText],'PACKAGE_CONTENTS.txt',{type:'text/plain'});
 return new File([await zip([...pkg.files,readme])],pkg.filename+'_Originals.zip',{type:'application/zip'});
}
function download(file){
 const url=URL.createObjectURL(file),a=document.createElement('a');
 a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function valid(){
 const pkg=packageData,picked=chosen();
 if(!pkg||!visible()||pkg.signature!==selectionKey(picked)){
  indicator('Please wait for the current customer summary package to finish preparing.',true);return null;
 }
 // Fast synchronous check before native share (must keep its user gesture).
 // Expensive server revalidation already occurs during package build and for
 // on-demand downloads. Background A/R sync updates authorized rows in memory.
 const live=typeof rows!=='undefined'&&Array.isArray(rows)?new Map(rows.map(r=>[String(r.invoiceId||''),r])):new Map();
 const unchanged=picked.every(old=>{
  const current=live.get(String(old.invoiceId||''));
  return current&&String(current.invoiceNo||'')===String(old.invoiceNo||'')&&
   String(current.customerId||'')===String(old.customerId||'')&&
   String(current.invoiceDate||'')===String(old.invoiceDate||'')&&
   String(current.dueDate||'')===String(old.dueDate||'')&&
   String(current.currency||'USD')===String(old.currency||'USD')&&
   ['grandTotal','amountPaid','outstanding'].every(k=>Math.abs(Number(current[k]||0)-Number(old[k]||0))<0.000001)&&
   Number(current.outstanding||0)>0;
 });
 if(!unchanged){
  indicator('An invoice changed while Summary was open. Close Summary and reopen it before downloading or sharing.',true);return null;
 }
 return pkg;
}
async function downloadBatch(){
 const pkg=valid();if(!pkg)return;
 const btn=$('bbDownloadSummaryOriginals');btn.disabled=true;
 indicator('Creating ZIP package…');
 try{
  if(typeof verifySummaryCurrent!=='function')throw Error('Summary verification is unavailable. Refresh A/R.');
  await verifySummaryCurrent();
  const file=pkg.cachedZip||await packageZip(pkg);download(file);
  indicator('Summary and '+(pkg.files.length-1)+' originals downloaded in one ZIP'+(pkg.missing.length?' · Missing: '+pkg.missing.join(', '):'')+'.');
 }catch(e){indicator(e.message||'ZIP download failed.',true)}
 finally{btn.disabled=false}
}
function shareCaption(pkg,picked){
 const totals={USD:0,KHR:0};
 picked.forEach(r=>{
  const c=String(r.currency||'USD').toUpperCase()==='KHR'?'KHR':'USD';
  totals[c]+=Number(r.outstanding||0);
 });
 const amounts=[];
 if(totals.USD)amounts.push('$'+totals.USD.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}));
 if(totals.KHR)amounts.push('៛'+Math.round(totals.KHR).toLocaleString('en-US'));
 return 'BIG BROTHER Customer Invoice Summary\nCustomer: '+pkg.customer+
  '\nOutstanding: '+(amounts.join(' + ')||'0')+
  '\nOpen invoices: '+picked.length;
}
function approveMixedCustomers(picked){
 const customers=[...new Set(picked.map(r=>String(r.customer||'').trim()).filter(Boolean))];
 if(customers.length<=1)return true;
 return window.confirm('This includes invoices from '+customers.length+' DIFFERENT CUSTOMERS.\n\nOnly share with an authorized recipient.\n\nContinue?');
}
function isPhoto(file){
 return /^image\/(png|jpeg|jpg|webp|gif|bmp)$/i.test(file.type||'')||
  /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name||'');
}
function albumSteps(pkg){
 // Preserve the exact summary as photo 1. Follow with invoice photographs
 // in original invoice order; never combine or modify the original image bytes.
 const photos=pkg.files.filter(isPhoto);
 const documents=pkg.files.filter(file=>!isPhoto(file));
 const steps=[];
 for(let i=0;i<photos.length;i+=ALBUM_SIZE){
  const n=Math.floor(i/ALBUM_SIZE)+1;
  const group=photos.slice(i,i+ALBUM_SIZE);
  steps.push({
   kind:'photos',files:group,
   label:'Share Photo Album '+n,
   detail:group.length+' photo'+(group.length===1?'':'s')+
    (i===0?' · Summary picture first':' · Real invoice photos')
  });
 }
 for(let i=0;i<documents.length;i+=ALBUM_SIZE){
  const group=documents.slice(i,i+ALBUM_SIZE);
  steps.push({
   kind:'documents',files:group,
   label:'Share Original File'+(group.length===1?'':'s')+' '+(Math.floor(i/ALBUM_SIZE)+1),
   detail:group.length+' original document'+(group.length===1?'':'s')+
    ' · Stored as a document, not a photo'
  });
 }
 return steps;
}
function canShareFiles(files){
 try{
  return typeof navigator.share==='function'&&typeof navigator.canShare==='function'&&
   navigator.canShare({files});
 }catch(error){
  console.warn('Native photo share capability:',error);
  return false;
 }
}
function hidePhotoPanel(){
 const panel=$('bbArPhotoAlbums');
 if(panel){panel.hidden=true;panel.replaceChildren();}
}
function createPhotoPlan(pkg){
 sharePlan={
  signature:pkg.signature,
  steps:albumSteps(pkg),
  handed:new Set()
 };
 return sharePlan;
}
function showPhotoPanel(){
 const panel=$('bbArPhotoAlbums'),plan=sharePlan;
 if(!panel||!plan)return;
 panel.replaceChildren();
 panel.hidden=false;
 const heading=document.createElement('div');
 heading.className='bb-ar-album-title';
 heading.textContent='📸 Share Customer Summary + Real Invoice Photos';
 panel.appendChild(heading);
 const message=document.createElement('div');
 message.className='bb-ar-album-help';
 const photoCount=plan.steps.filter(s=>s.kind==='photos').length;
 message.textContent=plan.steps.length>1
  ?photoCount+' photo album'+(photoCount===1?'':'s')+'. Tap each Share Album button in order, then choose Telegram and the same customer chat each time.'
  :'Choose Telegram from the device share sheet. The summary photo goes first.';
 panel.appendChild(message);
 const pkg=packageData;
 if(pkg?.missing?.length){
  const missing=document.createElement('div');
  missing.className='bb-ar-album-warning';
  missing.textContent='⚠ Original invoice not uploaded: '+pkg.missing.join(', ')+'. Only available originals can be shared.';
  panel.appendChild(missing);
 }
 const unsupported=[];
 plan.steps.forEach((step,index)=>{
  const row=document.createElement('div');
  row.className='bb-ar-album-row';
  const labels=document.createElement('div');
  labels.className='bb-ar-album-labels';
  const main=document.createElement('strong');
  main.textContent=step.kind==='photos'?'Photo Album '+(plan.steps.slice(0,index).filter(s=>s.kind==='photos').length+1):'Original Documents';
  const sub=document.createElement('small');
  sub.textContent=step.detail;
  labels.append(main,sub);
  const btn=document.createElement('button');
  btn.type='button';
  btn.className='btn summary-telegram-btn bb-ar-album-share-button';
  btn.textContent=plan.handed.has(index)?'↻ Share Again':step.label;
  btn.disabled=!canShareFiles(step.files);
  if(btn.disabled)unsupported.push(step.label);
  btn.addEventListener('click',()=>{void sharePhotoStep(index)});
  row.append(labels,btn);
  panel.append(row);
 });
 if(unsupported.length){
  const note=document.createElement('div');
  note.className='bb-ar-album-warning';
  note.textContent='This browser cannot share these photo/file groups directly. Open BIG BROTHER A/R on an Android tablet or phone with a compatible browser and Telegram installed. Nothing has been downloaded or sent. Download Package remains optional.';
  panel.append(note);
 }
 const close=document.createElement('button');
 close.type='button';
 close.className='bb-ar-album-close';
 close.textContent='Close photo sharing';
 close.addEventListener('click',hidePhotoPanel);
 panel.append(close);
}
async function sharePhotoStep(index){
 // A fresh user tap is mandatory for EACH album; no automatic next share.
 // navigator.share must be called before the first await in this handler.
 const pkg=valid(),plan=sharePlan;
 if(!pkg||!plan||plan.signature!==pkg.signature){
  indicator('The invoice summary changed. Reopen it before sharing.',true);
  hidePhotoPanel();return;
 }
 const step=plan.steps[index];
 if(!step)return;
 if(!canShareFiles(step.files)){
  indicator('Photo album sharing is not supported in this browser. Try the Android/tablet browser. No PDF or ZIP was downloaded.',true);
  showPhotoPanel();return;
 }
 const caption=shareCaption(pkg,chosen());
 const suffix=plan.steps.length>1
  ?'\nPart '+(index+1)+' of '+plan.steps.length:'';
 let request;
 try{
  request=navigator.share({
   files:step.files,
   title:'BIG BROTHER Customer Invoice Summary',
   text:caption+suffix
  });
 }catch(error){
  indicator('Cannot open the file share sheet: '+(error?.message||'Please try again.'),true);
  return;
 }
 indicator('Choose Telegram and confirm the recipient for '+step.label+'.');
 try{
  await request;
  // Web Share confirms a native handoff, NOT a verified Telegram delivery.
  plan.handed.add(index);
  indicator(step.label+' handed to your device share sheet. Confirm Telegram received the photos before sharing the next album.');
 }catch(error){
  if(error?.name==='AbortError')indicator(step.label+' canceled. Nothing was automatically sent. Tap to try again.');
  else indicator('Could not share '+step.label+'. '+(error?.message||'Try a compatible phone/tablet browser.'),true);
 }finally{
  if(sharePlan===plan&&visible())showPhotoPanel();
 }
}
async function shareDirectFiles(pkg,picked){
 // Legacy one-tap behavior for 1–10 files: do not open Album 1 UI.
 // Invoke navigator.share synchronously from the green button's user tap,
 // before any await, or Android may reject the gesture.
 const files=pkg.files,btn=$('bbShareSummaryOriginals');
 hidePhotoPanel();
 sharePlan=null;
 if(!canShareFiles(files)){
  indicator('This browser cannot share these files directly. Try your Android tablet or phone with Telegram installed. No PDF or ZIP was downloaded.',true);
  return;
 }
 btn.disabled=true;
 let request;
 try{
  request=navigator.share({
   files,
   title:'BIG BROTHER Customer Invoice Summary',
   text:shareCaption(pkg,picked)
  });
 }catch(error){
  btn.disabled=false;
  indicator('Could not open the device share sheet: '+(error?.message||'Try again.'),true);
  return;
 }
 indicator('Choose Telegram and the customer chat in the normal device share sheet.');
 try{
  await request;
  indicator('Summary picture and '+(files.length-1)+' original invoice file(s) handed to the device share sheet. Confirm Telegram received them.');
 }catch(error){
  if(error?.name==='AbortError')indicator('Sharing canceled. Nothing was automatically sent.');
  else indicator('Could not share the pictures. '+(error?.message||'Please try again.'),true);
 }finally{btn.disabled=false}
}
function shareBatch(){
 const pkg=valid();if(!pkg)return;
 const picked=chosen();
 if(!approveMixedCustomers(picked)){indicator('Sharing canceled.');return}
 // The familiar direct sharing flow for up to 10 pictures/files.
 // Album controls are exclusively for packages larger than 10.
 if(pkg.files.length<=ALBUM_SIZE){
  void shareDirectFiles(pkg,picked);
  return;
 }
 const plan=createPhotoPlan(pkg);
 if(!plan.steps.length){indicator('No original photos available to share.',true);return}
 showPhotoPanel();
 indicator(plan.steps.length+' share group(s) prepared. Tap Share Photo Album 1, select Telegram, then continue in order. No PDF will be created.');
}
function init(){
 const actions=document.querySelector('#summaryOverlay .summary-actions');
 if(!actions){setTimeout(init,150);return}
 if($('bbShareSummaryOriginals'))return;
 const share=document.createElement('button');share.type='button';share.id='bbShareSummaryOriginals';
 share.className='btn summary-telegram-btn';share.textContent='📎 Share Summary + Real Invoices';share.disabled=true;
 const save=document.createElement('button');save.type='button';save.id='bbDownloadSummaryOriginals';
 save.className='btn summary-save-device-btn';save.textContent='⬇ Download Package';save.disabled=true;
 const status=document.createElement('div');status.id='bbBatchOriginalStatus';status.setAttribute('role','status');
 status.style.cssText='font:12px Arial;line-height:1.4;color:#41617f;text-align:right;padding:4px 2px 8px;overflow-wrap:anywhere';
 const printStyle=document.createElement('style');printStyle.textContent='@media print{#bbBatchOriginalStatus{display:none!important}}';document.head.append(printStyle);
 actions.style.flexWrap='wrap';
 actions.append(share,save);
 actions.after(status);
 const photoPanel=document.createElement('div');
 photoPanel.id='bbArPhotoAlbums';
 photoPanel.className='bb-ar-photo-panel';
 photoPanel.hidden=true;
 status.after(photoPanel);
 const styles=document.createElement('style');
 styles.id='bbArPhotoAlbumStyles';
 styles.textContent=[
  '#bbArPhotoAlbums[hidden]{display:none!important}',
  '.bb-ar-photo-panel{box-sizing:border-box;padding:12px;margin:8px 0 12px;border:1px solid #bad4ed;border-radius:12px;background:#f4f9ff;font:12px Arial,sans-serif;color:#173d6a}',
  '.bb-ar-album-title{font-size:14px;font-weight:900;margin-bottom:7px}',
  '.bb-ar-album-help{line-height:1.45;margin-bottom:10px;color:#395a7c}',
  '.bb-ar-album-row{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#fff;border:1px solid #dce7f3;border-radius:9px;padding:10px;margin:7px 0}',
  '.bb-ar-album-labels{display:flex;flex-direction:column;gap:3px;min-width:0;overflow-wrap:anywhere}',
  '.bb-ar-album-labels strong{font-size:12px}',
  '.bb-ar-album-labels small{font-size:11px;line-height:1.35;color:#536b84}',
  '.bb-ar-album-share-button{white-space:normal;flex-shrink:0;min-height:36px;font-size:11px}',
  '.bb-ar-album-share-button:disabled{opacity:.5;cursor:not-allowed}',
  '.bb-ar-album-warning{background:#fff9e9;border:1px solid #f1dfa8;border-radius:8px;padding:9px;color:#7d550b;margin:9px 0;line-height:1.4;overflow-wrap:anywhere}',
  '.bb-ar-album-close{margin-top:8px;background:#fff;border:1px solid #ccd8e7;border-radius:8px;color:#4f6075;padding:8px 13px;cursor:pointer}',
  '@media(max-width:650px){.bb-ar-album-row{flex-direction:column;align-items:stretch}.bb-ar-album-share-button{width:100%;min-height:40px}}',
  '@media print{#bbArPhotoAlbums{display:none!important}}'
 ].join('\n');
 document.head.appendChild(styles);
 share.addEventListener('click',shareBatch);save.addEventListener('click',()=>void downloadBatch());
 const overlay=$('summaryOverlay');
 let wasOpen=visible();
 const observer=new MutationObserver(()=>{
  const open=visible();
  if(open&&!wasOpen){reset();void build()}
  if(!open&&wasOpen)reset();
  wasOpen=open;
 });
 observer.observe(overlay,{attributes:true,attributeFilter:['class']});
 if(visible()){reset();void build()}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();