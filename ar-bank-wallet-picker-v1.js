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

function showWallet(){
 protectTransactionIdFields();
 const bank=document.getElementById('bankFields');
 if(!bank)return;
 let panel=document.getElementById('bbWalletAR');
 if(!panel){panel=document.createElement('div');panel.id='bbWalletAR';bank.append(panel);}
 selectedSingle=null;
 const item=typeof currentInvoice!=='undefined'?currentInvoice:null;
 if(!item||document.getElementById('payMethod')?.value!=='Bank'){panel.textContent='';return;}
 panel.textContent='Loading registered bank balances…';
 window.BBARAdapter.rpc('bb_customer_bank_balance_list_v2',{p_customer_id:item.customerId}).then(rows=>{
   panel.replaceChildren();
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
 }).catch(e=>{panel.textContent='Balance unavailable: '+String(e.message||e)});
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
 box.textContent='Checking registered bank balance…';
 window.BBARAdapter.rpc('bb_customer_bank_balance_list_v2',{p_customer_id:ids[0]}).then(rows=>{
  box.replaceChildren();
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
 }).catch(e=>box.textContent='Bank balance unavailable: '+String(e.message||e));
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
  return originalApi.call(this,params);
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