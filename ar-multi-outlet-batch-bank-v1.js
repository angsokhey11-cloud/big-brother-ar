/* BIG BROTHER A/R – ONE registered bank receipt across multiple customer outlets.
   Additive UI. Preserves the original single-customer, Cash, and direct request flows.
   The server checks all amounts, duplicate references, admin permission and per-outlet shares. */
(function(){
'use strict';
if(window.BBARMultiOutletBatchBankV1)return;
window.BBARMultiOutletBatchBankV1=true;
const esc=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const clean=s=>String(s??'').trim();
const money=(n,cur)=>String(cur)+' '+Number(n).toLocaleString('en-US',{minimumFractionDigits:cur==='KHR'?0:2,maximumFractionDigits:cur==='KHR'?0:2});
const rowsSelected=()=>typeof selectedPaymentRows==='function'?selectedPaymentRows():[];
let ticket=0;
let cached=new Map();
function modalOpen(){const modal=document.getElementById('batchOverlay');return modal&&!modal.classList.contains('hidden')}
function context(){
 const rows=rowsSelected();
 const customerIds=[...new Set(rows.map(r=>clean(r.customerId)).filter(Boolean))];
 const currency=clean(rows[0]?.currency||'USD').toUpperCase();
 const needed=new Map();
 for(const row of rows)needed.set(clean(row.customerId),Number((needed.get(clean(row.customerId))||0)+Number(row.outstanding||0)));
 return {rows,customerIds,currency,needed,total:[...needed.values()].reduce((a,b)=>a+b,0)};
}
function panel(){
 const parent=document.getElementById('batchBankFields');if(!parent)return null;
 let target=document.getElementById('bbWalletBatch');
 if(!target){target=document.createElement('div');target.id='bbWalletBatch';parent.append(target)}
 return target;
}
async function liveBalance(customerId,force=false){
 const old=cached.get(customerId);
 if(!force&&old&&Date.now()-old.when<12000)return old.rows;
 const items=await window.BBARAdapter.rpc('bb_customer_bank_balance_list_v2',{p_customer_id:customerId});
 if(!Array.isArray(items))throw Error('Invalid server bank balance for outlet '+customerId);
 cached.set(customerId,{when:Date.now(),rows:items});
 return items;
}
function bankLink(transaction,label){
 const a=document.createElement('a');
 a.href='https://angsokhey11-cloud.github.io/big-brother-admin-work/bank-history.html'+
   (transaction?'?transaction='+encodeURIComponent(transaction):'');
 a.target='_blank';a.rel='noopener noreferrer';a.textContent=label;
 a.style.cssText='display:inline-block;margin:6px 6px 4px 0;padding:8px 10px;border:1px solid #b9d1e9;border-radius:8px;background:#f0f7ff;color:#18518c;text-decoration:none;font-size:12px;font-weight:800';
 return a;
}
function note(target,text,warning=false){
 const el=document.createElement('div');
 el.textContent=text;
 el.style.cssText='font-size:12px;line-height:1.55;padding:8px;margin:7px 0;border-radius:8px;'+
 (warning?'background:#fff9e8;color:#8b5a16;border:1px solid #f2ddae':'background:#edf6ff;color:#395e87;border:1px solid #d0e3f6');
 target.append(el);return el;
}
function refreshControl(target){
 const b=document.createElement('button');
 b.type='button';b.textContent='↻ Refresh All Outlet Balances';
 b.style.cssText='margin:8px 0;padding:8px 12px;border-radius:8px;border:1px solid #c4d5e6;background:#eef6ff;color:#18518c;font-size:12px;font-weight:800;cursor:pointer';
 b.onclick=()=>{cached.clear();void render(true)};
 target.append(b);
}
async function render(force=false){
 const target=panel();if(!target)return;
 const contextAtStart=context(),ids=contextAtStart.customerIds;
 if(!modalOpen()||document.getElementById('batchMethod')?.value!=='Bank'||
    ids.length<2||(typeof VIEW!=='undefined'&&VIEW==='your'))return;
 const key=ids.join('|')+'|'+contextAtStart.rows.map(x=>x.invoiceId).join('|');
 const current=++ticket;
 target.replaceChildren();
 const heading=document.createElement('strong');
 heading.textContent='Shared Payer · '+ids.length+' Outlets · One Bank Receipt';target.append(heading);
 note(target,'A combined receipt can clear multiple outlets after the Admin approves each outlet’s bank share. The actual bank transaction is registered only once.');
 refreshControl(target);
 const loading=document.createElement('div');loading.textContent='Checking registered balances for '+ids.length+' customers…';
 loading.style.cssText='font-size:12px;color:#64758a;margin-top:6px';target.append(loading);
 let results;
 try{
  results=await Promise.all(ids.map(id=>liveBalance(id,force)));
 }catch(e){
  if(current!==ticket)return;
  loading.textContent='Could not load linked bank balances: '+(e?.message||String(e));
  loading.style.color='#a42e2e';return;
 }
 if(current!==ticket||!modalOpen()||document.getElementById('batchMethod')?.value!=='Bank')return;
 if(key!==context().customerIds.join('|')+'|'+context().rows.map(x=>x.invoiceId).join('|'))return;
 loading.remove();
 const rowsByTransaction=new Map();
 for(let i=0;i<ids.length;i++){
  for(const row of results[i]){
   if(String(row.currency||'').toUpperCase()!==contextAtStart.currency||
      String(row.invoice_currency||row.currency||'').toUpperCase()!==contextAtStart.currency||
      Number(row.remaining_amount||0)<=0)continue;
   const tx=clean(row.transaction_id).toUpperCase();if(!tx)continue;
   if(!rowsByTransaction.has(tx))rowsByTransaction.set(tx,new Map());
   rowsByTransaction.get(tx).set(ids[i],row);
  }
 }
 const shared=[...rowsByTransaction.entries()].filter(([tx,perCustomer])=>
    ids.every(id=>perCustomer.has(id)&&Number(perCustomer.get(id).remaining_amount)+0.00001>=Number(contextAtStart.needed.get(id)||0))
 );
 if(shared.length){
  note(target,'Approved, available bank receipts covering every selected outlet:');
  shared.sort((a,b)=>String(a[1].values().next().value?.received_date||'').localeCompare(String(b[1].values().next().value?.received_date||'')));
  for(const [tx,perCustomer] of shared){
   const line=document.createElement('div');line.style.cssText='margin:8px 0;padding:9px;border:1px solid #d8e5ef;border-radius:9px';
   const use=document.createElement('button');use.type='button';use.textContent='Use '+tx;
   use.style.cssText='margin-right:9px;background:#1769b5;color:white;border:0;border-radius:7px;padding:9px 12px;font-weight:800;cursor:pointer';
   use.onclick=()=>{
    document.getElementById('batchTransactionId').value=tx;
    const knownBank=[...perCustomer.values()].map(x=>clean(x.bank_name)).find(Boolean);
    if(knownBank)document.getElementById('batchBank').value=knownBank;
    note(line,'Selected registered receipt '+tx+'. Confirm the batch to clear all selected invoices. The server verifies each outlet share.');
   };line.append(use);
   const amountText=document.createElement('div');amountText.style.cssText='font-size:12px;color:#526d84;margin-top:6px';
   amountText.textContent=ids.map(id=>{
     const customer=contextAtStart.rows.find(x=>clean(x.customerId)===id);
     return (customer?.customer||id)+': '+money(perCustomer.get(id).remaining_amount,contextAtStart.currency)+
       ' available; '+money(contextAtStart.needed.get(id),contextAtStart.currency)+' selected';
   }).join(' · ');
   line.append(amountText);target.append(line);
  }
 }else{
  note(target,'Registered money is available for one or more outlets, but no single receipt has enough approved balance for ALL selected outlets. Allocate the bank receipt in Bank History first, then click Refresh All Outlet Balances.',true);
  const entries=[...rowsByTransaction.entries()].map(([tx,perCustomer])=>({
   tx,perCustomer,maximum:Math.max(...[...perCustomer.values()].map(x=>Number(x.remaining_amount)||0))
  })).sort((a,b)=>b.maximum-a.maximum);
  if(!entries.length)target.append(bankLink('','Open Bank History to review existing receipts'));
  for(const item of entries.slice(0,5)){
   const row=document.createElement('div');row.style.cssText='margin:5px 0;font-size:12px;color:#5d7088';
   row.append(bankLink(item.tx,'Allocate Outlets · '+item.tx));
   const text=document.createElement('span');
   text.textContent=' Registered balance '+money(item.maximum,contextAtStart.currency);
   row.append(text);target.append(row);
   // Suggest amounts without approving them. Leave unspent funds with the original outlet.
   if(item.perCustomer.size===1){
    const anchorId=[...item.perCustomer.keys()][0],bankRow=item.perCustomer.get(anchorId);
    const notAnchor=ids.filter(x=>x!==anchorId);
    const untouched=Number(bankRow.original_amount||0)-Number(bankRow.remaining_amount||0);
    const shareOutside=notAnchor.reduce((sum,id)=>sum+Number(contextAtStart.needed.get(id)||0),0);
    const anchorShare=Number(bankRow.original_amount||0)-shareOutside;
    if(untouched<0.00001&&anchorShare+0.00001>=Number(contextAtStart.needed.get(anchorId)||0)){
     const example=document.createElement('div');
     example.style.cssText='font-size:11px;margin:3px 0 9px 10px;color:#55728b;line-height:1.6';
     example.textContent='Suggested split: '+[...notAnchor.map(id=>{
       const customer=contextAtStart.rows.find(x=>clean(x.customerId)===id);
       return (customer?.customer||id)+' '+money(contextAtStart.needed.get(id),contextAtStart.currency);
     }), (contextAtStart.rows.find(x=>clean(x.customerId)===anchorId)?.customer||anchorId)+' '+money(anchorShare,contextAtStart.currency)].join(' · ')+
       '. Review and approve the amounts in Bank History.';
     row.append(example);
    }
   }
  }
 }
}
function updateLocalBulkBalances(customerId,rows){
 try{
  const session=JSON.parse(localStorage.getItem('BB_SUPABASE_DEV_SESSION_V1')||'null');
  const jwt=String(session?.access_token||'').split('.')[1];if(!jwt)return;
  const sub=JSON.parse(atob(jwt.replace(/-/g,'+').replace(/_/g,'/'))).sub;
  if(!sub)return;
  const key='bb-bank-bulk-v1:'+sub,saved=JSON.parse(localStorage.getItem(key)||'null')||{rows:[]};
  const fresh=rows.filter(r=>Number(r.remaining_amount)>0).map(r=>{
   const currency=clean(r.currency).toUpperCase(),invoiceCurrency=clean(r.invoice_currency||currency).toUpperCase();
   const rate=Number(r.approved_exchange_rate)||1,rem=Number(r.remaining_amount);
   const eq=currency===invoiceCurrency?rem:currency==='KHR'?rem/rate:rem*rate;
   return {...r,customer_id:customerId,original_amount:Number(r.original_amount),remaining_amount:rem,
    used_amount:Number(r.used_amount),equivalent_remaining:eq,equivalent_amount:eq};
  });
  saved.rows=(saved.rows||[]).filter(r=>String(r.customer_id)!==customerId).concat(fresh);
  saved.syncedAt=Date.now();
  localStorage.setItem(key,JSON.stringify(saved));
  document.dispatchEvent(new CustomEvent('bb:bank-cache-updated',{detail:{customerId,balances:fresh,syncedAt:saved.syncedAt}}));
 }catch(e){console.warn('Multi-outlet cache refresh:',e?.message||e)}
}
function install(){
 const open=window.openBatchPayment;
 if(typeof open==='function'&&!open.__bbMultiOutlet){
  const wrapped=function(...args){const result=open.apply(this,args);void render();return result};
  wrapped.__bbMultiOutlet=true;window.openBatchPayment=wrapped;
 }
 document.getElementById('batchMethod')?.addEventListener('change',()=>{void render()});
 const post=window.apiPost;
 if(typeof post==='function'&&!post.__bbMultiOutlet){
  const wrapped=async function(params){
    const d=params?.action==='arBatchPayment'&&params.paymentData?
      (()=>{try{return JSON.parse(params.paymentData)}catch{return null}})():null;
    const ids=d&&d.paymentMethod==='Bank'?[...new Set(rowsSelected().map(x=>clean(x.customerId)).filter(Boolean))]:[];
    const result=await post.apply(this,arguments);
    if(result?.success===true&&ids.length>1&&d?.transactionId){
      void (async()=>{
        for(const id of ids){
         const rows=await liveBalance(id,true);
         updateLocalBulkBalances(id,rows);
        }
      })().catch(e=>console.warn('Multi-outlet A/R sync:',e?.message||e));
    }
    return result;
  };
  wrapped.__bbMultiOutlet=true;window.apiPost=wrapped;
 }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
else install();
})();
