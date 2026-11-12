/* BIG BROTHER · A/R Bank Assistant V1. No money is posted until Admin approval. */
(function(){
'use strict';
if(window.BBARBankAssistantV1)return;window.BBARBankAssistantV1=true;
const $=id=>document.getElementById(id);
const el=(tag,klass,txt)=>{const x=document.createElement(tag);if(klass)x.className=klass;if(txt!==undefined)x.textContent=String(txt);return x};
const norm=x=>String(x??'').trim();
const decimals=cur=>norm(cur).toUpperCase()==='KHR'?0:2,scale=cur=>decimals(cur)?100:1;
const money=(amt,cur)=>((cur==='KHR')?'៛':'$')+Number(amt||0).toLocaleString('en-US',{minimumFractionDigits:decimals(cur),maximumFractionDigits:decimals(cur)});
const fmt=v=>{const m=norm(v).match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'-'+(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m[2])-1]||m[2])+'-'+m[1]:'Not recorded'};
const minor=(amount,cur)=>Math.round(Math.max(0,Number(amount)||0)*scale(cur));
const availableMinor=b=>Math.floor(Math.max(0,Number(b.equivalentRemaining)||0)*scale(b.invoiceCurrency)+0.000001);
const key=b=>norm(b.transactionId)+'|'+norm(b.customerId);
const state={balances:[],invoices:[],canSubmit:false,canApprove:false,active:'',search:'',selected:new Map(),busy:false};
let overlay,contents,notification;
const current=()=>state.balances.find(x=>key(x)===state.active);
function invoicesFor(b){
 return state.invoices.filter(i=>norm(i.customerId)===norm(b.customerId)&&
  norm(i.currency).toUpperCase()===norm(b.invoiceCurrency).toUpperCase()&&
  !norm(i.pendingRequestId)&&Number(i.outstanding)>0)
  .sort((a,b)=>norm(a.invoiceDate).localeCompare(norm(b.invoiceDate))||
    norm(a.invoiceNo).localeCompare(norm(b.invoiceNo),undefined,{numeric:true}));
}
function recommend(b){
 const arr=invoicesFor(b),limit=availableMinor(b),cur=b.invoiceCurrency;
 if(limit<=0||!arr.length)return {label:'No eligible outstanding A/R',picks:[]};
 const items=arr.map(i=>({i,n:minor(i.outstanding,cur)}));
 const exact=items.find(x=>x.n===limit);
 if(exact)return {label:'Exact invoice amount',picks:[{id:exact.i.invoiceId,amount:exact.n/scale(cur)}]};
 const pool=items.slice(0,25);
 function find(count,start,left,chosen){
  if(!count)return left===0?chosen:null;
  for(let j=start;j<=pool.length-count;j++){
   if(pool[j].n>left)continue;
   const v=find(count-1,j+1,left-pool[j].n,chosen.concat(pool[j]));
   if(v)return v;
  }
  return null;
 }
 for(let n=2;n<=4;n++){
  const match=find(n,0,limit,[]);
  if(match)return {label:'Exact combination · '+n+' invoices',
    picks:match.map(x=>({id:x.i.invoiceId,amount:x.n/scale(cur)}))};
 }
 let rest=limit;const picks=[];
 for(const row of items){
  if(rest<=0||picks.length===50)break;
  const use=Math.min(rest,row.n);
  if(use>0)picks.push({id:row.i.invoiceId,amount:use/scale(cur)});
  rest-=use;
 }
 return {label:'Oldest invoices first · partial payments allowed',picks};
}
function validate(){
 const b=current(),summary=$('bbBAChosen'),warning=$('bbBAWarning'),send=$('bbBASend');
 if(!b)return;
 const valid=new Map(invoicesFor(b).map(i=>[norm(i.invoiceId),i]));
 let total=0,count=0,error='';
 for(const [id,amt] of state.selected){
  const invoice=valid.get(id);
  if(!invoice){error='An invoice is no longer eligible; refresh';continue}
  const value=Number(amt);
  if(value<=0)continue;
  if(value>Number(invoice.outstanding)+0.000001)error='Amount exceeds '+invoice.invoiceNo;
  if(Math.abs(value*scale(b.invoiceCurrency)-Math.round(value*scale(b.invoiceCurrency)))>0.00001)
   error='Incorrect decimal precision for '+b.invoiceCurrency;
  total+=value;count++;
 }
 const remain=availableMinor(b)/scale(b.invoiceCurrency);
 if(total>remain+0.000001)error='Allocation exceeds remaining bank balance';
 if(summary)summary.textContent=count+' invoice(s) selected · '+money(total,b.invoiceCurrency)+
  ' of '+money(remain,b.invoiceCurrency)+' · After approval '+money(Math.max(0,remain-total),b.invoiceCurrency)+' remains';
 if(warning)warning.textContent=error;
 if(send)send.disabled=!!error||!count||!state.canSubmit||state.busy;
}
function detail(){
 const area=$('bbBADetail');if(!area)return;area.replaceChildren();
 const b=current();if(!b)return;
 const box=el('div','bbba-detail');
 box.append(el('h3','',b.customer+' · '+money(b.remainingAmount,b.currency)));
 box.append(el('p','bbba-muted','Receipt '+b.transactionId+' · Received '+fmt(b.receivedDate)+
  ' · Bank '+(norm(b.bankName)||'Unrecorded (Admin must enter actual bank)')+
  ' · Payer '+(norm(b.payer)||'—')));
 if(norm(b.invoiceCurrency)!==norm(b.currency))
  box.append(el('p','bbba-muted','Available in invoice currency: '+money(b.equivalentRemaining,b.invoiceCurrency)+
    ' at approved bank exchange rate '+b.exchangeRate));
 const suggestion=recommend(b);
 const buttons=el('div','bbba-buttons');
 const select=el('button','bbba-secondary','✓ Suggested Match');
 select.onclick=()=>{state.selected=new Map(suggestion.picks.map(x=>[norm(x.id),x.amount]));detail()};
 const clear=el('button','bbba-secondary','Clear Selection');clear.onclick=()=>{state.selected.clear();detail()};
 buttons.append(select,clear);box.append(buttons);
 box.append(el('p','bbba-muted','Recommendation: '+suggestion.label+' · No automatic clearing'));
 const list=el('div','bbba-invoices');
 const all=invoicesFor(b);
 if(!all.length)list.append(el('div','bbba-empty','No eligible A/R invoices. Balance remains visible until fully used.'));
 for(const invoice of all){
  const id=norm(invoice.invoiceId),line=el('div','bbba-invoice');
  const checkbox=el('input');checkbox.type='checkbox';checkbox.checked=state.selected.has(id);
  const label=el('label','bbba-invoice-label');
  const info=el('span');
  info.append(el('strong','',invoice.invoiceNo+' · '+money(invoice.outstanding,invoice.currency)));
  info.append(el('small','bbba-muted','Sale '+fmt(invoice.invoiceDate)));
  label.append(checkbox,info);
  const amount=el('input','bbba-amount');amount.type='number';
  amount.inputMode='decimal';amount.step=String(1/scale(invoice.currency));amount.min=amount.step;
  amount.max=String(invoice.outstanding);amount.placeholder='Amount';
  amount.value=state.selected.has(id)?String(state.selected.get(id)):'';
  amount.disabled=!checkbox.checked;
  checkbox.onchange=()=>{if(checkbox.checked)state.selected.set(id,Math.min(Number(invoice.outstanding),
   availableMinor(b)/scale(invoice.currency)));else state.selected.delete(id);detail()};
  amount.oninput=()=>{state.selected.set(id,Number(amount.value));validate()};
  line.append(label,amount);list.append(line);
 }
 box.append(list);
 const summary=el('div','bbba-summary');summary.id='bbBAChosen';box.append(summary);
 const warning=el('div','bbba-error');warning.id='bbBAWarning';box.append(warning);
 const note=el('textarea','bbba-note');note.id='bbBANote';note.placeholder='Optional message for Admin';
 note.rows=2;note.maxLength=300;box.append(note);
 const send=el('button','bbba-primary','Submit to Pending Payment Review');send.id='bbBASend';
 send.onclick=()=>{void submit(b,note.value,send)};box.append(send);
 box.append(el('p','bbba-muted','Received date stays linked to the bank receipt. A/R Payment Date = Admin approval date.'));
 area.append(box);validate();
}
function render(){
 if(!contents)return;contents.replaceChildren();
 contents.append(el('div','bbba-summary',state.balances.length+
  ' available outlet balances · Never-used and partially-used receipts · Fully used hidden'));
 const receiptGrid=el('div','bbba-grid');
 const filtered=state.balances.filter(b=>[b.customer,b.customerId,b.transactionId,b.payer,b.bankName,b.locationCode]
  .some(x=>norm(x).toLowerCase().includes(state.search.toLowerCase())));
 if(!filtered.length)receiptGrid.append(el('div','bbba-empty','No available registered balances match this view.'));
 for(const b of filtered){
  const card=el('button','bbba-receipt'+(state.active===key(b)?' active':''));
  card.type='button';
  const h=el('div','bbba-receipt-heading');
  h.append(el('strong','',b.customer+' · '+b.locationCode),
   el('strong','',money(b.remainingAmount,b.currency)));
  card.append(h);
  card.append(el('div','bbba-muted','Received '+fmt(b.receivedDate)+' · '+b.transactionId+
    ' · '+(norm(b.bankName)||'Bank unknown')));
  card.append(el('div','bbba-muted',(Number(b.usedAmount)>0?'Partially used':'Never used')+
    ' · A/R available '+money(b.equivalentRemaining,b.invoiceCurrency)));
  card.onclick=()=>{state.active=key(b);state.selected=new Map(recommend(b).picks.map(x=>[norm(x.id),x.amount]));render()};
  receiptGrid.append(card);
 }
 contents.append(receiptGrid);
 const area=el('div');area.id='bbBADetail';contents.append(area);detail();
}
async function load(){
 if(state.busy)return;state.busy=true;
 if(notification)notification.textContent='Loading live registered balances and A/R…';
 try{
  const data=await window.BBARAdapter.rpc('bb_ar_bank_assistant_list_v1');
  if(!data?.success)throw Error('Invalid Bank Assistant response');
  state.balances=Array.isArray(data.balances)?data.balances:[];
  state.invoices=Array.isArray(data.invoices)?data.invoices:[];
  state.canSubmit=!!data.canSubmit;state.canApprove=!!data.canApprove;
  if(!state.balances.some(b=>key(b)===state.active)){state.active='';state.selected.clear()}
  if(!state.active&&state.balances.length){
   const b=state.balances[0];state.active=key(b);
   state.selected=new Map(recommend(b).picks.map(x=>[norm(x.id),x.amount]));
  }
  if(notification)notification.textContent='Live ledger · '+state.balances.length+
    ' available customer balances · '+state.invoices.length+' outstanding invoice rows';
  render();
 }catch(e){
  if(notification)notification.textContent='Bank Assistant error: '+(e.message||e)+
    ' · Ensure the Cloud/Local database upgrade is installed';
 }finally{state.busy=false;validate()}
}
async function submit(b,note,btn){
 validate();if(btn.disabled||state.busy||!state.canSubmit)return;
 const valid=new Map(invoicesFor(b).map(i=>[norm(i.invoiceId),i]));
 const allocations=[...state.selected].filter(([id,n])=>valid.has(id)&&Number(n)>0)
  .map(([invoiceId,amount])=>({invoiceId,amount:String(amount)}));
 if(!allocations.length)return;
 if(!confirm('Send '+allocations.length+' invoice allocation(s) to Admin review?\nNo money deducted until approval.'))return;
 state.busy=true;btn.disabled=true;btn.textContent='Submitting…';
 try{
  const result=await window.BBARAdapter.rpc('bb_ar_bank_assistant_submit_v1',
   {p_payload:{customerId:b.customerId,transactionId:b.transactionId,allocations,note:norm(note)}});
  if(!result?.success)throw Error('Recommendation was not accepted');
  if(typeof loadAR==='function'){
   try{await loadAR(true)}catch(refreshError){console.warn('Bank Assistant: recommendation saved but A/R list refresh failed',refreshError)}
  }
  state.busy=false;state.selected.clear();await load();
  if(state.canApprove&&typeof window.openRequestReview==='function'&&
   (typeof VIEW==='undefined'||VIEW==='all')){
   if(confirm('Request '+result.requestId+' created.\nOpen the existing Admin Payment Review now?')){
    close();void window.openRequestReview(result.requestId);
   }
  }else alert('Sent '+result.requestId+' to A/R Pending Payment Review.\nNo registered balance was deducted.');
 }catch(e){alert('Could not submit recommendation: '+(e.message||e))}
 finally{state.busy=false;btn.disabled=false;btn.textContent='Submit to Pending Payment Review'}
}
function open(){if(!overlay)return;overlay.hidden=false;document.body.classList.add('bbba-open');void load()}
function close(){if(overlay)overlay.hidden=true;document.body.classList.remove('bbba-open')}
function install(){
 if(!window.BBARAdapter?.rpc)return;
 const anchor=$('bbARBankSyncControls')||document.querySelector('.filters');if(!anchor)return;
 const style=el('style');
 style.textContent='body.bbba-open{overflow:hidden}.bbba-overlay[hidden]{display:none!important}'+
 '.bbba-overlay{position:fixed;inset:0;z-index:2147482000;background:#10253fb8;padding:10px;display:flex;justify-content:center;align-items:center}'+
 '.bbba-modal{background:#fff;color:#233b52;width:min(1100px,100%);height:min(90vh,850px);border-radius:14px;display:flex;flex-direction:column;overflow:hidden;font-family:inherit}'+
 '.bbba-head{display:flex;align-items:center;flex-wrap:wrap;gap:9px;background:#edf6fd;border-bottom:1px solid #d3e3f0;padding:12px}'+
 '.bbba-head h2{font-size:18px;margin:0;flex:1}.bbba-head button,.bbba-secondary{background:#fff;color:#185991;border:1px solid #abc6df;border-radius:8px;padding:8px;cursor:pointer;font-weight:700}'+
 '.bbba-search{padding:8px;border:1px solid #bcd0e2;border-radius:8px;flex:1;max-width:260px;min-width:140px}.bbba-status{padding:9px 12px;color:#607890;font-size:12px}'+
 '.bbba-scroll{overflow:auto;flex:1;padding:12px}.bbba-summary{background:#eef7fe;padding:9px;font-size:12px;font-weight:700;border-radius:8px;margin:8px 0}'+
 '.bbba-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:7px}.bbba-receipt{background:#fff;border:1px solid #d3e2f0;border-radius:9px;text-align:left;padding:10px;color:#233b52;cursor:pointer}'+
 '.bbba-receipt.active{border:2px solid #2876b9;background:#eef8ff}.bbba-receipt-heading{display:flex;justify-content:space-between;gap:9px;font-size:13px}'+
 '.bbba-muted{font-size:11px;color:#5f7489;line-height:1.55;display:block;overflow-wrap:anywhere}.bbba-detail{border:1px solid #d8e4ed;padding:12px;border-radius:9px;margin:14px 0}'+
 '.bbba-detail h3{margin:0;font-size:16px}.bbba-buttons{display:flex;gap:7px;margin:10px 0}.bbba-invoices{max-height:275px;overflow:auto;border:1px solid #dce7f0;border-radius:8px}'+
 '.bbba-invoice{display:flex;gap:12px;align-items:center;border-bottom:1px solid #edf1f6;padding:8px}.bbba-invoice-label{display:flex;align-items:center;gap:9px;flex:1}'+
 '.bbba-invoice-label small{display:block}.bbba-amount{width:100px;max-width:35%;border:1px solid #c1d2e1;border-radius:7px;padding:7px}.bbba-primary{background:#1b6cad;color:#fff;border:0;border-radius:8px;padding:11px;font-weight:800;cursor:pointer}'+
 '.bbba-primary:disabled{opacity:.5}.bbba-error{color:#b34426;font-size:12px}.bbba-note{width:100%;box-sizing:border-box;border:1px solid #d0dfec;border-radius:8px;padding:9px;margin:9px 0}'+
 '#bbARBankAssistantBtn{background:#185c96;color:#fff;border:1px solid #185c96}.bbba-empty{padding:15px;color:#62798e;font-size:12px}'+
 '@media(max-width:640px){.bbba-overlay{padding:0}.bbba-modal{height:100dvh;max-height:100dvh;border-radius:0}.bbba-grid{grid-template-columns:1fr}}';
 document.head.append(style);
 const button=el('button','btn','🏦 Bank Assistant');button.id='bbARBankAssistantBtn';
 button.type='button';button.onclick=open;
 if(anchor.id==='bbARBankSyncControls')anchor.insertAdjacentElement('afterend',button);else anchor.append(button);
 overlay=el('div','bbba-overlay');overlay.id='bbARBankAssistantOverlay';overlay.hidden=true;
 const modal=el('div','bbba-modal'),header=el('div','bbba-head');
 header.append(el('h2','', '🏦 Bank Assistant'));
 const refresh=el('button','','↻ Refresh');refresh.onclick=()=>void load();header.append(refresh);
 const search=el('input','bbba-search');search.placeholder='Search customer, payer, transaction';
 search.oninput=()=>{state.search=search.value;render()};header.append(search);
 const dismiss=el('button','','✕ Close');dismiss.onclick=close;header.append(dismiss);
 notification=el('div','bbba-status','Ready to load current balances');
 contents=el('div','bbba-scroll');
 modal.append(header,notification,contents);overlay.append(modal);
 overlay.onclick=e=>{if(e.target===overlay)close()};
 document.body.append(overlay);window.BBAROpenBankAssistant=open;
 const oldReview=window.openRequestReview;
 if(typeof oldReview==='function')window.openRequestReview=async function(...args){
  const result=await oldReview.apply(this,args);
  const request=(typeof currentRequest!=='undefined')?currentRequest:null;
  const method=$('reviewPaymentMethod'),transaction=$('reviewTransactionId');
  if(method)method.disabled=false;if(transaction)transaction.readOnly=false;
  if(request?.requestType==='Bank Assistant'){
   const meta=$('requestReviewMeta');
   if(meta)meta.append(el('div','bbba-summary','Bank Assistant · Original bank received date is preserved. A/R Payment Date will be Admin approval date.'));
   if(method){method.value='Bank';method.disabled=true}
   if(transaction){transaction.value=request.transactionId;transaction.readOnly=true}
  }
  return result;
 };
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
