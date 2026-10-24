/* BIG BROTHER A/R — batch original invoices for one customer summary.
   Files are fetched through authenticated Supabase Storage, kept in memory,
   shared as native files or one summary-first PDF; ZIP is download-only. */
(function(){
'use strict';
const BASE='https://sjfhlaclgmkwwofzstok.supabase.co';
const KEY='sb_publishable_w762jR65CWwlO30fKQsYOw_6L9grx8S';
const BUCKET='bb-real-invoices';
const MAX_FILES=35, MAX_BYTES=65*1024*1024;
let packageData=null,buildSeq=0,previousSignature='',isBuilding=false;
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
function reset(){buildSeq++;packageData=null;previousSignature='';isBuilding=false;buttonsBusy(true);indicator('')}
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
 const ext=['jpg','jpeg','png','webp','pdf'].includes(extension)?extension:'jpg';
 return new File([blob],'Original_'+safe(row.invoiceNo)+'_'+safe(row.invoiceId)+'.'+ext,
  {type:row.mimeType||blob.type||'application/octet-stream'});
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
  previousSignature=signature;
  buttonsBusy(files.length<=1);
  indicator((files.length-1)+' originals ready'+(missing.length?' · Missing: '+missing.join(', '):' · All selected originals included')+'. '+(files.length<=1?'Upload an original first, or use the existing Summary sharing button.':'Native album or summary-first PDF ready for Telegram (ZIP is download-only).'));
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
async function shareBatch(){
 const pkg=valid();if(!pkg)return;
 const picked=chosen();
 if(!approveMixedCustomers(picked)){indicator('Sharing canceled.');return}
 const btn=$('bbShareSummaryOriginals'),files=pkg.files;
 btn.disabled=true;
 const caption=shareCaption(pkg,picked);
 try{
  let canShareAlbum=false;
  try{
   canShareAlbum=typeof navigator.share==='function'&&
    typeof navigator.canShare==='function'&&navigator.canShare({files});
  }catch(error){console.warn('Multi-file share capability check:',error)}
  if(canShareAlbum){
   try{
    // Share the actual summary picture followed by original invoices.
    await navigator.share({files,title:'BIG BROTHER Customer Invoice Summary',text:caption});
    indicator('Summary and '+(files.length-1)+' originals handed to your share sheet. Select Telegram and verify the recipient.');
    return;
   }catch(error){
    if(error?.name==='AbortError'){indicator('Sharing canceled.');return}
    console.warn('Native album share unavailable; use PDF:',error);
   }
  }
  // Telegram Web cannot accept attachments directly from a different website.
  // One PDF contains the outstanding summary page plus all invoice evidence.
  // Only the separate Download Package button generates a ZIP.
  if(typeof window.BBARAuditPdfExport?.share!=='function'){
   throw Error('Customer PDF sharing is not ready. Refresh A/R and try again.');
  }
  indicator('Preparing a summary-first PDF for Telegram instead of a ZIP…');
  await window.BBARAuditPdfExport.share();
  indicator('PDF sharing prepared. Page 1 shows outstanding totals; invoice copies follow. Attach the PDF in Telegram if downloaded.');
 }catch(error){
  console.error('Summary + originals Telegram sharing:',error);
  indicator(error?.message||'Could not prepare Telegram sharing.',true);
 }finally{btn.disabled=false}
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