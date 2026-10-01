/* BIG BROTHER — Original invoice viewer for A/R desktop and mobile */
(function(){
'use strict';
const BASE='https://sjfhlaclgmkwwofzstok.supabase.co',KEY='sb_publishable_w762jR65CWwlO30fKQsYOw_6L9grx8S',BUCKET='bb-real-invoices';
let available=new Set(),currentSignature='',requestId=0,overlay=null;
function inject(){
 if(document.getElementById('bbAROriginalStyles'))return;
 const s=document.createElement('style');s.id='bbAROriginalStyles';s.textContent=[
 '#arBody .bb-original-btn{background:#e4f2ff!important;color:#14588b!important;border:1px solid #b1d0eb!important;padding:7px 9px!important;border-radius:8px!important;font-weight:800!important;font-size:11px!important;cursor:pointer}',
 '#arBody td:last-child{white-space:normal!important}',
 '#bbOriginalOverlay{position:fixed!important;inset:0!important;z-index:99999!important;background:#092e4da8;display:flex;align-items:center;justify-content:center;padding:10px}',
 '#bbOriginalOverlay[hidden]{display:none!important}',
 '.bb-original-panel{width:min(900px,100%);max-height:95dvh;display:flex;flex-direction:column;overflow:hidden;background:white;border-radius:14px}',
 '.bb-original-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:12px;border-bottom:1px solid #dce6f3}',
 '.bb-original-head strong{font-size:14px;color:#18476f}.bb-original-head button{background:#e4f0fc;color:#174f81;border:0;border-radius:8px;font-weight:bold;padding:9px;cursor:pointer}',
 '.bb-original-body{min-height:0;overflow:auto;display:flex;justify-content:center;align-items:start;padding:8px;background:#edf3f9}',
 '.bb-original-body img{display:block;max-width:100%;height:auto;object-fit:contain}.bb-original-body iframe{display:block;width:100%;height:min(75dvh,850px);border:0;background:white}',
 '@media(min-width:701px){.bb-original-panel{height:min(860px,calc(100dvh - 24px));max-height:calc(100dvh - 24px)}.bb-original-head{flex:0 0 auto}.bb-original-body{flex:1 1 0;min-height:0;overflow:auto;align-items:center!important;justify-content:center!important}.bb-original-body img{width:auto!important;height:auto!important;max-width:100%!important;max-height:100%!important;object-fit:contain!important}.bb-original-body iframe{height:100%;min-height:0}}',
 '@media(max-width:700px){#arBody > tr.bb-has-original{grid-template-areas:"check inv customer status" ". invdate duedate action" ". location location action" ". total paid outstanding" ". original original original"!important}#arBody > tr > td.bb-original-mobile-row{grid-area:original!important;display:flex!important;justify-content:flex-end!important;align-items:center!important;padding:5px 0 0!important;min-width:0!important;border-top:1px solid #e8edf5!important;margin-top:5px!important}#arBody .bb-original-btn{width:auto!important;max-width:100%!important;font-size:10px!important;white-space:nowrap!important;padding:7px 10px!important}#arBody > tr > td:nth-child(11){flex-wrap:nowrap!important;justify-content:flex-end!important} .bb-original-panel{max-height:93dvh}.bb-original-head{padding:8px}.bb-original-body{padding:4px}}'
 ].join('\n');
 document.head.appendChild(s);
}
function viewer(){
 if(overlay)return overlay;
 inject();overlay=document.createElement('div');overlay.id='bbOriginalOverlay';overlay.hidden=true;
 overlay.innerHTML='<section class="bb-original-panel" role="dialog" aria-modal="true" aria-label="Original invoice"><div class="bb-original-head"><strong id="bbOriginalLabel">Original invoice</strong><div><button type="button" id="bbOriginalTab">Open separately ↗</button> <button type="button" id="bbOriginalClose">Close ✕</button></div></div><div class="bb-original-body" id="bbOriginalBody"></div></section>';
 document.body.appendChild(overlay);
 const close=()=>{overlay.hidden=true;overlay.querySelector('#bbOriginalBody').replaceChildren();};
 overlay.querySelector('#bbOriginalClose').onclick=close;
 overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!overlay.hidden)close()});
 return overlay;
}
function decorate(){
 if(typeof visibleRows==='undefined'||!Array.isArray(visibleRows))return;
 const trs=document.querySelectorAll('#arBody > tr');
 visibleRows.forEach((r,i)=>{
  const tr=trs[i];if(!tr||!r?.invoiceId)return;
  tr.querySelectorAll('.bb-original-btn').forEach(b=>b.remove());
  tr.querySelectorAll('.bb-original-mobile-row').forEach(td=>td.remove());
  tr.classList.remove('bb-has-original');
  if(!available.has(String(r.invoiceId)))return;
  const button=document.createElement('button');button.type='button';button.className='bb-original-btn';
  button.textContent='📎 View Real Invoice';button.title='View the uploaded original paper invoice';
  button.onclick=()=>open(String(r.invoiceId),String(r.invoiceNo||''),String(r.customer||''));
  const mobile=window.matchMedia('(max-width:700px)').matches;
  if(mobile){
    const td=document.createElement('td');
    td.className='bb-original-mobile-row';
    td.appendChild(button);
    tr.classList.add('bb-has-original');
    tr.appendChild(td);
  }else{
    const action=tr.children[10];
    if(action)action.appendChild(button);
  }
 });
}
async function refresh(){
 if(typeof rows==='undefined'||!Array.isArray(rows)||!window.BBARAdapter?.rpc)return;
 const ids=[...new Set(rows.map(r=>String(r?.invoiceId||'').trim()).filter(Boolean))];
 const signature=ids.slice().sort().join('|');
 if(signature===currentSignature){decorate();return}
 if(!ids.length){available.clear();currentSignature='';decorate();return}
 const seq=++requestId;
 try{
  const response=await window.BBARAdapter.rpc('bb_ar_original_available',{p_invoice_ids:ids});
  if(seq!==requestId)return;
  available=new Set(Array.isArray(response)?response.map(String):[]);
  currentSignature=signature;decorate();
 }catch(e){if(seq!==requestId)return;currentSignature='';console.warn('Original invoice status:',e)}
}
async function open(id,no,customer){
 const box=viewer(),body=box.querySelector('#bbOriginalBody');
 box.querySelector('#bbOriginalLabel').textContent='Original: '+no+' · '+customer;
 body.textContent='Loading original securely…';box.hidden=false;
 try{
  await window.BBARAdapter.ensureSession();
  const doc=await window.BBARAdapter.rpc('bb_real_invoice_existing',{p_id:id});
  if(!doc?.path)throw Error('No accessible uploaded original for this invoice.');
  const session=JSON.parse(localStorage.getItem('BB_SUPABASE_DEV_SESSION_V1')||'null');
  if(!session?.access_token)throw Error('Please sign in again.');
  const path=doc.path.split('/').map(encodeURIComponent).join('/');
  const res=await fetch(BASE+'/storage/v1/object/sign/'+BUCKET+'/'+path,{
   method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},
   body:JSON.stringify({expiresIn:120}),cache:'no-store'
  });
  const value=await res.json();if(!res.ok||!value.signedURL)throw Error(value.message||value.error||'Unable to open original');
  if(box.hidden)return;
  const signed=value.signedURL.startsWith('http')?value.signedURL:BASE+'/storage/v1'+value.signedURL;
  body.replaceChildren();
  if(/\.pdf$/i.test(doc.path)){
   const frame=document.createElement('iframe');frame.src=signed;frame.title='Original invoice PDF';body.append(frame);
  }else{
   const img=document.createElement('img');img.src=signed;img.alt='Original paper invoice';body.append(img);
  }
  box.querySelector('#bbOriginalTab').onclick=()=>window.open(signed,'_blank','noopener,noreferrer');
 }catch(e){body.textContent=e.message||'Could not open original invoice.'}
}
function install(){
 inject();
 if(typeof renderRows!=='function'||typeof loadAR!=='function'){setTimeout(install,150);return}
 const baseRender=renderRows;renderRows=function(){const result=baseRender.apply(this,arguments);decorate();return result};
 const baseLoad=loadAR;loadAR=async function(){const result=await baseLoad.apply(this,arguments);await refresh();return result};
 const tbody=document.getElementById('arBody');
 if(tbody){
  const observer=new MutationObserver(()=>{void refresh()});
  observer.observe(tbody,{childList:true});
 }
 setTimeout(refresh,1300);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){currentSignature='';void refresh()}});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
window.BBARRealInvoice={refresh};
})();