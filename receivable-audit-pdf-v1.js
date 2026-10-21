/* BIG BROTHER — A/R audit PDF: summary + one authorized original per invoice.
 * No transaction/database mutations. Attachment bytes stay in browser memory.
 * Invoice HTML/CSS below are copied from the production Invoice History renderer.
 */
(function(){
'use strict';
const BUCKET='bb-real-invoices';
const PDF_LIB_URLS=[
 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js'
];
const A4=[595.28,841.89], MARGIN=12;
let busy=false;
const $=id=>document.getElementById(id);
const label=row=>(String(row.customer||'Customer')+' / '+String(row.invoiceNo||'Invoice'));
function fail(message){throw new Error(message);}
function show(message,error){
 const status=$('bbAuditPdfStatus');
 if(status){status.textContent=message||'';status.style.color=error?'#a52d2d':'#315a7e';}
}
function buttonBusy(on){
 busy=on;
 const btn=$('bbAuditPdfSave');
 if(btn){btn.disabled=on;btn.textContent=on?'⏳ Preparing audit PDF…':'📑 Save PDF + Invoices';}
}
function selectedRows(){
 if(typeof selectedSummaryRows!=='function')fail('The A/R selection is not available.');
 const picked=selectedSummaryRows();
 if(!picked.length)fail('Select outstanding invoices before exporting.');
 const ids=new Set();
 for(const row of picked){
  const id=String(row.invoiceId||'').trim();
  if(!id)fail('Invoice '+label(row)+' has no internal invoice ID. The PDF cannot be matched safely.');
  if(ids.has(id))fail('Duplicate internal invoice ID '+id+' in the selected rows.');
  ids.add(id);
 }
 return picked;
}
async function rpc(name,args){
 if(!window.BBARAdapter?.rpc)fail('The secure A/R database connection is unavailable.');
 return window.BBARAdapter.rpc(name,args);
}
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function loadPdfLib(){
 if(window.PDFLib?.PDFDocument)return window.PDFLib;
 for(const url of PDF_LIB_URLS){
  try{
   await new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=url;script.crossOrigin='anonymous';script.async=true;
    const timer=setTimeout(()=>{script.remove();reject(Error('PDF library timed out.'));},15000);
    script.onload=()=>{clearTimeout(timer);resolve();};
    script.onerror=()=>{clearTimeout(timer);script.remove();reject(Error('PDF library could not load.'));};
    document.head.appendChild(script);
   });
   if(window.PDFLib?.PDFDocument)return window.PDFLib;
  }catch(error){console.warn('A/R audit PDF library:',error);}
 }
 fail('PDF library is unavailable. Connect to the internet and try again.');
}
function ext(path){return String(path||'').split('?')[0].split('.').pop().toLowerCase();}
async function storedBlob(entry,row){
 if(!entry?.path)fail('Stored invoice path is missing for '+label(row));
 if(!window.BBARAdapter?.authenticatedFetch)fail('Private invoice storage access is unavailable.');
 await window.BBARAdapter.ensureSession();
 const path=String(entry.path).split('/').map(encodeURIComponent).join('/');
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),25000);
 let response;
 try{
  response=await window.BBARAdapter.authenticatedFetch(
   '/storage/v1/object/authenticated/'+BUCKET+'/'+path,
   {cache:'no-store',signal:controller.signal}
  );
 }catch(error){
  if(error?.name==='AbortError')fail('Invoice download timed out for '+label(row));
  throw error;
 }finally{clearTimeout(timer);}
 if(!response.ok)fail('Could not access the stored invoice for '+label(row)+' ('+response.status+').');
 const blob=await response.blob();
 if(!blob.size)fail('Stored invoice file is empty for '+label(row));
 return blob;
}
function imageFromBlob(blob){
 return new Promise((resolve,reject)=>{
  const url=URL.createObjectURL(blob),img=new Image();
  img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};
  img.onerror=()=>{URL.revokeObjectURL(url);reject(Error('Cannot decode the invoice image.'));};
  img.src=url;
 });
}
async function imagePng(blob){
 const img=await imageFromBlob(blob);
 const canvas=document.createElement('canvas');
 const maxSide=3200,scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));
 canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
 canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
 const ctx=canvas.getContext('2d');
 ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.drawImage(img,0,0,canvas.width,canvas.height);
 return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Image conversion failed.')),'image/png'));
}
async function addPicture(pdf,blob,type,path){
 let prepared=blob;
 const kind=String(type||blob.type||'').toLowerCase();
 const suffix=ext(path);
 let img;
 if(kind.includes('jpeg')||kind.includes('jpg')||suffix==='jpg'||suffix==='jpeg'){
  img=await pdf.embedJpg(await prepared.arrayBuffer());
 }else if(kind.includes('png')||suffix==='png'){
  img=await pdf.embedPng(await prepared.arrayBuffer());
 }else{
  prepared=await imagePng(blob);
  img=await pdf.embedPng(await prepared.arrayBuffer());
 }
 const page=pdf.addPage(A4), size=page.getSize();
 const ratio=Math.min((size.width-2*MARGIN)/img.width,(size.height-2*MARGIN)/img.height);
 const width=img.width*ratio,height=img.height*ratio;
 page.drawImage(img,{x:(size.width-width)/2,y:(size.height-height)/2,width,height});
}
async function addOriginal(pdf,blob,entry,row){
 const mime=String(entry.mimeType||blob.type||'').toLowerCase();
 if(mime.includes('pdf')||ext(entry.path)==='pdf'){
  let source;
  try{source=await window.PDFLib.PDFDocument.load(await blob.arrayBuffer());}
  catch(error){fail('The original PDF for '+label(row)+' is unreadable: '+error.message);}
  if(!source.getPageCount())fail('Original PDF has no pages for '+label(row));
  // Preserve every source page. Never discard an auditor's evidence.
  const pages=await pdf.copyPages(source,source.getPageIndices());
  pages.forEach(page=>pdf.addPage(page));
  return pages.length;
 }
 if(!['jpg','jpeg','png','webp','bmp','gif'].includes(ext(entry.path)) &&
    !mime.startsWith('image/'))fail('Unsupported original invoice format for '+label(row));
 await addPicture(pdf,blob,mime,entry.path);
 return 1;
}
function escapeHtml(value){return String(value??'')
 .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
 .replace(/"/g,'&quot;').replace(/'/g,'&#039;');}
function numberValue(value){const n=Number(value);return Number.isFinite(n)?n:0;}
// BEGIN exact Invoice History renderer
function historyMoney(value, currency) {
    const n = numberValue(value);
    if (String(currency || "USD").toUpperCase() === "KHR") return "៛" + Math.round(n).toLocaleString("en-US");
    return "$" + n.toLocaleString("en-US", {minimumFractionDigits:2, maximumFractionDigits:2});
  }

  function historyMoneyAccounting(value, currency) {
    const n = numberValue(value);
    const isKhr = String(currency || "USD").toUpperCase() === "KHR";
    const symbol = isKhr ? "៛" : "$";
    const amount = isKhr
      ? Math.round(n).toLocaleString("en-US")
      : n.toLocaleString("en-US", {minimumFractionDigits:2, maximumFractionDigits:2});
    return `<span class="history-money-accounting"><span class="history-money-symbol">${symbol}</span><span class="history-money-number">${amount}</span></span>`;
  }

  function historyUnitPriceAccounting(value, currency) {
    const n = numberValue(value);
    const isKhr = String(currency || "USD").toUpperCase() === "KHR";
    const symbol = isKhr ? "៛" : "$";
    const amount = isKhr
      ? Math.round(n).toLocaleString("en-US")
      : n.toLocaleString("en-US", {minimumFractionDigits:4, maximumFractionDigits:4});
    return `<span class="history-money-accounting"><span class="history-money-symbol">${symbol}</span><span class="history-money-number">${amount}</span></span>`;
  }

  function historyDate(value) {
    if (!value) return "";
    const raw = String(value).trim();
    const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return raw.split("T")[0] || raw;
    const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${String(m[3]).padStart(2,"0")}-${months[Number(m[2])-1] || m[2]}-${m[1]}`;
  }

  function buildHistoryInvoiceHtml(invoice) {
    const esc=escapeHtml;
    const currency=String(invoice.currency || "USD").toUpperCase();
    const money=value=>historyMoney(value,currency);
    const accountingMoney=value=>historyMoneyAccounting(value,currency);
    const items=Array.isArray(invoice.items)?invoice.items:[];
    const outstanding=Math.max(0,numberValue(invoice.outstanding));
    const discount=Math.max(0,numberValue(invoice.discount));
    const amountPaid=Math.max(0,numberValue(invoice.amountPaid));
    const exchangeRate=numberValue(invoice.exchangeRate);
    const rows=items.length?items.map((item,index)=>`
      <tr><td>${index+1}</td><td><div class="history-final-desc">${esc(item.productName || item.productCode || "")}</div>${item.productBarcode||item.barcode?`<span class="history-final-barcode">Barcode: ${esc(item.productBarcode||item.barcode)}</span>`:""}${item.productNote?`<span class="history-final-product-note">Note: ${esc(item.productNote)}</span>`:""}</td><td><div class="history-final-qty-unit">${numberValue(item.qty).toLocaleString("en-US",{maximumFractionDigits:2})}${item.unit?`<span class="history-final-unit-small">/${esc(item.unit)}</span>`:""}</div></td><td>${historyUnitPriceAccounting(item.price,currency)}</td><td>${accountingMoney(item.total)}</td></tr>`).join(""):`<tr><td colspan="5" style="text-align:center;padding:18px">No products found</td></tr>`;

    const summary=[];
    if(discount>0){
      summary.push(`<div class="history-final-summary-row"><span class="history-final-summary-label">Subtotal</span><span class="history-final-summary-value">${accountingMoney(invoice.subtotal)}</span></div>`);
      summary.push(`<div class="history-final-summary-row"><span class="history-final-summary-label">Discount</span><span class="history-final-summary-value">-${accountingMoney(discount)}</span></div>`);
    }
    summary.push(`<div class="history-final-summary-row grand"><span>Grand Total</span><span class="history-final-summary-value">${accountingMoney(invoice.grandTotal)}</span></div>`);
    summary.push(`<div class="history-final-summary-row"><span class="history-final-summary-label">Amount Paid</span><span class="history-final-summary-value">${accountingMoney(amountPaid)}</span></div>`);
    if(outstanding>0) summary.push(`<div class="history-final-summary-row credit"><span class="history-final-summary-label">Credit Amount</span><span class="history-final-summary-value">${accountingMoney(outstanding)}</span></div>`);

    const noteHtml=String(invoice.note||"").trim()?String(invoice.note).split(/\r?\n/).map(line=>`<div class="history-final-note-line">${esc(line)}</div>`).join(""):`<div class="history-final-note-line">&nbsp;</div>`;
    const bankInfo=[invoice.bankPayment?`Bank Payment: ${esc(invoice.bankPayment)}`:"",invoice.bankReference?`Reference: ${esc(invoice.bankReference)}`:""].filter(Boolean).join("<br>");

    return `<div class="history-final-invoice" id="historyInvoiceDocument">
      <div class="history-final-header"><div class="history-final-company"><div class="history-final-company-name">BIG BROTHER</div><div class="history-final-company-tagline">Ready to be your partner</div></div><div class="history-final-header-message"><div>Better Products</div><div>A Brighter Tomorrow</div></div></div>
      <div class="history-final-title-line"></div><div class="history-final-title">INVOICE</div>
      <div class="history-final-bill-row"><div class="history-final-bill"><div class="history-final-bill-label">Bill To</div><div class="history-final-bill-detail-row"><div class="history-final-bill-detail-label">Name</div><div>:</div><div>${esc(invoice.customer||"")}</div></div><div class="history-final-bill-detail-row"><div class="history-final-bill-detail-label">Location</div><div>:</div><div>${esc(invoice.address||"")}</div></div><div class="history-final-bill-detail-row"><div class="history-final-bill-detail-label">Phone Number</div><div>:</div><div>${esc(invoice.phone||"")}</div></div></div><div class="history-final-shipping"><div class="history-final-shipping-label">Shipping To</div><div class="history-final-shipping-value">${esc(invoice.shippingTo||"")}</div></div><div class="history-final-meta"><div class="history-final-meta-no">${esc(invoice.invoiceNo||"")}</div><div class="history-final-meta-date">Invoice Date: ${esc(historyDate(invoice.invoiceDate))}</div>${outstanding>0?`<div class="history-final-meta-date">Due Date: ${esc(historyDate(invoice.dueDate||invoice.invoiceDate))}</div>`:""}</div></div>
      <table class="history-final-table"><thead><tr><th>N.o.</th><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="history-final-bottom-grid"><div class="history-final-notes"><div class="history-final-notes-title">Note:</div>${noteHtml}</div><div class="history-final-summary">${summary.join("")}</div></div>
      <div class="history-final-payment-box"><div class="history-final-transaction-label">Payment Method</div><div>${esc(invoice.paymentMethod||"")}</div></div>
      ${bankInfo?`<div class="history-final-bank"><div class="history-final-bank-title">Banking Details</div>${bankInfo}</div>`:""}
      <div class="history-final-signature-grid">
        <div class="history-final-signature-column">
          <div class="history-final-signature-name-row"><div class="history-final-signature-label">Customer Name</div><div class="history-final-signature-value">${esc(invoice.customer||"")}</div></div>
          <div class="history-final-signature-line"><div class="history-final-signature-line-title">Signature</div><div class="history-final-signature-blank"></div></div>
        </div>
        <div class="history-final-signature-column">
          <div class="history-final-signature-name-row"><div class="history-final-signature-label">Sale Person</div><div class="history-final-signature-value">${esc(invoice.salesperson||"")}</div></div>
          <div class="history-final-signature-line"><div class="history-final-signature-line-title">Sale Signature</div><div class="history-final-signature-blank"></div></div>
        </div>
      </div><div class="history-final-footer-space"></div></div>`;
  }
// END exact Invoice History renderer
const historyCSS=".history-final-invoice{width:min(794px,100%);max-width:794px;margin:0 auto;background:#fff;color:#222;border:1px solid #8f8f8f;padding:28px 30px 26px;font-family:Arial,sans-serif;overflow:hidden}\n    .history-final-invoice *{box-sizing:border-box}\n    .history-final-header{display:flex;justify-content:space-between;align-items:flex-start;gap:25px;min-height:78px}\n    .history-final-company{font-size:14px;line-height:1.55}.history-final-company-name{font-size:22px;font-weight:800;letter-spacing:1.2px;color:#174a91;margin-bottom:5px}.history-final-currency{text-align:right;font-size:12px;color:#555;padding-top:4px;line-height:1.45;white-space:nowrap}\n    .history-final-title-line{border-top:2px solid #222;margin:10px 0 16px}.history-final-title{text-align:center;font-size:31px;font-weight:800;color:#2867b2;margin:0 0 18px}\n    .history-final-bill-row{display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:20px;margin-bottom:18px;min-height:72px}.history-final-bill{font-size:14px;line-height:1.45;min-width:0}.history-final-bill-label{font-weight:800;margin-bottom:5px}.history-final-meta{text-align:right;color:#2867b2;min-width:0}.history-final-meta-no{font-size:23px;font-weight:800}.history-final-meta-date{margin-top:5px;font-size:14px;font-weight:700}\n    .history-final-table{width:100%!important;max-width:100%!important;min-width:0!important;border-collapse:collapse;table-layout:fixed;font-size:13px}\n    .history-final-table th{background:#4472b9;color:#fff;border:1px solid #6f88aa;padding:7px 8px;text-align:left;font-weight:800;white-space:normal}\n    .history-final-table th:nth-child(1){width:7%;text-align:center}.history-final-table th:nth-child(2){width:48%}.history-final-table th:nth-child(3){width:11%;text-align:center}.history-final-table th:nth-child(4){width:17%;text-align:center}.history-final-table th:nth-child(5){width:17%;text-align:center}\n    .history-final-table td{border:1px solid #999;padding:8px;vertical-align:top;height:42px;white-space:normal;overflow-wrap:anywhere}.history-final-table td:first-child{text-align:center}.history-final-table td:nth-child(3),.history-final-table td:nth-child(4),.history-final-table td:nth-child(5){text-align:center;white-space:nowrap}\n    .history-final-desc{font-weight:700}.history-final-unit{display:block;margin-top:4px;font-size:11px;color:#555;font-weight:400;font-style:italic}.history-final-barcode,.history-final-product-note{display:block;margin-top:3px;font-size:10.5px;color:#555;font-weight:400}.history-final-product-note{font-style:italic}.history-final-qty-unit{white-space:nowrap;font-weight:400}.history-final-qty-unit .history-final-unit-small{font-size:7px;font-weight:400;margin-left:1px;vertical-align:baseline}\n    .history-final-bottom-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,330px);gap:28px;margin-top:14px;align-items:start}.history-final-notes{min-height:78px;border-top:1px solid #9aa8b8;padding-top:6px;font-size:12px;line-height:1.65}.history-final-notes-title{font-weight:800;margin-bottom:4px}.history-final-note-line{min-height:18px}.history-final-summary{width:100%;font-size:13px}.history-final-summary-row{display:flex;justify-content:space-between;gap:15px;padding:5px 8px;border-bottom:1px solid #bfc7d1}.history-final-summary-row.grand{background:#4472b9;color:#fff;font-size:15px;font-weight:800;border-bottom:0}.history-final-summary-row.credit{color:#c56b00;font-weight:700}.history-final-summary-label{font-weight:700}.history-final-summary-value{text-align:right;white-space:nowrap}\n    .history-final-payment-box{width:48%;margin-top:14px;border:1px solid #999;padding:10px 12px;min-height:66px;font-size:12px}.history-final-transaction-label{font-weight:800;margin-bottom:7px}.history-final-bank{border:1px solid #999;margin-top:12px;padding:9px 12px;min-height:54px;font-size:12px;line-height:1.5}.history-final-bank-title{font-weight:800;margin-bottom:3px}.history-final-signature-grid{display:grid;grid-template-columns:1fr 1fr;gap:42px;margin-top:28px;padding-top:4px;font-size:12px}.history-final-signature-column{min-width:0}.history-final-signature-name-row{display:grid;grid-template-columns:auto 1fr;gap:14px;align-items:end;min-height:24px;padding-bottom:6px;border-bottom:1px solid #777}.history-final-signature-label{font-weight:800;white-space:nowrap}.history-final-signature-value{min-width:0;overflow-wrap:anywhere}.history-final-signature-line{margin-top:14px}.history-final-signature-line-title{font-weight:800;margin-bottom:7px}.history-final-signature-blank{height:30px;border-bottom:1px solid #777}.history-final-footer-space{height:8px}\n\n    \n.history-money-accounting{\n  display:grid!important;\n  grid-template-columns:auto 1fr!important;\n  align-items:baseline!important;\n  width:100%!important;\n  gap:8px!important;\n  white-space:nowrap!important;\n}\n.history-final-invoice .history-money-symbol{\n  text-align:left!important;\n  font-weight:inherit!important;\n}\n.history-final-invoice .history-money-number{\n  text-align:right!important;\n  font-weight:inherit!important;\n}\n.history-final-invoice .history-final-table td:nth-child(4),\n.history-final-invoice .history-final-table td:nth-child(5){\n  text-align:left!important;\n}\n.history-final-invoice .history-final-summary-value{\n  min-width:112px!important;\n}\n\n\n\n.bb-audit-capture .history-final-invoice{width:794px!important;max-width:794px!important;box-sizing:border-box!important}\n.bb-audit-capture,.bb-audit-capture *{box-sizing:border-box}\n";
let styleNode=null;
function injectHistoryStyle(){
 if(styleNode)return;
 styleNode=document.createElement('style');
 styleNode.id='bbAuditHistoryStyles';
 styleNode.textContent=historyCSS;
 document.head.appendChild(styleNode);
}
async function digitalPng(invoice,row){
 if(typeof html2canvas!=='function')fail('The invoice image renderer is not available.');
 if(!Array.isArray(invoice.items)||!invoice.items.length){
  fail('Invoice History has no product details for '+label(row)+'. Export stopped to avoid incomplete evidence.');
 }
 injectHistoryStyle();
 const wrapper=document.createElement('div');
 wrapper.className='bb-audit-capture';
 wrapper.style.cssText='position:fixed;left:-100000px;top:0;width:794px;background:#fff;z-index:-1;';
 wrapper.innerHTML=buildHistoryInvoiceHtml(invoice);
 document.body.appendChild(wrapper);
 try{
  if(document.fonts?.ready)await Promise.race([document.fonts.ready,delay(3000)]);
  const node=wrapper.querySelector('#historyInvoiceDocument');
  if(!node)fail('Invoice template did not render for '+label(row));
  const height=Math.max(node.scrollHeight,1);
  const canvas=await html2canvas(node,{
   backgroundColor:'#fff',scale:height>2200?1.25:2,useCORS:true,logging:false
  });
  return await new Promise((resolve,reject)=>canvas.toBlob(
   b=>b?resolve(b):reject(Error('Digital invoice image could not be created.')),
   'image/png'
  ));
 }finally{wrapper.remove();}
}
async function digitalInvoice(pdf,row){
 const id=String(row.invoiceId);
 const result=await rpc('bb_sales_history_detail_by_id',{p_invoice_id:id});
 const invoice=result?.invoice;
 if(!invoice||String(invoice.invoiceId||'')!==id){
  fail('No matching Invoice History detail for '+label(row)+'. Export stopped.');
 }
 if(String(invoice.invoiceNo||'').trim()!==String(row.invoiceNo||'').trim()){
  fail('Invoice number changed for '+label(row)+'. Refresh A/R before exporting.');
 }
 if(row.customerId&&invoice.customerId&&String(row.customerId)!==String(invoice.customerId)){
  fail('Customer mismatch on invoice '+label(row)+'. Export stopped.');
 }
 const image=await digitalPng(invoice,row);
 await addPicture(pdf,image,'image/png',id+'.png');
}
async function findAttachment(id,map){
 if(map.has(id))return map.get(id);
 // Existing A/R viewer uses this authenticated ID-based lookup.
 const doc=await rpc('bb_real_invoice_existing',{p_id:id});
 return doc?.path?doc:null;
}
function fileName(picked){
 const customers=[...new Set(picked.map(r=>String(r.customer||'Customer').trim()))];
 const one=customers.length===1?customers[0]:'Multi_Customer';
 const safe=String(one||'Customer').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,55)||'Customer';
 const date=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Phnom_Penh'});
 return 'BIG_BROTHER_AR_Audit_'+safe+'_'+date+'.pdf';
}
async function exportAudit(event){
 event?.preventDefault();event?.stopPropagation();
 if(busy)return;
 let pdf;
 try{
  buttonBusy(true);
  const picked=selectedRows(); // fixed selection snapshot, same A/R summary
  const ids=picked.map(r=>String(r.invoiceId));
  show('Checking '+picked.length+' selected invoice(s)…');
  const [PDFLib,summaryBlob,manifest]=await Promise.all([
   loadPdfLib(),createSummaryImageBlob(),
   rpc('bb_ar_original_manifest',{p_invoice_ids:ids})
  ]);
  if(!Array.isArray(manifest))fail('Could not verify authorized original invoices.');
  const manifestMap=new Map(manifest.filter(r=>r?.invoiceId&&r?.path).map(r=>[String(r.invoiceId),r]));
  pdf=await PDFLib.PDFDocument.create();
  pdf.setTitle('BIG BROTHER A/R Audit Summary + Supporting Invoices');
  pdf.setSubject('Outstanding invoice evidence');
  await addPicture(pdf,summaryBlob,'image/png','summary.png');
  let originals=0,digitals=0,multiPage=0;
  for(let i=0;i<picked.length;i++){
   const row=picked[i],id=String(row.invoiceId);
   show('Adding invoice '+(i+1)+' of '+picked.length+': '+label(row));
   const entry=await findAttachment(id,manifestMap);
   if(entry?.path){
    const count=await addOriginal(pdf,await storedBlob(entry,row),entry,row);
    originals++;if(count>1)multiPage++;
   }else{
    await digitalInvoice(pdf,row);
    digitals++;
   }
   await delay(0);
  }
  show('Finishing '+pdf.getPageCount()+' PDF page(s)…');
  const bytes=await pdf.save({useObjectStreams:true});
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
  const anchor=document.createElement('a');
  anchor.href=url;anchor.download=fileName(picked);
  document.body.appendChild(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  show('Saved: '+picked.length+' invoice(s), '+originals+' stored original(s), '+digitals+' rendered digital invoice(s).'+(multiPage?' '+multiPage+' original PDF(s) contained multiple pages.':''));
 }catch(error){
  console.error('A/R audit PDF:',error);
  show(error?.message||'Audit PDF could not be prepared.',true);
  alert('Audit PDF was not saved.\n\n'+(error?.message||'Please retry.')+'\n\nNo incomplete audit PDF was produced.');
 }finally{buttonBusy(false);pdf=null;}
}
function install(){
 const actions=document.querySelector('#summaryOverlay .summary-actions');
 if(!actions)return;
 if($('bbAuditPdfSave'))return;
 actions.style.flexWrap='wrap';
 const legacy=$('printSavePdfBtn');
 if(!legacy)return;
 const print=document.createElement('button');
 print.type='button';print.className='btn secondary';print.textContent='🖨 Print Summary';
 print.addEventListener('click',()=>printSummary());
 // Keep existing print support, but make the primary PDF operation include evidence.
 legacy.removeAttribute('onclick');legacy.onclick=null;
 legacy.id='bbAuditPdfSave';legacy.textContent='📑 Save PDF + Invoices';
 legacy.addEventListener('click',exportAudit);
 legacy.parentNode.insertBefore(print,legacy.nextSibling);
 const note=document.createElement('div');
 note.id='bbAuditPdfStatus';note.setAttribute('role','status');
 note.style.cssText='flex-basis:100%;font-size:12px;line-height:1.5;text-align:right;min-height:15px';
 actions.appendChild(note);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);
else install();
window.BBARAuditPdfExport={save:exportAudit,selectedRows};
})();