/* BIG BROTHER — Authorized Historical A/R Invoice Correction
 * All invoice edits and audit logs are performed by privileged server RPCs.
 */
(function(){
'use strict';
if(new URLSearchParams(location.search).get('view')!=='all')return;
const $=id=>document.getElementById(id);
const rpc=(name,args)=>window.BBARAdapter.rpc(name,args);
let active=false,loading=false,saving=false,selection=null,items=[],count=0,offset=0,term='',requestNo=0,timer=0;
const PAGE_SIZE=75;
function el(type,text,css){
 const node=document.createElement(type);
 if(text!==undefined)node.textContent=String(text);
 if(css)node.className=css;
 return node;
}
function notify(message,error=false){
 const node=$('arCorrectionStatus');
 node.textContent=message;
 node.style.color=error?'#a52b36':'#376484';
}
function hideEdit(){
 selection=null;$('arCorrectionEdit').hidden=true;
 $('arCorrectionVerified').checked=false;
 $('arCorrectionSave').disabled=true;
}
function refreshSave(){
 const r=selection,n=$('arCorrectionNumber').value.trim(),d=$('arCorrectionDate').value;
 const reason=$('arCorrectionReason').value.trim();
 $('arCorrectionSave').disabled=saving||!r||!n||n.length>80||!d||
  reason.length<8||reason.length>500||
  (r.has_photo&&!$('arCorrectionVerified').checked)||
  (r.invoice_no===n&&r.invoice_date===d);
}
function selectRow(r){
 if(saving)return;
 selection=r;
 $('arCorrectionCustomer').textContent=r.customer_name+' ('+r.customer_id+')';
 $('arCorrectionCurrent').textContent=r.invoice_no+' · '+r.invoice_date;
 $('arCorrectionLocation').textContent=r.location_code;
 $('arCorrectionDue').textContent=r.due_date||'No due date';
 $('arCorrectionOutstanding').textContent=r.currency+' '+r.outstanding;
 $('arCorrectionNumber').value=r.invoice_no;
 $('arCorrectionDate').value=r.invoice_date;
 $('arCorrectionReason').value='';
 $('arCorrectionVerified').checked=false;
 $('arCorrectionPhoto').textContent=r.has_photo
  ?'⚠ A real invoice photo is attached. Read the physical invoice first. Its file and previous verification history will not be rewritten.'
  :'No invoice photo is attached. Check the original paper before changing its header.';
 $('arCorrectionPayment').textContent=r.has_payments
  ?'⚠ Payments are already linked to this invoice. Those transactions will not be changed.'
  :'Previously paid opening balance and all other amounts will remain unchanged.';
 $('arCorrectionEdit').hidden=false;
 refreshSave();
 $('arCorrectionNumber').focus();
 $('arCorrectionEdit').scrollIntoView({block:'nearest',behavior:'smooth'});
}
function renderRows(){
 const tbody=$('arCorrectionRows');tbody.replaceChildren();
 for(const r of items){
  const tr=el('tr');
  for(const k of ['invoice_no','invoice_date','customer_name','location_code','outstanding']){
   tr.append(el('td',r[k]??''));
  }
  tr.append(el('td',r.has_photo?'📷':'—'));
  const td=el('td'),button=el('button','✎ Edit','btn secondary');
  button.type='button';button.onclick=()=>selectRow(r);td.append(button);tr.append(td);
  tbody.append(tr);
 }
 if(!items.length){
  const tr=el('tr'),td=el('td','No matching imported historical invoices.');
  td.colSpan=7;tr.append(td);tbody.append(tr);
 }
 $('arCorrectionCount').textContent=count
  ?'Showing '+(offset+1)+'–'+(offset+items.length)+' of '+count+' imported invoice(s)'
  :'No matching historical invoices';
 $('arCorrectionPrev').disabled=saving||loading||offset===0;
 $('arCorrectionNext').disabled=saving||loading||offset+items.length>=count;
}
async function refreshRows(preserveMessage=false){
 if(!active)return;
 const serial=++requestNo,search=term,page=offset;
 loading=true;hideEdit();
 if(!preserveMessage)notify('Loading imported historical invoices…');
 try{
  const data=await rpc('bb_ar_migration_editable_list',{
   p_search:search,p_limit:PAGE_SIZE,p_offset:page
  });
  if(!active||serial!==requestNo)return;
  items=Array.isArray(data?.rows)?data.rows:[];
  count=Number(data?.total||0);
  if(!preserveMessage)notify('Select an invoice and choose Edit. All changes require a reason.');
 }catch(error){
  if(active&&serial===requestNo){
   items=[];count=0;notify('Unable to list invoices: '+(error?.message||error),true);
  }
 }finally{
  if(serial===requestNo){loading=false;renderRows()}
 }
}
async function saveEdit(){
 refreshSave();
 if(!selection||saving||$('arCorrectionSave').disabled)return;
 const r=selection,number=$('arCorrectionNumber').value.trim();
 const date=$('arCorrectionDate').value,reason=$('arCorrectionReason').value.trim();
 const changes=[];
 if(number!==r.invoice_no)changes.push('Number: '+r.invoice_no+' → '+number);
 if(date!==r.invoice_date)changes.push('Invoice date: '+r.invoice_date+' → '+date);
 const prompt='Save audited correction for '+r.customer_name+' ('+r.customer_id+')?'+
  '\n\n'+changes.join('\n')+
  '\n\nThe original invoice photo, due date, customer, amount, payments and outstanding balance will NOT change.'+
  '\n\nCorrection reason: '+reason;
 if(!window.confirm(prompt))return;
 saving=true;$('arCorrectionSave').disabled=true;
 $('arCorrectionCancelEdit').disabled=true;
 notify('Saving historical A/R correction…');
 try{
  const response=await rpc('bb_ar_migration_correct_header',{
   p_invoice_id:r.invoice_id,
   p_invoice_no:number,p_invoice_date:date,
   p_expected_invoice_no:r.invoice_no,p_expected_invoice_date:r.invoice_date,
   p_reason:reason
  });
  if(!response?.success)throw Error('Correction was not confirmed by server');
  hideEdit();
  await refreshRows(true);
  notify('Saved '+response.invoice_no+' · '+response.invoice_date+
   '. Corrected fields and reason were audit logged; balances unchanged.');
  if(typeof window.loadAR==='function'){
   try{await window.loadAR(true)}catch(e){console.warn('A/R list refresh:',e)}
  }
 }catch(error){
  notify('Correction not saved: '+(error?.message||error),true);
 }finally{
  saving=false;$('arCorrectionCancelEdit').disabled=false;refreshSave();
 }
}
function close(){
 if(saving)return;
 active=false;requestNo++;
 if(timer)clearTimeout(timer);
 hideEdit();
 $('arCorrectionModal').hidden=true;$('arCorrectionModal').style.display='none';
}
function open(){
 if(active)return;
 active=true;term='';offset=0;items=[];count=0;
 $('arCorrectionSearch').value='';
 $('arCorrectionModal').hidden=false;$('arCorrectionModal').style.display='flex';
 renderRows();void refreshRows();
 $('arCorrectionSearch').focus();
}
function mount(){
 if($('arCorrectionButton')||!document.querySelector('.topbar'))return;
 const style=el('style');
 style.textContent=[
 '#arCorrectionToolbar{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px}',
 '#arCorrectionModal{position:fixed;inset:0;z-index:11010;background:#132940bd;display:none;align-items:center;justify-content:center;padding:14px}',
 '#arCorrectionModal[hidden],#arCorrectionEdit[hidden]{display:none!important}',
 '.ar-correct-dialog{width:min(1050px,100%);max-height:94dvh;overflow:auto;background:white;border-radius:14px;padding:20px;box-shadow:0 18px 50px #07182d66;color:#17365d}',
 '.ar-correct-row{display:flex;align-items:center;justify-content:space-between;gap:9px;flex-wrap:wrap}',
 '.ar-correct-row h2{font-size:20px;margin:0}',
 '.ar-correct-note{font-size:12px;color:#51677e;line-height:1.5}',
 '.ar-correct-search{display:flex;align-items:center;gap:9px;margin:12px 0;flex-wrap:wrap}',
 '.ar-correct-search input{flex:1;min-width:min(100%,280px);padding:10px;border:1px solid #b5c9df;border-radius:8px}',
 '.ar-correct-table{max-height:min(42dvh,425px);overflow:auto;border:1px solid #dbe4ee;border-radius:8px}',
 '.ar-correct-table table{min-width:810px;width:100%;border-collapse:collapse}',
 '.ar-correct-table th{position:sticky;top:0;z-index:1;background:#eef4fb}',
 '.ar-correct-table th,.ar-correct-table td{font-size:12px;padding:9px;border-bottom:1px solid #e3edf4;text-align:left}',
 '.ar-correct-table tr:nth-child(even){background:#f7faff}',
 '.ar-correct-editor{margin-top:14px;padding:13px;border:1px solid #bad2e8;background:#f3f8ff;border-radius:11px}',
 '.ar-correct-editor h3{margin:0 0 8px}',
 '.ar-correct-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}',
 '.ar-correct-fields label{font-size:12px;font-weight:700;display:grid;gap:5px}',
 '.ar-correct-fields input{width:100%;min-width:0;padding:10px;border:1px solid #b5c9df;border-radius:7px;font-size:15px}',
 '.ar-correct-editor textarea{width:100%;padding:10px;border:1px solid #b5c9df;border-radius:7px;min-height:65px}',
 '#arCorrectionCount{font-size:12px;color:#456782}',
 '.ar-correct-warning{font-size:12px;color:#936329}',
 '@media(max-width:570px){.ar-correct-dialog{padding:12px}.ar-correct-fields{grid-template-columns:1fr}}'
 ].join('');
 document.head.append(style);
 const toolbar=el('div');toolbar.id='arCorrectionToolbar';
 const button=el('button','✎ Edit Imported A/R','btn secondary');
 button.type='button';button.id='arCorrectionButton';
 toolbar.append(button);document.querySelector('.topbar').insertAdjacentElement('afterend',toolbar);
 const modal=el('div');modal.id='arCorrectionModal';modal.hidden=true;
 modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
 modal.setAttribute('aria-label','Correct imported historical invoices');
 modal.innerHTML=[
 '<section class="ar-correct-dialog">',
 '<div class="ar-correct-row"><h2>✎ Edit Imported Historical A/R</h2><button id="arCorrectionClose" class="btn secondary" type="button">✕ Close</button></div>',
 '<p class="ar-correct-note">Admin only · Correct invoice number or invoice date. Select the exact customer. Due dates, amounts, existing payments and real invoice photographs are not changed.</p>',
 '<div class="ar-correct-search"><input id="arCorrectionSearch" type="search" autocomplete="off" placeholder="Search customer, invoice number, location, date" aria-label="Search imported A/R">',
 '<button id="arCorrectionFind" type="button" class="btn secondary">🔍 Search</button></div>',
 '<p id="arCorrectionStatus" role="status" class="ar-correct-note" aria-live="polite"></p>',
 '<div class="ar-correct-table"><table><thead><tr><th>Invoice No.</th><th>Invoice Date</th><th>Customer</th><th>Location</th><th>Outstanding</th><th>Photo</th><th>Action</th></tr></thead><tbody id="arCorrectionRows"></tbody></table></div>',
 '<div class="ar-correct-row" style="margin:10px 0"><span id="arCorrectionCount"></span><span><button type="button" id="arCorrectionPrev" class="btn secondary">← Previous</button> <button type="button" id="arCorrectionNext" class="btn secondary">Next →</button></span></div>',
 '<div id="arCorrectionEdit" class="ar-correct-editor" hidden>',
 '<h3>Correct Selected Invoice</h3>',
 '<p class="ar-correct-note">Customer: <strong id="arCorrectionCustomer"></strong> · Location: <strong id="arCorrectionLocation"></strong></p>',
 '<p class="ar-correct-note">Existing number/date: <strong id="arCorrectionCurrent"></strong> · Due date: <strong id="arCorrectionDue"></strong> · Outstanding: <strong id="arCorrectionOutstanding"></strong></p>',
 '<div class="ar-correct-fields"><label for="arCorrectionNumber">Correct Invoice Number<input id="arCorrectionNumber" maxlength="80" required autocomplete="off"></label>',
 '<label for="arCorrectionDate">Correct Invoice Date<input id="arCorrectionDate" type="date" required></label></div>',
 '<p class="ar-correct-note">Due date is not recalculated. No customer, currency, payments or balance fields are editable here.</p>',
 '<p id="arCorrectionPhoto" class="ar-correct-warning"></p><p id="arCorrectionPayment" class="ar-correct-warning"></p>',
 '<label class="ar-correct-note"><input id="arCorrectionVerified" type="checkbox"> I verified the original paper invoice (required if photo attached)</label>',
 '<label for="arCorrectionReason" class="ar-correct-note" style="display:block;margin-top:10px;font-weight:700">Reason for correction (8–500 characters)</label>',
 '<textarea id="arCorrectionReason" maxlength="500" placeholder="Explain the incorrect invoice number or date and the correct source"></textarea>',
 '<div class="ar-correct-row" style="margin-top:12px"><button id="arCorrectionCancelEdit" type="button" class="btn secondary">Cancel Edit</button>',
 '<button id="arCorrectionSave" type="button" class="btn primary" disabled>✓ Save Audited Correction</button></div>',
 '</div></section>'
 ].join('');
 document.body.append(modal);
 button.onclick=open;$('arCorrectionClose').onclick=close;
 modal.addEventListener('click',e=>{if(e.target===modal)close()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&active&&!saving)close()});
 $('arCorrectionFind').onclick=()=>{term=$('arCorrectionSearch').value.trim();offset=0;void refreshRows()};
 $('arCorrectionSearch').oninput=()=>{
  if(timer)clearTimeout(timer);
  timer=setTimeout(()=>{term=$('arCorrectionSearch').value.trim();offset=0;void refreshRows()},320);
 };
 $('arCorrectionSearch').onkeydown=e=>{
  if(e.key==='Enter'){
   e.preventDefault();if(timer)clearTimeout(timer);
   term=$('arCorrectionSearch').value.trim();offset=0;void refreshRows();
  }
 };
 $('arCorrectionPrev').onclick=()=>{
  if(offset>0&&!saving){offset=Math.max(0,offset-PAGE_SIZE);void refreshRows()}
 };
 $('arCorrectionNext').onclick=()=>{
  if(offset+items.length<count&&!saving){offset+=PAGE_SIZE;void refreshRows()}
 };
 for(const id of ['arCorrectionNumber','arCorrectionDate','arCorrectionReason','arCorrectionVerified']){
  $(id).addEventListener('input',refreshSave);
  $(id).addEventListener('change',refreshSave);
 }
 $('arCorrectionCancelEdit').onclick=hideEdit;
 $('arCorrectionSave').onclick=saveEdit;
 hideEdit();
}
(async function(){
 try{
  const profile=await window.BBARAdapter.accessProfile('all');
  if(profile?.role==='admin'&&profile?.permissions?.canEdit)mount();
 }catch(error){console.warn('Historical A/R correction access:',error)}
})();
})();
