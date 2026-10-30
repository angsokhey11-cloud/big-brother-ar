/* BIG BROTHER — A/R audit PDF: summary + one authorized original per invoice.
 * No transaction/database mutations. Attachment bytes stay in browser memory.
 * Invoice HTML/CSS below are copied from the production Invoice History renderer.
 */
(function(){
'use strict';
const BUCKET='bb-real-invoices';
const PDF_LIB_URLS=[
 // Local Code Sync copies this file into Local Brain; CDN fallback is for Live only.
 'vendor/pdf-lib.min.js?v=20261021-local-pdf1',
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
 const save=$('bbAuditPdfSave'),share=$('bbShareCustomerPdf');
 if(save){save.disabled=on;save.textContent=on?'⏳ Preparing PDF…':'📑 Save PDF + Invoices';}
 if(share){share.disabled=on;share.textContent=on?'⏳ Preparing PDF…':'✈️ Share PDF to Telegram';}
}
function selectedRows(){
 if(typeof summaryExportRows!=='function')fail('The Summary Invoice selection is not available.');
 // The open modal owns the selected rows: auto-refresh no longer changes
 // its PDF export source while the user is reviewing an A4 summary.
 const picked=summaryExportRows();
 if(!picked.length)fail('No open Summary Invoice. Check invoices and open Summary again.');
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
/* The summary and digital invoice render through html2canvas.
 * Its existing CDN script may not load on a completely offline LAN.
 * html2pdf's locally bundled html2canvas provides the same canvas API fallback.
 */
async function ensureCanvasAvailable(){
 if(typeof window.html2canvas==='function')return;
 if(typeof window.html2pdf!=='function'){
  await new Promise((resolve,reject)=>{
   const script=document.createElement('script');
   script.src='vendor/html2pdf.bundle.min.js?v=20261021-local-pdf1';
   script.async=true;
   const timer=setTimeout(()=>{
    script.remove();
    reject(Error('The offline invoice image renderer timed out.'));
   },18000);
   script.onload=()=>{clearTimeout(timer);resolve();};
   script.onerror=()=>{
    clearTimeout(timer);script.remove();
    reject(Error('The offline invoice image renderer could not load. Run Code Sync and reopen A/R.'));
   };
   document.head.appendChild(script);
  });
 }
 if(typeof window.html2pdf!=='function'){
  fail('The offline canvas renderer is unavailable. Run Local Brain Code Sync.');
 }
 // html2pdf bundles html2canvas; map its canvas output to our existing call site.
 window.html2canvas=function(element,options){
  return window.html2pdf().set({
   margin:0,
   html2canvas:options||{},
   pagebreak:{mode:[]}
  }).from(element).toCanvas().get('canvas');
 };
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
const historyCSS=".history-final-invoice{width:min(794px,100%);max-width:794px;margin:0 auto;background:#fff;color:#222;border:1px solid #8f8f8f;padding:28px 30px 26px;font-family:Arial,sans-serif;overflow:hidden}\n    .history-final-invoice *{box-sizing:border-box}\n    .history-final-header{display:flex;justify-content:space-between;align-items:flex-start;gap:25px;min-height:78px}\n    .history-final-company{font-size:14px;line-height:1.55}.history-final-company-name{font-size:22px;font-weight:800;letter-spacing:1.2px;color:#174a91;margin-bottom:5px}.history-final-currency{text-align:right;font-size:12px;color:#555;padding-top:4px;line-height:1.45;white-space:nowrap}\n    .history-final-title-line{border-top:2px solid #222;margin:10px 0 16px}.history-final-title{text-align:center;font-size:31px;font-weight:800;color:#2867b2;margin:0 0 18px}\n    .history-final-bill-row{display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:20px;margin-bottom:18px;min-height:72px}.history-final-bill{font-size:14px;line-height:1.45;min-width:0}.history-final-bill-label{font-weight:800;margin-bottom:5px}.history-final-meta{text-align:right;color:#2867b2;min-width:0}.history-final-meta-no{font-size:23px;font-weight:800}.history-final-meta-date{margin-top:5px;font-size:14px;font-weight:700}\n    .history-final-table{width:100%!important;max-width:100%!important;min-width:0!important;border-collapse:collapse;table-layout:fixed;font-size:13px}\n    .history-final-table th{background:#4472b9;color:#fff;border:1px solid #6f88aa;padding:7px 8px;text-align:left;font-weight:800;white-space:normal}\n    .history-final-table th:nth-child(1){width:7%;text-align:center}.history-final-table th:nth-child(2){width:48%}.history-final-table th:nth-child(3){width:11%;text-align:center}.history-final-table th:nth-child(4){width:17%;text-align:center}.history-final-table th:nth-child(5){width:17%;text-align:center}\n    .history-final-table td{border:1px solid #999;padding:8px;vertical-align:top;height:42px;white-space:normal;overflow-wrap:anywhere}.history-final-table td:first-child{text-align:center}.history-final-table td:nth-child(3),.history-final-table td:nth-child(4),.history-final-table td:nth-child(5){text-align:center;white-space:nowrap}\n    .history-final-desc{font-weight:700}.history-final-unit{display:block;margin-top:4px;font-size:11px;color:#555;font-weight:400;font-style:italic}.history-final-barcode,.history-final-product-note{display:block;margin-top:3px;font-size:10.5px;color:#555;font-weight:400}.history-final-product-note{font-style:italic}.history-final-qty-unit{white-space:nowrap;font-weight:400}.history-final-qty-unit .history-final-unit-small{font-size:7px;font-weight:400;margin-left:1px;vertical-align:baseline}\n    .history-final-bottom-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,330px);gap:28px;margin-top:14px;align-items:start}.history-final-notes{min-height:78px;border-top:1px solid #9aa8b8;padding-top:6px;font-size:12px;line-height:1.65}.history-final-notes-title{font-weight:800;margin-bottom:4px}.history-final-note-line{min-height:18px}.history-final-summary{width:100%;font-size:13px}.history-final-summary-row{display:flex;justify-content:space-between;gap:15px;padding:5px 8px;border-bottom:1px solid #bfc7d1}.history-final-summary-row.grand{background:#4472b9;color:#fff;font-size:15px;font-weight:800;border-bottom:0}.history-final-summary-row.credit{color:#c56b00;font-weight:700}.history-final-summary-label{font-weight:700}.history-final-summary-value{text-align:right;white-space:nowrap}\n    .history-final-payment-box{width:48%;margin-top:14px;border:1px solid #999;padding:10px 12px;min-height:66px;font-size:12px}.history-final-transaction-label{font-weight:800;margin-bottom:7px}.history-final-bank{border:1px solid #999;margin-top:12px;padding:9px 12px;min-height:54px;font-size:12px;line-height:1.5}.history-final-bank-title{font-weight:800;margin-bottom:3px}.history-final-signature-grid{display:grid;grid-template-columns:1fr 1fr;gap:42px;margin-top:28px;padding-top:4px;font-size:12px}.history-final-signature-column{min-width:0}.history-final-signature-name-row{display:grid;grid-template-columns:auto 1fr;gap:14px;align-items:end;min-height:24px;padding-bottom:6px;border-bottom:1px solid #777}.history-final-signature-label{font-weight:800;white-space:nowrap}.history-final-signature-value{min-width:0;overflow-wrap:anywhere}.history-final-signature-line{margin-top:14px}.history-final-signature-line-title{font-weight:800;margin-bottom:7px}.history-final-signature-blank{height:30px;border-bottom:1px solid #777}.history-final-footer-space{height:8px}\n\n    \n.history-money-accounting{\n  display:grid!important;\n  grid-template-columns:auto 1fr!important;\n  align-items:baseline!important;\n  width:100%!important;\n  gap:8px!important;\n  white-space:nowrap!important;\n}\n.history-final-invoice .history-money-symbol{\n  text-align:left!important;\n  font-weight:inherit!important;\n}\n.history-final-invoice .history-money-number{\n  text-align:right!important;\n  font-weight:inherit!important;\n}\n.history-final-invoice .history-final-table td:nth-child(4),\n.history-final-invoice .history-final-table td:nth-child(5){\n  text-align:left!important;\n}\n.history-final-invoice .history-final-summary-value{\n  min-width:112px!important;\n}\n\n\n\n.bb-audit-capture .history-final-invoice{width:794px!important;max-width:794px!important;box-sizing:border-box!important}\n.bb-audit-capture,.bb-audit-capture *{box-sizing:border-box}\n.bb-audit-capture .history-final-bill-detail-row,.bb-audit-capture .history-final-signature-value,.bb-audit-capture .history-final-desc,.bb-audit-capture .history-final-invoice td{font-family:Arial,'Noto Sans Khmer',sans-serif;line-height:1.65}\n";
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
 // Android WebView often cannot render elements positioned 100,000px outside
 // the viewport. Keep the private invoice renderer in the viewport but behind
 // the visible modal (never expose or change the customer-facing A4 document).
 wrapper.style.cssText='position:fixed;left:0;top:0;width:794px;background:#fff;z-index:-1;pointer-events:none;overflow:visible;';
 wrapper.innerHTML=buildHistoryInvoiceHtml(invoice);
 document.body.appendChild(wrapper);
 try{
  if(document.fonts?.ready)await Promise.race([document.fonts.ready,delay(3000)]);
  const node=wrapper.querySelector('#historyInvoiceDocument');
  if(!node)fail('Invoice template did not render for '+label(row));
  const height=Math.max(node.scrollHeight,1);
  const canvas=await html2canvas(node,{
   backgroundColor:'#fff',scale:height>2200?1.1:1.5,useCORS:true,logging:false,
   windowWidth:Math.max(794,document.documentElement.clientWidth)
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

/* Customer-facing names must come from selected invoices, never from today's export date. */
let preparedPdf=null;
function customerNames(picked){
 const names=new Map();
 picked.forEach(row=>{
  const name=String(row.customer||'').normalize('NFC').trim();
  if(!name)fail('A selected invoice is missing its customer name.');
  const key=name.toLocaleLowerCase();
  if(!names.has(key))names.set(key,name);
 });
 return [...names.values()];
}
function safeFilePart(value){
 return String(value||'').normalize('NFC')
  .replace(/[\/\\:*?"<>|\u0000-\u001f\u007f]/g,' ')
  .replace(/\s+/g,' ').replace(/^\.+|\.+$/g,'').trim();
}
function customerNameForFile(picked){
 const names=customerNames(picked).map(safeFilePart);
 let out='',shown=0;
 for(const name of names){
  const candidate=out?out+', '+name:name;
  if([...candidate].length>155)break;
  out=candidate;shown++;
 }
 if(!shown){
  out=[...names[0]].slice(0,145).join('');shown=1;
 }
 if(shown<names.length)out+=', +'+(names.length-shown)+' more customers';
 return out||'Customer';
}
function invoiceDatePart(value){
 if(typeof receivableDateParts!=='function')fail('The A/R invoice date formatter is unavailable.');
 const p=receivableDateParts(value);
 if(!p)fail('A selected invoice is missing an invoice date.');
 const check=new Date(Date.UTC(p.year,p.month-1,p.day));
 if(p.year<1900||p.year>2200||check.getUTCFullYear()!==p.year||
    check.getUTCMonth()+1!==p.month||check.getUTCDate()!==p.day){
  fail('One selected invoice has an invalid invoice date: '+String(value));
 }
 return {
  key:p.year*10000+p.month*100+p.day,
  label:String(p.day)+'-'+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][p.month-1]+'-'+p.year
 };
}
function fileName(picked){
 const dates=new Map();
 picked.forEach(row=>{
  let p;
  try{p=invoiceDatePart(row.invoiceDate);}
  catch(error){fail((error.message||'Invoice date error')+' ('+label(row)+')');}
  dates.set(p.key,p.label);
 });
 const keys=[...dates.keys()].sort((a,b)=>a-b);
 if(!keys.length)fail('No invoice dates were found.');
 const datePart=keys.length===1
  ? 'Invoice Date '+dates.get(keys[0])
  : 'Invoice Date from '+dates.get(keys[0])+' to '+dates.get(keys[keys.length-1]);
 return customerNameForFile(picked)+' and '+datePart+'.pdf';
}
function selectionSignature(picked){
 // The summary HTML and selected accounting balances make stale cached PDFs detectable.
 return JSON.stringify({
  invoices:picked.map(row=>[
   row.invoiceId,row.invoiceNo,row.customerId,row.customer,row.invoiceDate,
   row.currency,row.grandTotal,row.amountPaid,row.outstanding,row.locationCode
  ]),
  summary:$('summarySheet')?.innerHTML||''
 });
}
async function downloadFile(file){
 const adapter=window.BBARFileActionsV1;
 if(adapter)return adapter.save(file);
 throw Error('PDF save service is not available. Reopen the updated BIG BROTHER application.');
}

/* Older Local Brain databases may expose the approved per-invoice lookup
 * while lacking the bulk manifest RPC. That is not grounds to omit evidence:
 * use the existing authorized invoice-ID lookup in findAttachment() instead.
 * Never fall back on permission-denied or network errors.
 */
async function authorizedOriginalManifest(ids){
 try{return await rpc('bb_ar_original_manifest',{p_invoice_ids:ids})}
 catch(error){
   const message=String(error?.message||error||'');
   if(!/PGRST202|Could not find the function.*bb_ar_original_manifest|function.*bb_ar_original_manifest.*does not exist|undefined function bb_ar_original_manifest/i.test(message))
     throw Error('Could not verify authorized invoice originals. '+message);
   show('Local bulk-original lookup unavailable; verifying originals by authorized invoice ID…');
   return [];
 }
}

async function prepareCustomerPdf(picked){
 // Even a previously prepared/cached PDF must be checked against CURRENT
 // authorized A/R before allowing another delayed download/share.
 if(typeof verifySummaryCurrent!=='function')fail('Summary export verification is unavailable. Refresh A/R.');
 await verifySummaryCurrent();
 const signature=selectionSignature(picked);
 if(preparedPdf?.signature===signature)return preparedPdf;
 const filename=fileName(picked);
 // Load offline HTML renderer before the existing createSummaryImageBlob() call.
 await ensureCanvasAvailable();
 const ids=picked.map(r=>String(r.invoiceId));
 show('Checking '+picked.length+' selected invoice(s)…');
 // Report failures by stage so staff know whether the problem is a missing
 // invoice image, local library, A/R access, or the Android Save/Share picker.
 let results;
 try{
  results=await Promise.all([
   loadPdfLib(),createSummaryImageBlob(),
   authorizedOriginalManifest(ids)
  ]);
 }catch(error){
  throw Error('PDF preparation failed while loading the renderer, summary image, or authorized originals. '+(error?.message||'Try reopening Summary.'));
 }
 const [PDFLib,summaryBlob,manifest]=results;
 if(!Array.isArray(manifest))fail('Could not verify authorized invoice originals.');
 const manifestMap=new Map(manifest.filter(r=>r?.invoiceId&&r?.path).map(r=>[String(r.invoiceId),r]));
 const pdf=await PDFLib.PDFDocument.create();
 pdf.setTitle('BIG BROTHER Customer Invoice Summary + Supporting Invoices');
 pdf.setSubject('Customer receivables and supporting invoices');
 await addPicture(pdf,summaryBlob,'image/png','summary.png');
 let originals=0,storedDigitals=0,digitals=0,multiPage=0;
 for(let i=0;i<picked.length;i++){
  const row=picked[i],id=String(row.invoiceId);
  show('Adding invoice '+(i+1)+' of '+picked.length+': '+label(row));
  const entry=await findAttachment(id,manifestMap);
  if(entry?.path){
   const count=await addOriginal(pdf,await storedBlob(entry,row),entry,row);
   if(String(entry.source||'')==='history_capture')storedDigitals++;
   else originals++;
   if(count>1)multiPage++;
  }else{
   await digitalInvoice(pdf,row);
   digitals++;
  }
  await delay(0);
 }
 show('Finishing '+pdf.getPageCount()+' PDF page(s)…');
 const bytes=await pdf.save({useObjectStreams:true});
 const file=new File([bytes],filename,{type:'application/pdf'});
 const stats={pages:pdf.getPageCount(),originals,storedDigitals,digitals,multiPage};
 const result={file,signature,stats,customers:customerNames(picked)};
 preparedPdf=result;
 return result;
}
function exportStatus(prepared){
 const s=prepared.stats;
 return s.pages+' page(s), '+s.originals+' paper original(s), '+
  s.storedDigitals+' saved digital original(s), '+s.digitals+' generated digital invoice(s).';
}
async function exportAudit(event){
 event?.preventDefault();event?.stopPropagation();
 if(busy)return;
 buttonBusy(true);
 try{
  const picked=selectedRows();
  show('Preparing PDF with '+picked.length+' selected invoice(s)…');
  const prepared=await prepareCustomerPdf(picked);
  show('PDF prepared ('+exportStatus(prepared)+'). Opening Save to Device…');
  await downloadFile(prepared.file);
  show('Saved '+prepared.file.name+' — '+exportStatus(prepared));
 }catch(error){
  console.error('A/R customer PDF download:',error);
  show(error?.message||'PDF could not be prepared.',true);
  alert('PDF was not saved.\n\n'+(error?.message||'Please retry.')+
   '\n\nNo incomplete customer PDF was produced.');
 }finally{buttonBusy(false);}
}
function mixedCustomerApproval(picked){
 const names=customerNames(picked);
 if(names.length<=1)return true;
 return window.confirm(
  'This PDF contains outstanding invoices from '+names.length+' DIFFERENT CUSTOMERS.\n\n'+
  'Only share this file with someone authorized to see ALL selected customers.\n\n'+
  'Continue to Telegram sharing?'
 );
}
async function sendThroughShareSheet(file){
 if(typeof navigator.share!=='function'||typeof navigator.canShare!=='function')return false;
 let canShareFile=false;
 try{canShareFile=navigator.canShare({files:[file]});}
 catch(error){console.warn('PDF file sharing is unsupported:',error);}
 if(!canShareFile)return false;
 try{
  await navigator.share({
   files:[file],
   title:'BIG BROTHER Customer Invoice Summary',
   text:'Customer Invoice Summary and supporting invoices'
  });
  show('PDF handed to your device share sheet. Select Telegram and check the recipient.');
  return 'shared';
 }catch(error){
  if(error?.name==='AbortError'){
   show('Sharing cancelled. PDF is ready to share again.');
   return 'cancelled';
  }
  if(error?.name==='NotAllowedError'){
   show('PDF is ready. Tap “Share PDF to Telegram” again to open the share sheet.');
   return 'blocked';
  }
  console.warn('Customer PDF native sharing unavailable:',error);
  return false;
 }
}
async function shareCustomerPdf(event){
 event?.preventDefault();event?.stopPropagation();
 if(busy)return 'busy';
 let telegramTab=null;
 try{
  const picked=selectedRows();
  if(!mixedCustomerApproval(picked)){show('Sharing cancelled.');return 'cancelled';}
  // On desktop, open Telegram from the actual click before asynchronous PDF creation.
  // Telegram Web cannot accept an attachment programmatically from our site.
  // Decide at click-time so popup blockers do not stop Telegram Web after
  // the PDF is generated. Desktop browsers may define navigator.share while
  // refusing file sharing: a share API alone is not enough.
  let nativeShare=false;
  try{
   const probe=new File(['%PDF-1.4'],'invoice.pdf',{type:'application/pdf'});
   nativeShare=typeof navigator.share==='function'&&typeof navigator.canShare==='function'&&
    navigator.canShare({files:[probe]});
  }catch(_){}
  // A previously prepared PDF must launch the PWA share sheet directly
  // from the tap; awaiting even an already-cached async PDF can lose the gesture.
  if(nativeShare&&preparedPdf?.signature===selectionSignature(picked)){
    let request;
    try{
      request=navigator.share({
        files:[preparedPdf.file],
        title:'BIG BROTHER Customer Invoice Summary',
        text:'Customer Invoice Summary and supporting invoices'
      });
    }catch(error){show(error.message||'Could not open file sharing.',true);return 'error'}
    try{await request;show('PDF handed to device share sheet; select Telegram.');return 'shared';}
    catch(error){if(error.name==='AbortError')return 'cancelled';show(error.message||'Share failed.',true);return 'error'}
  }
  if(!nativeShare&&!window.BBARFileActionsV1?.isNative?.())telegramTab=window.open('https://web.telegram.org/','_blank','noopener,noreferrer');
  buttonBusy(true);
  show('Preparing '+picked.length+' invoice(s) for PDF sharing…');
  const prepared=await prepareCustomerPdf(picked);
  show('PDF prepared ('+exportStatus(prepared)+'). Opening device share picker…');
  if(window.BBARFileActionsV1?.isNative?.()){
    await window.BBARFileActionsV1.share([prepared.file],'BIG BROTHER Customer Invoice Summary','Customer Invoice Summary and supporting invoices');
    show('Android file share chooser opened. Select Telegram and confirm the recipient.');
    return 'native';
  }
  const nativeStatus=await sendThroughShareSheet(prepared.file);
  if(nativeStatus)return nativeStatus;
  await downloadFile(prepared.file);
  show('PDF saved: '+prepared.file.name+'. '+(telegramTab
   ?'Telegram Web opened; attach the downloaded PDF to the intended customer chat.'
   :'Attach the downloaded PDF in Telegram. Browser security prevents automatic file attachment.'));
  return 'downloaded';
 }catch(error){
  console.error('A/R customer PDF sharing:',error);
  show(error?.message||'Could not share customer PDF.',true);
  alert('Customer PDF was not shared.\n\n'+(error?.message||'Please try again.'));
  return 'error';
 }finally{buttonBusy(false);}
}
function install(){
 const actions=document.querySelector('#summaryOverlay .summary-actions');
 if(!actions)return;
 // Make existing Summary Picture / Telegram Picture actions work without CDN too.
 if(typeof window.createSummaryImageBlob==='function'&&!window.__bbArOfflineCanvasWrapped){
  const baseCreateSummaryImageBlob=window.createSummaryImageBlob;
  window.createSummaryImageBlob=async function(){
   await ensureCanvasAvailable();
   return baseCreateSummaryImageBlob.apply(this,arguments);
  };
  window.__bbArOfflineCanvasWrapped=true;
 }
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
 const share=document.createElement('button');
 share.type='button';share.id='bbShareCustomerPdf';share.className='btn summary-telegram-btn';
 share.textContent='✈️ Share PDF to Telegram';
 share.addEventListener('click',shareCustomerPdf);
 legacy.parentNode.insertBefore(share,legacy.nextSibling);
 const overlay=$('summaryOverlay');
 if(overlay&&typeof MutationObserver!=='undefined'){
  const observer=new MutationObserver(()=>{
   if(overlay.classList.contains('hidden'))preparedPdf=null;
  });
  observer.observe(overlay,{attributes:true,attributeFilter:['class']});
 }
 const note=document.createElement('div');
 note.id='bbAuditPdfStatus';note.setAttribute('role','status');
 note.style.cssText='flex-basis:100%;font-size:12px;line-height:1.5;text-align:right;min-height:15px';
 actions.appendChild(note);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);
else install();
window.BBARAuditPdfExport={save:exportAudit,share:shareCustomerPdf,selectedRows};
})();