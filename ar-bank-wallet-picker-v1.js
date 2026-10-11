(function(){
function showWallet(){
 const bank=document.getElementById('bankFields');
 if(!bank)return;
 let panel=document.getElementById('bbWalletAR');
 if(!panel){panel=document.createElement('div');panel.id='bbWalletAR';bank.append(panel);}
 const item=typeof currentInvoice!=='undefined'?currentInvoice:null;
 if(!item||document.getElementById('payMethod')?.value!=='Bank'){panel.textContent='';return;}
 panel.textContent='Loading registered bank balances…';
 window.BBARAdapter.rpc('bb_customer_bank_balance_list_v2',{p_customer_id:item.customerId}).then(rows=>{
   panel.replaceChildren();
   const valid=(Array.isArray(rows)?rows:[]).filter(x=>x.invoice_currency===item.currency&&Number(x.remaining_amount)>0);
   if(!valid.length){panel.textContent='No registered bank balance for this customer.';return;}
   const heading=document.createElement('strong');heading.textContent='Available Registered Bank Balance';panel.append(heading);
   valid.forEach(x=>{
     const line=document.createElement('div');line.style.margin='8px 0';
     const btn=document.createElement('button');btn.type='button';btn.textContent='Use '+x.transaction_id+' — remaining '+x.remaining_amount+' '+x.currency;
     btn.onclick=()=>{
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
  const valid=(Array.isArray(rows)?rows:[]).filter(x=>x.invoice_currency===currency&&Number(x.remaining_amount)>0);
  if(!valid.length){box.textContent='No available registered bank balance for these invoices.';return;}
  const title=document.createElement('strong');title.textContent='Available Registered Bank Balance';box.append(title);
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
 const original=window.openPayment;
 if(typeof original==='function')window.openPayment=async function(...args){const r=await original.apply(this,args);showWallet();return r;};
 document.getElementById('payMethod')?.addEventListener('change',showWallet);
 const oldBatch=window.openBatchPayment;
 if(typeof oldBatch==='function')window.openBatchPayment=function(...args){const result=oldBatch.apply(this,args);showBatchWallet();return result;};
 document.getElementById('batchMethod')?.addEventListener('change',showBatchWallet);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();