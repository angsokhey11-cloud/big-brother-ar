(function(){
let selectedSingle=null;
function protectTransactionIdFields(){
 // The actual Admin status comes from the authenticated A/R access profile.
 // Read-only is fail-closed while the profile loads; Supabase also guards writes.
 const admin=typeof sessionProfile!=='undefined'&&sessionProfile?.role==='admin';
 for(const fieldId of ['transactionId','batchTransactionId','reviewTransactionId']){
  const input=document.getElementById(fieldId);
  if(!input)continue;
  input.readOnly=!admin;
  input.setAttribute('aria-readonly',String(!admin));
  input.placeholder=admin?'Enter manual Transaction ID or choose Use':'Choose an Admin-registered transaction (manual ID locked)';
  const noteId='bbManualIdNote_'+fieldId;
  let note=document.getElementById(noteId);
  if(!note){note=document.createElement('div');note.id=noteId;note.style.cssText='font-size:11px;line-height:1.4;color:#5d7087;margin-top:4px';input.insertAdjacentElement('afterend',note);}
  note.textContent=admin?'Admin: manual Transaction ID permitted.':'Staff: manual Transaction ID locked. Select Use for a registered balance or ask Admin to register a new payment.';
 }
}

function bankSnapshot(customerId){try{const s=JSON.parse(localStorage.getItem('BB_SUPABASE_DEV_SESSION_V1')||'null');const t=s?.access_token||'';const sub=JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;if(!sub)return null;const data=JSON.parse(localStorage.getItem('bb-bank-bulk-v1:'+sub)||'null');if(!data)return null;return (data.rows||[]).filter(x=>String(x.customer_id)===String(customerId)&&Number(x.remaining_amount)>0);}catch(_){return null;}}
function removeUsedBankCache(customerId,transactionId){
 try{const s=JSON.parse(localStorage.getItem('BB_SUPABASE_DEV_SESSION_V1')||'null');const sub=JSON.parse(atob((s?.access_token||'').split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;
 if(!sub||!customerId||!transactionId)return;
 const key='bb-bank-bulk-v1:'+sub;const saved=JSON.parse(localStorage.getItem(key)||'null');if(!saved)return;
 saved.rows=(saved.rows||[]).filter(x=>!(String(x.customer_id)===String(customerId)&&String(x.transaction_id)===String(transactionId)));
 localStorage.setItem(key,JSON.stringify(saved));
 }catch(_){}
}
async function refreshCustomerBankCache(customerId){
 // A/R must fetch the REAL remaining balance after each successful use.
 // The shared Invoice Generator bulk cache may have hidden a partially used
 // transaction. This RPC is authorized for A/R editors and Invoice creators.
 const id=String(customerId||'').trim();
 if(!id||typeof window.BBARAdapter?.rpc!=='function')return false;
 const fresh=await window.BBARAdapter.rpc('bb_customer_bank_balance_list_v2',{p_customer_id:id});
 if(!Array.isArray(fresh))throw Error('Invalid bank balance response');
 const session=JSON.parse(localStorage.getItem('BB_SUPABASE_DEV_SESSION_V1')||'null');
 const jwt=String(session?.access_token||'').split('.')[1]||'';
 if(!jwt)return false;
 const sub=JSON.parse(atob(jwt.replace(/-/g,'+').replace(/_/g,'/'))).sub;
 if(!sub)return false;
 const key='bb-bank-bulk-v1:'+sub;
 const saved=JSON.parse(localStorage.getItem(key)||'null')||{rows:[]};
 const normalized=fresh.filter(row=>Number(row.remaining_amount)>0).map(row=>{
  const currency=String(row.currency||'USD').toUpperCase();
  const invoiceCurrency=String(row.invoice_currency||currency).toUpperCase();
  const rate=Number(row.approved_exchange_rate||1);
  const remaining=Number(row.remaining_amount||0);
  const equiv=currency===invoiceCurrency?remaining:
   rate>1?(currency==='KHR'?remaining/rate:remaining*rate):0;
  return {
   customer_id:id,transaction_id:row.transaction_id,
   original_amount:Number(row.original_amount||0),
   used_amount:Number(row.used_amount||0),
   remaining_amount:remaining,amount:remaining,
   currency,invoice_currency:invoiceCurrency,
   approved_exchange_rate:rate,received_date:row.received_date,
   bank_name:row.bank_name||'',
   equivalent_remaining:equiv,equivalent_amount:equiv
  };
 });
 saved.rows=(Array.isArray(saved.rows)?saved.rows:[])
  .filter(row=>String(row.customer_id)!==id).concat(normalized);
 saved.syncedAt=Date.now();
 localStorage.setItem(key,JSON.stringify(saved));
 document.dispatchEvent(new CustomEvent('bb:bank-cache-updated',{
  detail:{customerId:id,balances:normalized,transactions:normalized,
   syncedAt:saved.syncedAt}
 }));
 return true;
}
function addBankRefreshButton(panel,customerId,render){
 const b=document.createElement('button');
 b.type='button';
 b.textContent='↻ Refresh Bank Balance';
 b.style.cssText='display:block;margin:9px 0 6px;border:1px solid #b5c7dc;border-radius:8px;padding:7px 10px;background:#f4f8fc;color:#174a91;font-size:12px;font-weight:700';
 b.onclick=async()=>{
  b.disabled=true;b.textContent='Refreshing bank balance…';
  try{await refreshCustomerBankCache(customerId);render();}
  catch(error){b.disabled=false;b.textContent='↻ Retry Bank Refresh';console.warn('A/R bank refresh:',error);}
 };
 panel.prepend(b);
}
function showWallet(){
 protectTransactionIdFields();
 const bank=document.getElementById('bankFields');
 if(!bank)return;
 let panel=document.getElementById('bbWalletAR');
 if(!panel){panel=document.createElement('div');panel.id='bbWalletAR';bank.append(panel);}
 selectedSingle=null;
 const item=typeof currentInvoice!=='undefined'?currentInvoice:null;
 if(!item||document.getElementById('payMethod')?.value!=='Bank'){panel.textContent='';return;}
 const rows=bankSnapshot(item.customerId);
 if(rows===null){panel.textContent='Bank balance not synced. Press Refresh Bank Balance.';addBankRefreshButton(panel,item.customerId,showWallet);return;}
 {
   panel.replaceChildren();
   addBankRefreshButton(panel,item.customerId,showWallet);
   const valid=(Array.isArray(rows)?rows:[]).filter(x=>x.invoice_currency===item.currency&&Number(x.remaining_amount)>0);
   if(!valid.length){panel.textContent='No registered bank balance for this customer. Staff should ask Admin to register a new bank payment.';return;}
   const heading=document.createElement('strong');heading.textContent='Available Registered Bank Balance (optional)';panel.append(heading);
   const hint=document.createElement('div');hint.textContent='Use a listed balance only when it belongs to this collection. Admin can enter a new Transaction ID manually; staff must ask Admin to register a different transfer.';hint.style.cssText='font-size:12px;color:#61768c;margin-top:5px';panel.append(hint);
   valid.forEach(x=>{
     const line=document.createElement('div');line.style.margin='8px 0';
     const btn=document.createElement('button');btn.type='button';btn.textContent='Use '+x.transaction_id+' — remaining '+x.remaining_amount+' '+x.currency;
     btn.onclick=()=>{
       selectedSingle={transactionId:x.transaction_id,rate:Number(x.approved_exchange_rate),customerId:item.customerId};
       document.getElementById('transactionId').value=x.transaction_id;
       if(x.bank_name)document.getElementById('payBank').value=x.bank_name;
       const a=document.getElementById('payAmount');
       if(!Number(a.value)||Number(a.value)>Number(x.equivalent_remaining)) a.value=String(Math.min(Number(item.outstanding),Number(x.equivalent_remaining)));
     };
     line.append(btn);panel.append(line);
   });
 }
}
function showBatchWallet(){
 protectTransactionIdFields();
 const bank=document.getElementById('batchBankFields');if(!bank)return;
 let box=document.getElementById('bbWalletBatch');
 if(!box){box=document.createElement('div');box.id='bbWalletBatch';bank.append(box);}
 if(document.getElementById('batchMethod')?.value!=='Bank'){box.textContent='';return;}
 const selected=typeof selectedPaymentRows==='function'?selectedPaymentRows():[];
 const ids=[...new Set(selected.map(r=>String(r.customerId||'')))];
 if(ids.length!==1||!ids[0]){box.textContent='Registered balances require invoices from one customer.';return;}
 const currency=String(selected[0]?.currency||'USD');
 const rows=bankSnapshot(ids[0]);
 if(rows===null){box.textContent='Bank balance not synced. Press Refresh Bank Balance.';addBankRefreshButton(box,ids[0],showBatchWallet);return;}
 {
  box.replaceChildren();
  addBankRefreshButton(box,ids[0],showBatchWallet);
  const valid=(Array.isArray(rows)?rows:[]).filter(x=>x.invoice_currency===currency&&x.currency===currency&&Number(x.remaining_amount)>0);
  if(!valid.length){box.textContent='No available registered bank balance for these invoices. Staff should ask Admin to register a new transfer.';return;}
  const title=document.createElement('strong');title.textContent='Available Registered Bank Balance (optional)';box.append(title);
  const hint=document.createElement('div');hint.textContent='Optional: select Use for a related registered balance. Only Admin can enter a new Transaction ID.';hint.style.cssText='font-size:12px;color:#61768c;margin-top:5px';box.append(hint);
  valid.forEach(x=>{
   const row=document.createElement('div');row.style.margin='8px 0';
   const button=document.createElement('button');button.type='button';
   button.textContent='Use '+x.transaction_id+' — remaining '+x.remaining_amount+' '+x.currency;
   button.onclick=()=>{
    document.getElementById('batchTransactionId').value=x.transaction_id;
    if(x.bank_name)document.getElementById('batchBank').value=x.bank_name;
    if(typeof selectedPaymentRows==='function'){
     const total=selectedPaymentRows().reduce((s,r)=>s+Number(r.outstanding||0),0);
     if(total>Number(x.equivalent_remaining))alert('This registered balance is insufficient for the selected batch. Choose fewer invoices or another transaction.');
    }
   };row.append(button);box.append(row);
  });
 }
}
function install(){
 protectTransactionIdFields();
 const original=window.openPayment;
 if(typeof original==='function')window.openPayment=async function(...args){const r=await original.apply(this,args);showWallet();return r;};
 document.getElementById('payMethod')?.addEventListener('change',showWallet);
 const originalApi=window.apiPost;
 if(typeof originalApi==='function')window.apiPost=async function(params){
  if(params?.action==='arPayment'&&selectedSingle&&params.paymentData){
   try{const d=JSON.parse(params.paymentData);
    if(d.paymentMethod==='Bank'&&d.transactionId===selectedSingle.transactionId&&d.customerId===selectedSingle.customerId){
     d.exchangeRate=selectedSingle.rate;params={...params,paymentData:JSON.stringify(d)};
    }
   }catch(_){}
  }
  const receiving=['arPayment','arBatchPayment'].includes(params?.action);
  const data=receiving&&params.paymentData?(()=>{try{return JSON.parse(params.paymentData);}catch(_){return null;}})():null;
  const batchCustomer=params?.action==='arBatchPayment'&&typeof selectedPaymentRows==='function'
   ?(()=>{const ids=[...new Set(selectedPaymentRows().map(row=>String(row.customerId||'')))];return ids.length===1?ids[0]:'';})():'';
  const result=await originalApi.call(this,params);
  const customerId=String(data?.customerId||batchCustomer||'');
  if(receiving&&data?.paymentMethod==='Bank'&&data.transactionId&&customerId&&result?.success===true){
   // Hide the outdated balance immediately, then recover any remaining funds
   // from the authoritative ledger without blocking a completed payment.
   removeUsedBankCache(customerId,data.transactionId);
   void refreshCustomerBankCache(customerId).catch(error=>{
    console.warn('A/R remaining bank balance refresh:',error);
   });
  }
  return result;
 };
 const oldBatch=window.openBatchPayment;
 if(typeof oldBatch==='function')window.openBatchPayment=function(...args){const result=oldBatch.apply(this,args);showBatchWallet();return result;};
 document.getElementById('batchMethod')?.addEventListener('change',showBatchWallet);
 const oldReview=window.openRequestReview;
 if(typeof oldReview==='function')window.openRequestReview=async function(...args){
  protectTransactionIdFields();
  const response=await oldReview.apply(this,args);
  protectTransactionIdFields();
  return response;
 };
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();