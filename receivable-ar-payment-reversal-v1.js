/* BIG BROTHER — A/R Bank Payment Reversal V1
 * Admin-only All Receivable. The backend owns permissions, checks and writes.
 * Never reverse sales/stock, cash collections or registered wallet receipts here.
 */
(function(){
'use strict';
if(new URLSearchParams(location.search).get('view')!=='all')return;
if(window.BBARReversalV1)return;
window.BBARReversalV1={installed:true};
const byId=id=>document.getElementById(id);
const rpc=(action,args={})=>window.BBARAdapter.rpc('bb_ar_payment_reversal_v1',Object.assign({p_action:action},args));
let active=false,busy=false,selected=null,items=[],requestNo=0,timer=0;
const fmt=n=>Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
function make(type,text,cls){
 const x=document.createElement(type);
 if(text!==undefined)x.textContent=String(text);
 if(cls)x.className=cls;
 return x;
}
function status(text,isError=false){
 const el=byId('arRevStatus');if(!el)return;
 el.textContent=text;el.style.color=isError?'#b42332':'#34577d';
}
function showPreview(v){
 selected=v;
 const box=byId('arRevPreview');box.hidden=false;
 byId('arRevCustomer').textContent=v.customerName+' ('+v.customerId+')';
 byId('arRevPayment').textContent=v.paymentId+' · '+v.paymentDate+' · '+(v.bank||'Bank');
 byId('arRevTx').textContent=v.transactionId;
 byId('arRevAmount').textContent=v.currency+' '+fmt(v.amount);
 const rows=byId('arRevInvoiceRows');rows.replaceChildren();
 (v.invoices||[]).forEach(i=>{
  const tr=make('tr');
  const cols=[i.invoiceNo,i.invoiceDate,i.currency+' '+fmt(i.invoiceAmount),
   i.currency+' '+fmt(i.allocatedAmount),
   i.currency+' '+fmt(i.beforeOutstanding),
   i.currency+' '+fmt(i.afterOutstanding)];
  cols.forEach(c=>tr.append(make('td',c)));
  rows.append(tr);
 });
 byId('arRevEligibility').textContent=v.eligible?
  'Eligible for reversal. This bank payment will be removed from the active A/R ledger; its invoice allocation(s) will return to outstanding. Original payment details remain in the audit history.':
  'Cannot reverse this payment: '+(v.blockReason||'Manual accounting review required.');
 byId('arRevEligibility').style.color=v.eligible?'#12613d':'#ad293b';
 byId('arRevApproveSection').hidden=!v.eligible;
 byId('arRevReason').value='';
 byId('arRevTypedId').value='';
 byId('arRevAcknowledge').checked=false;
 enableSave();
 box.scrollIntoView({block:'nearest',behavior:'smooth'});
}
function enableSave(){
 const button=byId('arRevApply');
 if(!button)return;
 button.disabled=busy||!selected?.eligible||byId('arRevReason').value.trim().length<12
  ||byId('arRevReason').value.trim().length>500
  ||byId('arRevTypedId').value.trim()!==selected?.paymentId
  ||!byId('arRevAcknowledge').checked;
}
function render(){
 const tbody=byId('arRevRows');tbody.replaceChildren();
 for(const r of items){
  const tr=make('tr');
  [r.payment_id,r.customer_name_snapshot,r.invoice_no_snapshot,
    r.payment_date,r.currency+' '+fmt(r.amount),r.transaction_id].forEach(v=>tr.append(make('td',v||'—')));
  const cell=make('td');
  const btn=make('button','Review','btn secondary');
  btn.type='button';btn.disabled=busy;
  btn.onclick=()=>review(r.payment_id);
  cell.append(btn);tr.append(cell);tbody.append(tr);
 }
 if(!items.length){
  const tr=make('tr'),td=make('td','No matching active A/R bank payments.');
  td.colSpan=7;tr.append(td);tbody.append(tr);
 }
}
async function search(){
 if(!active||busy)return;
 const q=byId('arRevSearch').value.trim(),request=++requestNo;
 selected=null;byId('arRevPreview').hidden=true;
 if(q.length<2){items=[];render();status('Enter at least 2 characters (payment ID, transaction ID, invoice, or customer).');return;}
 busy=true;status('Finding bank A/R payments…');
 try{
  const result=await rpc('search',{p_search:q});
  if(request!==requestNo||!active)return;
  items=Array.isArray(result?.rows)?result.rows:[];
  status('Found '+items.length+' active bank A/R payment(s). Choose Review to see eligible invoices.');
 }catch(e){
  if(request===requestNo&&active){items=[];status('Search failed: '+(e?.message||e),true)}
 }finally{
  busy=false;if(request===requestNo&&active){render();enableSave()}
 }
}
async function review(id){
 if(busy)return;
 busy=true;selected=null;byId('arRevPreview').hidden=true;
 status('Checking current bank payment, invoice balances, and linked records…');
 try{
  const result=await rpc('preview',{p_payment_id:id});
  if(!active)return;
  showPreview(result);
  status(result.eligible?'Bank payment preview is ready. Confirm all details before reversing.':
    'Payment cannot be safely released: '+(result.blockReason||'Linked records'),!result.eligible);
 }catch(e){status('Unable to preview payment: '+(e?.message||e),true)}
 finally{busy=false;enableSave()}
}
async function reverse(){
 enableSave();if(!selected||busy||byId('arRevApply').disabled)return;
 const p=selected,reason=byId('arRevReason').value.trim();
 const confirmation='REVERSE A/R BANK PAYMENT?\n\nPayment: '+p.paymentId+
  '\nCustomer: '+p.customerName+'\nBank transaction: '+p.transactionId+
  '\nAmount: '+p.currency+' '+fmt(p.amount)+
  '\nAffected invoices: '+(p.invoices||[]).map(i=>i.invoiceNo).join(', ')+
  '\n\nThis will restore A/R outstanding and release this transaction ID. '+
  'The sale, stock and other payments will NOT be changed.\n\nReason: '+reason+
  '\n\nContinue with the audited reversal?';
 if(!window.confirm(confirmation))return;
 busy=true;enableSave();status('Verifying and reversing the bank A/R payment…');
 try{
  const result=await rpc('reverse',{
    p_payment_id:p.paymentId,p_token:p.token,p_reason:reason
  });
  if(!result?.success)throw Error('Server did not confirm the reversal');
  selected=null;byId('arRevPreview').hidden=true;
  status('✓ REVERSED '+result.paymentId+' · Restored '+result.currency+' '+
    fmt(result.restoredAmount)+' to A/R · Transaction '+result.releasedTransactionId+
    ' is free · Audit '+result.auditId+'.');
  // This refreshes the normal company A/R list without navigating away.
  if(typeof window.loadAR==='function'){
   try{await window.loadAR(true)}catch(e){console.warn('A/R refresh after reversal',e)}
  }
  items=[];render();byId('arRevSearch').value='';
 }catch(e){
  status('REVERSAL NOT SAVED: '+(e?.message||e)+'. Reopen Review before trying again.',true);
  selected=null;byId('arRevPreview').hidden=true;
 }finally{busy=false;enableSave()}
}
function close(){
 if(busy)return;
 active=false;requestNo++;selected=null;
 if(timer)clearTimeout(timer);
 byId('arRevModal').hidden=true;
}
function open(){
 active=true;busy=false;items=[];selected=null;
 byId('arRevSearch').value='';
 byId('arRevPreview').hidden=true;
 byId('arRevModal').hidden=false;
 render();status('Search an existing bank A/R payment to preview its reversal.');
 byId('arRevSearch').focus();
}
function mount(){
 if(byId('arRevButton')||!document.querySelector('.topbar'))return;
 const css=make('style');
 css.textContent=[
 '#arRevToolbar{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px}',
 '#arRevModal{position:fixed;inset:0;z-index:11140;display:flex;align-items:center;justify-content:center;background:#102945c9;padding:14px}',
 '#arRevModal[hidden],#arRevPreview[hidden],#arRevApproveSection[hidden]{display:none!important}',
 '.ar-rev-dialog{width:min(1120px,100%);max-height:94dvh;overflow:auto;background:#fff;border-radius:14px;padding:20px;color:#163960;box-shadow:0 18px 52px #07182d68}',
 '.ar-rev-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}',
 '.ar-rev-head h2{margin:0;font-size:20px}',
 '.ar-rev-hint{font-size:12px;color:#546d85;line-height:1.5;margin:9px 0}',
 '.ar-rev-search{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}',
 '.ar-rev-search input{flex:1;min-width:240px;padding:10px;border:1px solid #bdd0e4;border-radius:8px}',
 '.ar-rev-scroll{max-height:30dvh;overflow:auto;border:1px solid #dce7f3;border-radius:9px}',
 '.ar-rev-scroll table{min-width:800px;width:100%;border-collapse:collapse}',
 '.ar-rev-scroll th{position:sticky;top:0;background:#eaf3fc;text-align:left}',
 '.ar-rev-scroll th,.ar-rev-scroll td{font-size:12px;padding:9px;border-bottom:1px solid #e6eef6}',
 '.ar-rev-scroll tr:nth-child(even){background:#f7fbff}',
 '.ar-rev-detail{margin-top:13px;border:1px solid #c5d8eb;background:#f5f9ff;border-radius:10px;padding:14px}',
 '.ar-rev-detail h3{margin:0 0 10px}',
 '.ar-rev-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}',
 '.ar-rev-fields label{display:grid;gap:5px;font-size:12px;font-weight:700}',
 '.ar-rev-fields input,.ar-rev-fields textarea{width:100%;min-width:0;box-sizing:border-box;padding:10px;border:1px solid #a8c0d7;border-radius:7px;font-size:14px}',
 '.ar-rev-fields textarea{min-height:70px;resize:vertical}',
 '.ar-rev-warning{font-size:12px;padding:10px;background:#fff4e3;border-left:3px solid #c77f14;line-height:1.5}',
 '.ar-rev-actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;margin-top:12px}',
 '@media(max-width:650px){.ar-rev-dialog{padding:12px}.ar-rev-fields{grid-template-columns:1fr}}'
 ].join('');
 document.head.append(css);
 const toolbar=make('div');toolbar.id='arRevToolbar';
 const button=make('button','↶ Reverse A/R Bank Payment','btn secondary');
 button.id='arRevButton';button.type='button';toolbar.append(button);
 document.querySelector('.topbar').insertAdjacentElement('afterend',toolbar);
 const modal=make('div');modal.id='arRevModal';modal.hidden=true;
 modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
 modal.setAttribute('aria-label','Reverse Accounts Receivable Bank Payment');
 modal.innerHTML=[
 '<section class="ar-rev-dialog">',
 '<div class="ar-rev-head"><h2>↶ A/R Bank Payment Reversal</h2>',
 '<button type="button" id="arRevClose" class="btn secondary">✕ Close</button></div>',
 '<p class="ar-rev-hint">Admin only · Reverse the A/R bank payment, not the invoice sale. The released bank transaction becomes available again. Audit history is permanent. Cash, wallet-linked and downstream posted payments are blocked.</p>',
 '<div class="ar-rev-search"><input id="arRevSearch" type="search" autocomplete="off" placeholder="Payment ID, Transaction ID, Invoice, or Customer" aria-label="Find bank payment">',
 '<button type="button" id="arRevFind" class="btn secondary">🔎 Find Payment</button></div>',
 '<p id="arRevStatus" class="ar-rev-hint" role="status" aria-live="polite"></p>',
 '<div class="ar-rev-scroll"><table><thead><tr><th>Payment</th><th>Customer</th><th>Invoice(s)</th><th>Payment Date</th><th>Bank Amount</th><th>Transaction ID</th><th>Action</th></tr></thead><tbody id="arRevRows"></tbody></table></div>',
 '<section class="ar-rev-detail" id="arRevPreview" hidden>',
 '<h3>Review selected payment</h3>',
 '<p class="ar-rev-hint">Customer: <strong id="arRevCustomer"></strong></p>',
 '<p class="ar-rev-hint">Payment: <strong id="arRevPayment"></strong> · Amount: <strong id="arRevAmount"></strong></p>',
 '<p class="ar-rev-hint">Bank Transaction ID: <strong id="arRevTx"></strong></p>',
 '<div class="ar-rev-scroll"><table><thead><tr><th>Invoice</th><th>Invoice Date</th><th>Invoice Amount</th><th>To Restore</th><th>Before A/R</th><th>After A/R</th></tr></thead><tbody id="arRevInvoiceRows"></tbody></table></div>',
 '<p id="arRevEligibility" class="ar-rev-warning" role="status"></p>',
 '<div id="arRevApproveSection" hidden>',
 '<div class="ar-rev-fields"><label style="grid-column:1/-1">Reason for reversal (12–500 characters)<textarea id="arRevReason" maxlength="500" placeholder="e.g. Wrong customer bank transaction ID was used to clear this A/R."></textarea></label>',
 '<label>Type the Payment ID to confirm<input id="arRevTypedId" autocomplete="off" placeholder="PAY-0000"></label>',
 '</div>',
 '<p class="ar-rev-hint"><label><input id="arRevAcknowledge" type="checkbox"> I verified this is the incorrect payment and understand it will reopen the affected A/R without refunding any bank money.</label></p>',
 '<div class="ar-rev-actions"><button id="arRevApply" type="button" class="btn primary" disabled>↶ Confirm Audited Reversal</button></div>',
 '</div></section></section>'
 ].join('');
 document.body.append(modal);
 button.onclick=open;byId('arRevClose').onclick=close;
 modal.addEventListener('click',e=>{if(e.target===modal)close()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&active&&!busy)close()});
 byId('arRevFind').onclick=search;
 byId('arRevSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();if(timer)clearTimeout(timer);void search()}});
 byId('arRevSearch').addEventListener('input',()=>{
  if(timer)clearTimeout(timer);
  timer=setTimeout(()=>{if(!busy)void search()},380);
 });
 for(const id of ['arRevReason','arRevTypedId','arRevAcknowledge']){
  byId(id).addEventListener('input',enableSave);byId(id).addEventListener('change',enableSave);
 }
 byId('arRevApply').onclick=reverse;
 render();
}
(async function(){
 try{
  const profile=await window.BBARAdapter.accessProfile('all');
  if(profile?.role==='admin'&&profile?.permissions?.canEdit)mount();
 }catch(e){console.warn('A/R bank payment reversal access:',e)}
})();
})();
