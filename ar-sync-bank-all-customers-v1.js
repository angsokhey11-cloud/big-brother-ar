/* BIG BROTHER A/R — Manual Sync Bank (desktop, mobile/PWA and APK).
   Read-only bulk download. Uses Invoice Generator's existing shared per-user cache.
   Never creates a payment, bank registration, or receivable clearance. */
(function(){
'use strict';
if(window.BBARBankSyncV1)return;
const CACHE_PREFIX='bb-bank-bulk-v1:',sessionKey='BB_SUPABASE_DEV_SESSION_V1';
let busy=false;
let lastOutcome='';
const $=id=>document.getElementById(id);
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function userId(){
 try{
  const session=JSON.parse(localStorage.getItem(sessionKey)||'null');
  const tokenPart=String(session?.access_token||'').split('.')[1]||'';
  if(!tokenPart)return '';
  const sub=JSON.parse(atob(tokenPart.replace(/-/g,'+').replace(/_/g,'/'))).sub;
  return typeof sub==='string'?sub:'';
 }catch(_){return ''}
}
function key(){const sub=userId();return sub?CACHE_PREFIX+sub:''}
function timeText(ms){
 const d=new Date(Number(ms)||0);
 if(!ms||!Number.isFinite(d.getTime()))return '';
 return String(d.getDate()).padStart(2,'0')+'-'+months[d.getMonth()]+'-'+d.getFullYear()+' '+
  String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
}
function current(){
 try{const k=key();return k?JSON.parse(localStorage.getItem(k)||'null'):null}catch(_){return null}
}
function status(message,error=false){
 const el=$('bbARBankSyncStatus');
 if(!el)return;
 el.textContent=message;
 el.style.color=error?'#b42318':'#667a90';
 el.title=message;
 const b=$('bbARSyncBankBtn');
 if(b){b.disabled=busy;b.setAttribute('aria-busy',String(busy))}
}
function showSaved(){
 const snapshot=current();
 const count=Array.isArray(snapshot?.rows)?snapshot.rows.length:0;
 const stamp=timeText(snapshot?.syncedAt);
 status(stamp?'Last sync: '+stamp+' · '+count+' balance'+(count===1?'':'s'):'Bank not synced');
}
async function run(){
 if(busy)return;
 const startUser=userId();
 if(!startUser)return status('Please sign in before syncing bank balances.',true);
 if(navigator.onLine===false)return status('Offline · cached bank balances kept',true);
 if(typeof window.BBARAdapter?.rpc!=='function')return status('A/R bank service unavailable. Refresh this page.',true);
 busy=true;lastOutcome='';
 const button=$('bbARSyncBankBtn');
 if(button)button.textContent='Syncing…';
 status('Downloading verified bank balances…');
 try{
  const rows=await window.BBARAdapter.rpc('bb_invoice_bank_bulk_sync',{});
  if(!Array.isArray(rows))throw new Error('Invalid bulk bank balance response');
  if(userId()!==startUser)throw new Error('Signed-in account changed. Please retry.');
  // Validate everything before overwriting the old device cache.
  // Empty [] is valid: payments used on another device must disappear.
  if(rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)
      ||typeof row.customer_id!=='string'
      ||typeof row.transaction_id!=='string'
      ||!['USD','KHR'].includes(String(row.currency||'').toUpperCase())
      ||!Number.isFinite(Number(row.remaining_amount))||Number(row.remaining_amount)<=0))
     throw new Error('Unexpected bank balance data; previous cache was preserved');
  const syncedAt=Date.now();
  localStorage.setItem(CACHE_PREFIX+startUser,JSON.stringify({rows,syncedAt}));
  lastOutcome='success';
  status('Synced '+timeText(syncedAt)+' · '+rows.length+' balance'+(rows.length===1?'':'s'));
  document.dispatchEvent(new CustomEvent('bb:bank-cache-updated',{
   detail:{source:'ar-sync-bank',count:rows.length,syncedAt}
  }));
  // Refresh visible A/R wallet choices without re-posting any payment.
  for(const [overlayId,selectId] of [['paymentOverlay','payMethod'],['batchOverlay','batchMethod']]){
   const overlay=$(overlayId),select=$(selectId);
   if(overlay&&!overlay.classList.contains('hidden')&&select?.value==='Bank')
     select.dispatchEvent(new Event('change',{bubbles:true}));
  }
 }catch(error){
  lastOutcome='error';
  // Network/auth failures NEVER erase a previously valid cache.
  const prev=current()?.syncedAt;
  status('Sync failed: '+String(error?.message||error)+
    (prev?' · previous cache kept ('+timeText(prev)+')':''),true);
 }finally{
  busy=false;
  if(button){
   const isCompactMobile=!!button.closest?.('.bb-mobile-actionbar');
   button.textContent=isCompactMobile
      ?lastOutcome==='success'?'✓ Bank Synced':lastOutcome==='error'?'⚠ Retry Bank':'⟳ Sync Bank'
      :'⟳ Sync Bank';
   button.title=$('bbARBankSyncStatus')?.textContent||button.title;
   button.disabled=false;button.setAttribute('aria-busy','false')
  }
 }
}
function install(){
 if($('bbARBankSyncControls'))return;
 const filters=document.querySelector('.filters');
 if(!filters)return;
 const refresh=[...filters.querySelectorAll('button')].find(el=>
  String(el.getAttribute('onclick')||'').includes('loadAR(true)'));
 if(!refresh)return;
 const style=document.createElement('style');
 style.id='bb-ar-bank-sync-style-v1';
 style.textContent=[
 '#bbARBankSyncControls{min-width:0;display:flex;flex-direction:column;align-items:stretch;justify-content:center;gap:3px}',
 '#bbARSyncBankBtn{min-width:0;white-space:nowrap;display:inline-flex;justify-content:center;align-items:center;gap:4px;cursor:pointer;border:1px solid #bad2ed;background:#eaf4ff;color:#1757a4}',
 '#bbARSyncBankBtn:hover:not(:disabled){background:#daebff}',
 '#bbARSyncBankBtn:disabled{cursor:progress;opacity:.7}',
 '#bbARBankSyncStatus{font-size:9px;font-weight:600;line-height:1.25;color:#667a90;white-space:normal;overflow-wrap:anywhere;text-align:center}',
 '@media(min-width:1251px){.filters:has(#bbARBankSyncControls){grid-template-columns:minmax(95px,1fr) minmax(145px,1.2fr) repeat(3,minmax(95px,1fr)) auto auto auto auto}}',
 '@media(min-width:901px) and (max-width:1250px){.filters:has(#bbARBankSyncControls){grid-template-columns:repeat(4,minmax(0,1fr))}}',
 '@media(max-width:900px){.filters:has(#bbARBankSyncControls){grid-template-columns:repeat(2,minmax(0,1fr))}}',
 '@media(max-width:560px){.filters:has(#bbARBankSyncControls){grid-template-columns:1fr}}',
 '.bb-mobile-actionbar #bbARBankSyncControls{min-width:0!important;align-self:stretch!important;width:100%!important}',
 '.bb-mobile-actionbar #bbARSyncBankBtn{width:100%!important;height:100%!important;min-height:38px!important;padding:5px 3px!important;font-size:8px!important;white-space:normal!important;line-height:1.12!important}',
 '.bb-mobile-actionbar #bbARBankSyncStatus{display:none!important}'
 ].join('\n');
 document.head.appendChild(style);
 const wrapper=document.createElement('div');wrapper.id='bbARBankSyncControls';
 const button=document.createElement('button');button.id='bbARSyncBankBtn';
 button.type='button';button.className='btn secondary';button.textContent='⟳ Sync Bank';
 button.title='Download all authorized customer bank balances (shared with Invoice Generator)';
 button.setAttribute('aria-label','Sync Bank · refresh customer bank balances');
 button.addEventListener('click',()=>{void run()});
 const stamp=document.createElement('div');stamp.id='bbARBankSyncStatus';
 stamp.setAttribute('role','status');stamp.setAttribute('aria-live','polite');
 wrapper.append(button,stamp);
 refresh.insertAdjacentElement('beforebegin',wrapper);
 showSaved();
 window.addEventListener('storage',e=>{if(e.key===key())showSaved()});
}
window.BBARBankSyncV1={sync:run,showSaved};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
else install();
})();