/* BIG BROTHER — Confirmed Receivable Payment Google Sheets Backup V2.3
   Supabase remains authoritative. Google Sheets is audit/continuity backup only.
   Backup payloads are queued BEFORE network send so UI/navigation can never lose a payment.
   Direct-payment UI refresh runs in background after a confirmed Supabase save. */
(function(){
  'use strict';

  const ENDPOINT='https://script.google.com/macros/s/AKfycbxnlB1T6sbqdItYfyXa6wYquXN6URbJhvWJOkE_cM57wsSWK0_uFEsK_DuWr_caQVgd/exec';
  const QUEUE_KEY='BB_AR_PAYMENT_BACKUP_QUEUE_V2';
  const MAX_QUEUE=200;
  const clean=v=>String(v==null?'':v).trim();
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
  const invoiceCache=new Map();
  const requestCache=new Map();
  let fastRefreshPending=false;

  function userEmail(){try{const s=JSON.parse(localStorage.getItem('BB_SUPABASE_DEV_SESSION_V1')||'null');return clean(s?.user?.email||'')}catch(_){return''}}
  function parsePayload(value){if(value&&typeof value==='object')return value;if(typeof value!=='string'||!value.trim())return{};try{return JSON.parse(value)}catch(_){return{}}}
  function rememberReceivables(result){(Array.isArray(result?.receivables)?result.receivables:[]).forEach(row=>{const no=clean(row?.invoiceNo);if(no)invoiceCache.set(no,row)})}
  function rememberRequest(result){const request=result?.request;const id=clean(request?.requestId);if(id)requestCache.set(id,request)}

  function readQueue(){try{const q=JSON.parse(localStorage.getItem(QUEUE_KEY)||'[]');return Array.isArray(q)?q:[]}catch(_){return[]}}
  function writeQueue(q){try{localStorage.setItem(QUEUE_KEY,JSON.stringify(q.slice(-MAX_QUEUE)))}catch(_){}}
  function queueKey(payload){return clean(payload?.backupKey)||clean(payload?.supabasePaymentId)||[clean(payload?.invoiceNo),clean(payload?.paymentDate),num(payload?.paymentAmountUSD).toFixed(2),clean(payload?.transactionId)].join('|')}
  function enqueue(payload){const key=queueKey(payload);if(!key)return;const q=readQueue();if(!q.some(x=>queueKey(x)===key))q.push(payload);writeQueue(q)}
  function dequeue(payload){const key=queueKey(payload);if(!key)return;writeQueue(readQueue().filter(x=>queueKey(x)!==key))}

  async function send(payload){
    await fetch(ENDPOINT,{method:'POST',mode:'no-cors',cache:'no-store',keepalive:true,headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(payload)});
    return true;
  }

  function dispatch(payload){
    enqueue(payload);
    send(payload).then(()=>dequeue(payload)).catch(error=>console.warn('BIG BROTHER receivable payment backup queued for retry:',error));
    return true;
  }

  function paymentPayload(invoiceNo,amount,source,result,extra={}){
    const invoice=invoiceCache.get(clean(invoiceNo))||{};
    const currency=clean(extra.currency||invoice?.currency||'USD').toUpperCase();
    const rate=num(extra.exchangeRate||invoice?.exchangeRate);
    const originalAmount=num(amount);
    const amountUSD=currency==='KHR'&&rate>0?originalAmount/rate:originalAmount;
    return {
      backupType:'RECEIVABLE_PAYMENT',invoiceNo:clean(invoiceNo),customerName:clean(extra.customer||invoice?.customer),
      paymentAmountUSD:amountUSD,paymentDate:clean(source?.paymentDate||result?.paymentDate),
      paymentMethod:clean(extra.paymentMethod||source?.paymentMethod||result?.paymentMethod),
      transactionId:clean(extra.transactionId||source?.transactionId||result?.transactionId),
      salesman:clean(extra.salesman||invoice?.salesmanName||invoice?.salesperson||invoice?.salesman),
      location:clean(extra.location||invoice?.locationCode),note:clean(extra.note||source?.note),
      supabasePaymentId:clean(extra.paymentId||result?.paymentId),supabaseInvoiceId:clean(extra.invoiceId||invoice?.invoiceId),
      createdBy:userEmail(),paymentCurrency:currency,originalPaymentAmount:originalAmount,exchangeRate:rate,backupKey:clean(extra.backupKey)
    };
  }

  function backupSingle(source,result){
    const no=clean(source?.invoiceNo),amount=num(source?.amount);
    if(!no||amount<=0)return false;
    return dispatch(paymentPayload(no,amount,source,result));
  }

  function backupBatch(source,result){
    const invoiceNos=Array.isArray(source?.invoiceNos)?source.invoiceNos:[],basePaymentId=clean(result?.paymentId);
    for(const rawNo of invoiceNos){
      const no=clean(rawNo);if(!no)continue;
      const invoice=invoiceCache.get(no)||{},amount=num(invoice?.outstanding);if(amount<=0)continue;
      dispatch(paymentPayload(no,amount,source,result,{paymentId:basePaymentId?basePaymentId+':'+no:'',backupKey:basePaymentId?'AR-BATCH:'+basePaymentId+':'+no:'',customer:invoice?.customer,location:invoice?.locationCode,currency:invoice?.currency,exchangeRate:invoice?.exchangeRate}));
    }
    return true;
  }

  function backupClearedRequest(source,result){
    const requestId=clean(source?.requestId),request=requestCache.get(requestId)||{},allocations=Array.isArray(request?.allocations)?request.allocations:[],basePaymentId=clean(result?.paymentId);
    for(const allocation of allocations){
      const no=clean(allocation?.invoiceNo),amount=num(allocation?.requestedAmount);if(!no||amount<=0)continue;
      const invoice=invoiceCache.get(no)||{};
      dispatch(paymentPayload(no,amount,source,result,{paymentId:basePaymentId?basePaymentId+':'+no:'',backupKey:basePaymentId?'AR-REQUEST:'+basePaymentId+':'+no:'',customer:request?.customer||invoice?.customer,salesman:request?.salesmanName,location:allocation?.locationCode||invoice?.locationCode,currency:allocation?.currency||request?.currency||invoice?.currency,exchangeRate:allocation?.exchangeRate||invoice?.exchangeRate,note:request?.note,transactionId:source?.transactionId,paymentMethod:source?.paymentMethod||result?.paymentMethod}));
    }
    return true;
  }

  async function handle(params={},result={}){
    const action=clean(params?.action),paymentData=parsePayload(params?.paymentData),requestData=parsePayload(params?.requestData);
    if(action==='arList')rememberReceivables(result);
    if(action==='arRequestDetail')rememberRequest(result);
    if(result?.success===false)return result;
    if(action==='arPayment'){
      backupSingle(paymentData,result);
      fastRefreshPending=true;
    }else if(action==='arBatchPayment'){
      backupBatch(paymentData,result);
      fastRefreshPending=true;
    }else if(action==='arClearRequest')backupClearedRequest(requestData,result);
    return result;
  }

  async function retryQueue(){
    const q=readQueue();if(!q.length)return;
    for(const payload of q){
      try{await send(payload);dequeue(payload)}catch(_){}
    }
  }

  function installFastRefreshHook(){
    const current=window.loadAR;
    if(typeof current!=='function'||current.__bbFastPaymentRefresh)return false;
    const wrapped=function(force){
      if(fastRefreshPending){
        fastRefreshPending=false;
        Promise.resolve().then(()=>current.call(this,force)).catch(error=>console.warn('BIG BROTHER A/R background refresh:',error));
        return Promise.resolve();
      }
      return current.call(this,force);
    };
    wrapped.__bbFastPaymentRefresh=true;
    window.loadAR=wrapped;
    return true;
  }

  function installLiveHook(){
    const current=window.apiPost;
    if(typeof current!=='function'||current.__bbReceivableBackupLive)return false;
    const wrapped=async function(params={}){
      const result=await current.call(this,params);
      try{handle(params,result).catch(error=>console.warn('BIG BROTHER A/R backup:',error))}catch(error){console.warn('BIG BROTHER A/R backup did not block payment save:',error)}
      return result;
    };
    wrapped.__bbReceivableBackupLive=true;
    window.apiPost=wrapped;
    return true;
  }

  function loadPaymentUi(){
    if(window.BBReceivablePaymentUIV1)return;
    if(document.querySelector('script[data-bb-receivable-payment-ui="1"]'))return;
    try{
      const script=document.createElement('script');
      script.src='receivable-payment-ui-v1.js?v=20260916-1';
      script.async=false;
      script.dataset.bbReceivablePaymentUi='1';
      (document.head||document.documentElement).appendChild(script);
    }catch(error){console.warn('BIG BROTHER receivable payment UI:',error)}
  }

  let tries=0;
  const timer=setInterval(()=>{
    tries+=1;
    const apiReady=installLiveHook();
    const refreshReady=installFastRefreshHook();
    if((apiReady||window.apiPost?.__bbReceivableBackupLive)&&(refreshReady||window.loadAR?.__bbFastPaymentRefresh))clearInterval(timer);
    else if(tries>=80)clearInterval(timer);
  },100);
  setTimeout(()=>{installLiveHook();installFastRefreshHook();loadPaymentUi()},0);
  retryQueue().catch(()=>{});
  window.BBReceivableBackupV2={handle,retry:retryQueue,install:installLiveHook,endpoint:ENDPOINT};
})();
