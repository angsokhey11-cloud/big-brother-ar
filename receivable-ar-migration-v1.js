/* BIG BROTHER — Desktop All Receivable: administrator-only historical A/R importer. */
(function(){
'use strict';
if(new URLSearchParams(location.search).get('view')!=='all')return;
const FIELDS=['customer_id','invoice_no','invoice_date','due_date','location_code','currency','grand_total','amount_paid','outstanding'];
const EXAMPLE=[['CUSTOMER_ID','INV-000123','2026-01-15','2026-02-14','LOCATION_CODE','USD',50,20,30]];
let batch=null,previewOK=false,working=false;
const $=id=>document.getElementById(id);
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function status(message,bad=false){$('arMigrationStatus').textContent=message;$('arMigrationStatus').style.color=bad?'#ae3037':'#366482'}
function quote(v){return '"'+String(v??'').replace(/"/g,'""')+'"'}
function download(name,data,mime){const url=URL.createObjectURL(new Blob([data],{type:mime}));const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)}
function csvTemplate(){
 const lines=[FIELDS.map(quote).join(','),...Array.from({length:4},()=>FIELDS.map(()=>quote('')).join(','))];
 download('BIG_BROTHER_Historical_AR_Template.csv','\ufeff'+lines.join('\r\n')+'\r\n','text/csv;charset=utf-8');
 status('Template downloaded. Enter existing Customer IDs and Location Codes; do not change the column names.');
}
function loadSheetJS(){
 if(window.XLSX)return Promise.resolve(window.XLSX);
 return new Promise((resolve,reject)=>{
  const s=document.createElement('script');
  s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  s.onload=()=>window.XLSX?resolve(window.XLSX):reject(Error('Excel reader did not initialize'));
  s.onerror=()=>reject(Error('Could not load Excel reader. Save your spreadsheet as CSV and retry.'));
  document.head.appendChild(s);
 });
}
async function downloadTemplate(){
 try{
  const X=await loadSheetJS();
  const w=X.utils.book_new();
  const sheet=X.utils.aoa_to_sheet([FIELDS,...Array.from({length:4},()=>Array(FIELDS.length).fill(''))]);
  sheet['!cols']=[18,18,17,17,19,12,18,18,18].map(wch=>({wch}));
  sheet['!freeze']={xSplit:0,ySplit:1};
  X.utils.book_append_sheet(w,sheet,'Historical AR');
  const notes=[
   ['BIG BROTHER — Historical A/R migration template'],
   ['One outstanding historical invoice per row. Do not import paid or zero-balance invoices.'],
   ['customer_id','Existing Customer ID from Master Database; must already exist.'],
   ['invoice_no','Printed paper invoice number. Preserve leading zeros by formatting cells as text.'],
   ['invoice_date / due_date','Use YYYY-MM-DD. Due date is optional.'],
   ['location_code','Existing active Location Code.'],
   ['currency','USD or KHR.'],
   ['grand_total','Original invoice total.'],
   ['amount_paid','Previously collected amount (opening-balance information only). Use 0 if none.'],
   ['outstanding','Unpaid balance. Must equal grand_total minus amount_paid.'],
   ['Important','Existing invoices are never overwritten. Duplicate customer + invoice numbers are rejected.'],
   ['Important','Import does not create stock sales, deposits, daily cash, or historical payment transactions.'],
   ['Important','Imported outstanding invoices without original photos automatically enter Pending Scan.']
  ];
  const instructions=X.utils.aoa_to_sheet(notes);instructions['!cols']=[27,105];
  X.utils.book_append_sheet(w,instructions,'Instructions');
  // Download the live master references so admins need not guess IDs.
  try{
   const refs=await window.BBARAdapter.rpc('bb_ar_migration_references');
   const customers=X.utils.json_to_sheet(Array.isArray(refs.customers)?refs.customers:[],{header:['customer_id','customer_name','location_code']});
   const locations=X.utils.json_to_sheet(Array.isArray(refs.locations)?refs.locations:[],{header:['location_code','location_name']});
   customers['!cols']=[{wch:24},{wch:48},{wch:22}];
   locations['!cols']=[{wch:25},{wch:48}];
   X.utils.book_append_sheet(w,customers,'Customer IDs');
   X.utils.book_append_sheet(w,locations,'Location Codes');
  }catch(error){console.warn('Template references unavailable:',error)}
  X.writeFile(w,'BIG_BROTHER_Historical_AR_Template.xlsx');
  status('Excel template downloaded. Fill the Historical AR sheet and upload it here.');
 }catch(e){csvTemplate();status('Excel download unavailable, so an Excel-compatible CSV template was downloaded. '+e.message)}
}
function parseCSV(text){
 const rows=[];let row=[],v='',q=false;const t=String(text||'').replace(/^\ufeff/,'');
 for(let i=0;i<t.length;i++){
  const c=t[i];
  if(q){if(c==='"'&&t[i+1]==='"'){v+='"';i++}else if(c==='"')q=false;else v+=c}
  else if(c==='"'&&v==='')q=true;
  else if(c===','){row.push(v);v=''}
  else if(c==='\n'||c==='\r'){if(c==='\r'&&t[i+1]==='\n')i++;row.push(v);rows.push(row);row=[];v=''}
  else v+=c;
 }
 if(q)throw Error('Unclosed quoted value in CSV.');
 if(row.length||v){row.push(v);rows.push(row)}
 return rows;
}
function sheetDate(v){
 const s=String(v??'').trim();
 if(!s)return '';
 if(/^\d{4}-\d\d-\d\d$/.test(s))return s;
 if(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s))throw Error('Use YYYY-MM-DD dates (not DD/MM/YYYY or MM/DD/YYYY).');
 if(/^\d{4}-\d\d-\d\dT/.test(s))return s.slice(0,10);
 if(/^\d{5}$/.test(s)&&window.XLSX?.SSF){
  const p=window.XLSX.SSF.parse_date_code(Number(s));
  if(p)return [p.y,String(p.m).padStart(2,'0'),String(p.d).padStart(2,'0')].join('-');
 }
 return s;
}
function dataRows(table){
 const clean=table.filter(r=>r.some(v=>String(v??'').trim()!==''));
 if(clean.length<2)throw Error('The spreadsheet has no invoice rows.');
 const headers=clean[0].map(h=>String(h??'').replace(/^\ufeff/,'').trim().toLowerCase());
 for(const key of FIELDS){if(!headers.includes(key))throw Error('Missing required column: '+key)}
 const records=clean.slice(1).map(row=>{
  const item={};
  for(const key of FIELDS){const index=headers.indexOf(key);let value=row[index]??'';if(key==='invoice_date'||key==='due_date')value=sheetDate(value);item[key]=String(value).trim()}
  return item;
 });
 if(records.length>250)throw Error('Import up to 250 invoices at once. Divide larger migrations into separate files.');
 return records;
}
async function readFile(file){
 if(!file)throw Error('Choose your completed A/R spreadsheet.');
 const ext=file.name.toLowerCase().split('.').pop();
 if(ext==='csv')return dataRows(parseCSV(await file.text()));
 if(!['xlsx','xls'].includes(ext))throw Error('Use XLSX, XLS, or CSV.');
 const X=await loadSheetJS(),data=await file.arrayBuffer();
 const book=X.read(data,{type:'array',cellDates:false});
 const sheet=book.Sheets['Historical AR']||book.Sheets[book.SheetNames[0]];
 if(!sheet)throw Error('No worksheet was found.');
 return dataRows(X.utils.sheet_to_json(sheet,{header:1,raw:true,defval:'',blankrows:false}));
}
function setWorking(v){working=v;$('arMigrationFile').disabled=v;$('arMigrationPreviewButton').disabled=v||!batch;$('arMigrationCommit').disabled=v||!previewOK;$('arMigrationDownload').disabled=v}
function showResult(result){
 const errors=Array.isArray(result.errors)?result.errors:[];
 const preview=Array.isArray(result.rows)?result.rows:[];
 $('arMigrationIssues').replaceChildren();
 for(const issue of errors.slice(0,50)){const p=document.createElement('p');p.style.cssText='margin:4px 0;color:#a42f32';p.textContent='Spreadsheet row '+(Number(issue.row)+1)+': '+issue.error;$('arMigrationIssues').append(p)}
 const table=$('arMigrationTable');table.replaceChildren();
 if(preview.length){
  const head=document.createElement('tr');
  for(const name of ['Invoice','Date','Customer','Location','Currency','Total','Previously Paid','Outstanding']){
   const th=document.createElement('th');th.textContent=name;head.append(th)
  }
  table.append(head);
  for(const r of preview.slice(0,35)){
   const tr=document.createElement('tr');
   for(const key of ['invoice_no','invoice_date','customer_name','location_code','currency','grand_total','amount_paid','outstanding']){
    const td=document.createElement('td');td.textContent=String(r[key]??'');tr.append(td)
   }
   table.append(tr);
  }
 }
 if(preview.length>35){const p=document.createElement('p');p.textContent='Showing first 35 of '+preview.length+' validated records.';$('arMigrationIssues').append(p)}
 $('arMigrationTableWrap').hidden=!preview.length;
 previewOK=Boolean(result.success)&&!errors.length&&preview.length===batch.length;
 $('arMigrationCommit').disabled=!previewOK;
 if(errors.length)status('Validation found '+errors.length+' issue(s). Nothing was imported.',true);
 else status('Validated '+preview.length+' invoice(s). Review the table, then confirm import. No records have been changed.');
}
async function preview(){
 if(!batch)return;
 setWorking(true);previewOK=false;$('arMigrationTableWrap').hidden=true;
 try{const result=await window.BBARAdapter.rpc('bb_ar_migration_upload',{p_rows:batch,p_commit:false});showResult(result)}
 catch(e){status('Validation failed: '+e.message,true)}
 finally{setWorking(false)}
}
async function upload(){
 if(!previewOK||!batch||working)return;
 if(!window.confirm('Import '+batch.length+' historical outstanding invoice(s) into LIVE A/R?\n\nThis will make them appear in Pending Scan until their paper invoices are attached. It will NOT create historical sales, stock movements, cash receipts, or deposits. Existing invoices will not be overwritten.'))return;
 setWorking(true);
 try{
  // Validate immediately before committing, in case another user imported the same invoices.
  const check=await window.BBARAdapter.rpc('bb_ar_migration_upload',{p_rows:batch,p_commit:false});
  if(!check.success){showResult(check);return}
  const result=await window.BBARAdapter.rpc('bb_ar_migration_upload',{p_rows:batch,p_commit:true});
  if(!result.success){showResult(result);return}
  status('SUCCESS: '+result.imported+' historical invoice(s) imported. Unattached outstanding invoices are now available in Pending Scan.');
  batch=null;previewOK=false;$('arMigrationFile').value='';$('arMigrationCommit').disabled=true;
  if(typeof window.loadAR==='function')await window.loadAR(true);
  else if(typeof loadAR==='function')await loadAR(true);
 }catch(e){status('Import not completed: '+e.message+'. If the connection failed, refresh A/R before trying again.',true);previewOK=false}
 finally{setWorking(false)}
}
function open(){const modal=$('arMigrationOverlay');modal.hidden=false;modal.style.display='flex';$('arMigrationFile').focus()}
function close(){if(working)return;$('arMigrationOverlay').hidden=true;$('arMigrationOverlay').style.display='none'}
function mount(){
 if($('arMigrationToolbar')||!document.querySelector('.topbar'))return;
 const style=document.createElement('style');
 style.textContent='#arMigrationToolbar{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:-4px 0 14px}#arMigrationOverlay{position:fixed;inset:0;background:#132940bd;z-index:11000;display:none;align-items:center;justify-content:center;padding:15px}#arMigrationOverlay[hidden]{display:none!important}.ar-mig-dialog{width:min(1050px,100%);max-height:94dvh;overflow:auto;background:#fff;border-radius:14px;padding:20px;box-shadow:0 22px 60px #07172c55}.ar-mig-buttons{display:flex;gap:10px;flex-wrap:wrap}.ar-mig-note{color:#52677c;font-size:12px;line-height:1.55}.ar-mig-table{max-height:320px;overflow:auto;border:1px solid #dbe3ed;border-radius:8px}.ar-mig-table table{min-width:760px}.ar-mig-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}.ar-mig-title h2{margin:0;color:#183e72;font-size:20px}@media(max-width:560px){.ar-mig-dialog{padding:13px}}';
 document.head.append(style);
 const toolbar=document.createElement('div');toolbar.id='arMigrationToolbar';
 toolbar.innerHTML='<button type="button" id="arMigrationOpen" class="btn primary">📤 Upload Historical A/R</button><button type="button" id="arMigrationDownload" class="btn secondary">📥 Download A/R Template</button>';
 document.querySelector('.topbar').insertAdjacentElement('afterend',toolbar);
 const div=document.createElement('div');div.id='arMigrationOverlay';div.hidden=true;
 div.setAttribute('role','dialog');div.setAttribute('aria-modal','true');div.setAttribute('aria-label','Upload historical receivables');
 div.innerHTML='<section class="ar-mig-dialog"><div class="ar-mig-title"><h2>📤 Upload Historical Accounts Receivable</h2><button id="arMigrationClose" class="btn secondary" type="button">✕ Close</button></div>'+
 '<p class="ar-mig-note">Admin only · Import OPENING receivable balances. Each customer must already exist in Master Database. Invoice numbers may repeat across different customers but never for the same customer.</p>'+
 '<p class="ar-mig-note"><strong>Important:</strong> previously paid amounts are opening-balance reference only. This import does not generate sales, stock deductions, cash collection, payment records, or income. Unattached outstanding invoices automatically enter Pending Scan.</p>'+
 '<div class="ar-mig-buttons"><button id="arMigrationModalDownload" type="button" class="btn secondary">📥 Download Template</button></div>'+
 '<div style="margin-top:14px"><label for="arMigrationFile" style="display:block;font-weight:700;font-size:13px;margin-bottom:7px">Choose completed Excel / CSV template</label><input id="arMigrationFile" type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div>'+
 '<div class="ar-mig-buttons" style="margin-top:12px"><button id="arMigrationPreviewButton" class="btn secondary" type="button" disabled>🔍 Preview & Validate</button><button id="arMigrationCommit" class="btn primary" type="button" disabled>✓ Confirm Import</button></div>'+
 '<p id="arMigrationStatus" role="status" class="ar-mig-note">Select a completed template to begin.</p><div id="arMigrationIssues"></div><div id="arMigrationTableWrap" class="ar-mig-table" hidden><table id="arMigrationTable"></table></div></section>';
 document.body.append(div);
 $('arMigrationOpen').onclick=open;$('arMigrationDownload').onclick=downloadTemplate;$('arMigrationModalDownload').onclick=downloadTemplate;
 $('arMigrationClose').onclick=close;
 div.addEventListener('click',e=>{if(e.target===div)close()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!div.hidden)close()});
 $('arMigrationFile').onchange=async e=>{
  batch=null;previewOK=false;$('arMigrationCommit').disabled=true;$('arMigrationTableWrap').hidden=true;$('arMigrationIssues').replaceChildren();
  try{batch=await readFile(e.target.files?.[0]);status('Loaded '+batch.length+' rows. Click Preview & Validate to check customer IDs, duplicate invoices and balances.')}
  catch(err){status(err.message,true)}
  $('arMigrationPreviewButton').disabled=!batch;
 };
 $('arMigrationPreviewButton').onclick=preview;$('arMigrationCommit').onclick=upload;
}
(async function(){
 try{
  const profile=await window.BBARAdapter.accessProfile('all');
  if(profile?.role==='admin'&&profile?.permissions?.canEdit)mount();
 }catch(e){console.warn('Historical A/R importer access check:',e)}
})();
})();