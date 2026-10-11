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
function install(){
 const original=window.openPayment;
 if(typeof original==='function')window.openPayment=async function(...args){const r=await original.apply(this,args);showWallet();return r;};
 document.getElementById('payMethod')?.addEventListener('change',showWallet);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();