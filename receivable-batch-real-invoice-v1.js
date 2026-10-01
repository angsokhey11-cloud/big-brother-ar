/* BIG BROTHER A/R — batch original invoices for one customer summary.
   Files are fetched through authenticated Supabase Storage, kept in memory,
   shared with the native file share sheet or exported as a private ZIP. */
(function(){
'use strict';
const BASE='https://sjfhlaclgmkwwofzstok.supabase.co';
const KEY='sb_publishable_w762jR65CWwlO30fKQsYOw_6L9grx8S';
const BUCKET='bb-real-invoices';
const MAX_FILES=35, MAX_BYTES=65*1024*1024;
let packageData=null,buildSeq=0,previousSignature='',isBuilding=false;
const $=id=>document.getElementById(id);
function safe(v){return String(v||'').trim().replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,65)||'Invoice'}
function chosen(){return typeof selectedSummaryRows==='function'?selectedSummaryRows():[]}
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
function reset(){buildSeq++;packageData=null;previousSignature='';isBuilding=false;buttonsBusy(true);indicator('')}
async function storageFile(row){
 await window.BBARAdapter.ensureSession();
 const ss=JSON.parse(localStorage.getItem('BB_SUPABASE_DEV_SESSION_V1')||'null');
 if(!ss?.access_token)throw Error('Your session expired. Please sign in again.');
 const path=row.path.split('/').map(encodeURIComponent).join('/');
 const res=await fetch(BASE+'/storage/v1/object/authenticated/'+BUCKET+'/'+path,{
  headers:{apikey:KEY,Authorization:'Bearer '+ss.access_token},cache:'no-store'
 });
 if(!res.ok)throw Error('Could not load original '+row.invoiceNo+'. Please refresh and retry.');
 const blob=await res.blob();
 const extension=String(row.path).split('.').pop().toLowerCase();
 const ext=['jpg','jpeg','png','webp','pdf'].includes(extension)?extension:'jpg';
 return new File([blob],'Original_'+safe(row.invoiceNo)+'_'+safe(row.invoiceId)+'.'+ext,
  {type:row.mimeType||blob.type||'application/octet-stream'});
}
async function build(){
 const chosenRows=chosen();
 const customerKeys=[...new Set(chosenRows.map(r=>String(r.customer||'').trim().toLowerCase()))];
 if(!chosenRows.length||customerKeys.length!==1){indicator('Select invoices from one customer to create this package.',true);return}
 if(chosenRows.length>MAX_FILES){
  indicator('Select up to '+MAX_FILES+' invoices per package, then send another batch.',true);return
 }
 const seq=++buildSeq,signature=selectionKey(chosenRows);
 isBuilding=true;buttonsBusy(true);indicator('Preparing customer summary and checking original uploads…');
 try{
  if(typeof createSummaryImageBlob!=='function')throw Error('Customer summary image is unavailable.');
  const ids=chosenRows.map(r=>String(r.invoiceId||'')).filter(Boolean);
  if(ids.length!==chosenRows.length)throw Error('Some selected invoices have no internal Invoice ID.');
  const manifest=await window.BBARAdapter.rpc('bb_ar_original_manifest',{p_invoice_ids:ids});
  if(!Array.isArray(manifest))throw Error('Could not read the permitted invoice originals.');
  const permitted=new Map(manifest.map(row=>[String(row.invoiceId),row]));
  const missing=chosenRows.filter(r=>!permitted.has(String(r.invoiceId))).map(r=>String(r.invoiceNo));
  const customer=String(chosenRows[0].customer||'Customer');
  const filename='BIG_BROTHER_'+safe(customer)+'_Summary_'+new Date().toISOString().slice(0,10);
  const summaryBlob=await createSummaryImageBlob();
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
   'Customer: '+customer,
   'Selected invoices: '+chosenRows.map(r=>r.invoiceNo).join(', '),
   'Originals attached: '+(files.length-1),
   'Originals not uploaded or not accessible: '+(missing.length?missing.join(', '):'None'),
   'Each original is matched using its unique internal invoice ID.'
  ].join('\n');
  packageData={files,filename,manifestText,missing,customer,signature,cachedZip:null};
  previousSignature=signature;
  if(files.length>1 && navigator.share && navigator.canShare && !navigator.canShare({files})){
   indicator('Preparing a single ZIP for this phone’s share sheet…');
   packageData.cachedZip=await packageZip(packageData);
   if(seq!==buildSeq||!visible())return;
  }
  buttonsBusy(files.length<=1);
  indicator((files.length-1)+' originals ready'+(missing.length?' · Missing: '+missing.join(', '):' · All selected originals included')+'. '+(files.length<=1?'Upload an original first, or use the existing Summary sharing button.':'Summary image included.'));
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
 const pkg=packageData;
 if(!pkg||!visible()||pkg.signature!==selectionKey(chosen())){indicator('Please wait for the current customer summary package to finish preparing.',true);return null}
 return pkg;
}
async function downloadBatch(){
 const pkg=valid();if(!pkg)return;
 const btn=$('bbDownloadSummaryOriginals');btn.disabled=true;
 indicator('Creating ZIP package…');
 try{
  const file=pkg.cachedZip||await packageZip(pkg);download(file);
  indicator('Summary and '+(pkg.files.length-1)+' originals downloaded in one ZIP'+(pkg.missing.length?' · Missing: '+pkg.missing.join(', '):'')+'.');
 }catch(e){indicator(e.message||'ZIP download failed.',true)}
 finally{btn.disabled=false}
}
async function shareBatch(){
 const pkg=valid();if(!pkg)return;
 const btn=$('bbShareSummaryOriginals');
 btn.disabled=true;
 const files=pkg.files;
 if(navigator.share&&navigator.canShare){
  try{
   if(navigator.canShare({files})){
    // Native share is called before any await to preserve the user's direct tap.
    await navigator.share({files,title:'BIG BROTHER Customer Invoice Summary',text:'Customer: '+pkg.customer});
    indicator('Use Telegram in the share sheet to send the summary and '+(files.length-1)+' originals.');
    btn.disabled=false;return;
   }
  }catch(e){
   if(e.name==='AbortError'){indicator('Sharing canceled.');btn.disabled=false;return}
   console.warn('Multi-file share unsupported:',e);
  }
 }
 // When multi-file sharing is unavailable, package a single ZIP for sharing.
 indicator('Preparing one ZIP file to share…');
 // Open Telegram from the original user tap on desktop: popup blockers may
 // reject a tab opened only after the package has finished generating.
 const shouldOpenTelegram=!navigator.share;
 const telegramTab=shouldOpenTelegram?window.open('https://web.telegram.org/','_blank','noopener,noreferrer'):null;
 try{
  const bundle=pkg.cachedZip||await packageZip(pkg);
  if(navigator.share&&navigator.canShare&&navigator.canShare({files:[bundle]})){
   try{
    await navigator.share({files:[bundle],title:'BIG BROTHER Customer Invoice Package',text:'Customer: '+pkg.customer});
    indicator('Choose Telegram to send the package ZIP.');return;
   }catch(e){if(e.name==='AbortError'){indicator('Sharing canceled.');return}}
  }
  download(bundle);
  indicator('Downloaded one ZIP containing the summary and '+(files.length-1)+' originals. Open Telegram and attach this ZIP'+(pkg.missing.length?' · Missing originals: '+pkg.missing.join(', '):'')+'.');
  if(!telegramTab)indicator('ZIP downloaded. Open Telegram and attach the package manually.');
 }catch(e){indicator(e.message||'Unable to prepare files for sharing.',true)}
 finally{btn.disabled=false}
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
 share.addEventListener('click',()=>void shareBatch());save.addEventListener('click',()=>void downloadBatch());
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