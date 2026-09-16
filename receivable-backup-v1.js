/* BIG BROTHER — Confirmed Receivable Payment Google Sheets Backup V1
   Supabase remains authoritative. Google Sheets is audit/continuity backup only. */
(function(){
  'use strict';

  const ENDPOINT='https://script.google.com/macros/s/AKfycbxnlB1T6sbqdItYfyXa6wYquXN6URbJhvWJOkE_cM57wsSWK0_uFEsK_DuWr_caQVgd/exec';
  const QUEUE_KEY='BB_AR_PAYMENT_BACKUP_QUEUE_V1';
  const MAX_QUEUE=200;
  const clean=v=>String(v==null?'':v).trim();
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};

  const invoiceCache=new Map();
  const requestCache=new Map();

  function userEmail(){
    try{
      const s=JSON.parse(localStorage.getItem('BB_SUPABASE_DEV_SESSION_V1')||'null');
      return clean(s?.user?.email||'');
    }catch(_){return''}
  }

  function parsePayload(value){
    if(value&&typeof value==='object')return value;
    if(typeof value!=='string'||!value.trim())return {};
    try{return JSON.parse(value)}catch(_){return {}}
  }

  function rememberReceivables(result){
    const rows=Array.isArray(result?.receivables)?result.receivables:[];
    rows.forEach(row=>{
      const no=clean(row?.invoiceNo);
      if(no)invoiceCache.set(no,row);
    });
  }

  function rememberRequest(result){
    const request=result?.request;
    const id=clean(request?.requestId);
    if(id)requestCache.set(id,request);
  }

  function readQueue(){
    try{
      const q=JSON.parse(localStorage.getItem(QUEUE_KEY)||'[]');
      return Array.isArray(q)?q:[];
    }catch(_){return[]}
  }

  function writeQueue(q){
    try{localStorage.setItem(QUEUE_KEY,JSON.stringify(q.slice(-MAX_QUEUE)))}catch(_){}
  }

  function queueKey(payload){
    return clean(payload?.supabasePaymentId)||clean(payload?.backupKey)||[
      clean(payload?.invoiceNo),
      clean(payload?.paymentDate),
      num(payload?.paymentAmountUSD).toFixed(2),
      clean(payload?.transactionId)
    ].join('|');
  }

  function enqueue(payload){
    const key=queueKey(payload);
    if(!key)return;
    const q=readQueue();
    if(!q.some(x=>queueKey(x)===key))q.push(payload);
    writeQueue(q);
  }

  async function send(payload){
    await fetch(ENDPOINT,{
      method:'POST',
      mode:'no-cors',
      cache:'no-store',
      keepalive:true,
      headers:{'Content-Type':'text/plain;charset=UTF-8'},
      body:JSON.stringify(payload)
    });
    return true;
  }

  async function sendOrQueue(payload){
    try{
      await send(payload);
      return true;
    }catch(error){
      console.warn('BIG BROTHER receivable payment backup queued:',error);
      enqueue(payload);
      return false;
    }
  }

  function paymentPayload(invoiceNo,amount,source,result,extra={}){
    const invoice=invoiceCache.get(clean(invoiceNo))||{};
    const currency=clean(extra.currency||invoice?.currency||'USD').toUpperCase();

    /* V1 backup sheet is USD-normalized. For USD invoices this is exact.
       If a future KHR invoice flow exposes an invoice exchange rate here,
       use it automatically; otherwise keep the original currency metadata. */
    const rate=num(extra.exchangeRate||invoice?.exchangeRate);
    const originalAmount=num(amount);
    const amountUSD=currency==='KHR'&&rate>0?originalAmount/rate:originalAmount;

    return {
      backupType:'RECEIVABLE_PAYMENT',
      invoiceNo:clean(invoiceNo),
      customerName:clean(extra.customer||invoice?.customer),
      paymentAmountUSD:amountUSD,
      paymentDate:clean(source?.paymentDate),
      paymentMethod:clean(extra.paymentMethod||source?.paymentMethod||result?.paymentMethod),
      transactionId:clean(extra.transactionId||source?.transactionId),
      salesman:clean(extra.salesman||invoice?.salesmanName||invoice?.salesperson||invoice?.salesman),
      location:clean(extra.location||invoice?.locationCode),
      note:clean(extra.note||source?.note),
      supabasePaymentId:clean(extra.paymentId||result?.paymentId),
      supabaseInvoiceId:clean(extra.invoiceId||invoice?.invoiceId),
      createdBy:userEmail(),
      paymentCurrency:currency,
      originalPaymentAmount:originalAmount,
      exchangeRate:rate,
      backupKey:clean(extra.backupKey)
    };
  }

  async function backupSingle(source,result){
    const no=clean(source?.invoiceNo);
    if(!no)return;
    const p=paymentPayload(no,source?.amount,source,result);
    await sendOrQueue(p);
  }

  async function backupBatch(source,result){
    const invoiceNos=Array.isArray(source?.invoiceNos)?source.invoiceNos:[];
    const basePaymentId=clean(result?.paymentId);
    for(const rawNo of invoiceNos){
      const no=clean(rawNo);
      if(!no)continue;
      const invoice=invoiceCache.get(no)||{};
      const amount=num(invoice?.outstanding);
      if(amount<=0)continue;
      const p=paymentPayload(no,amount,source,result,{
        paymentId:basePaymentId?basePaymentId+':'+no:'',
        backupKey:basePaymentId?'AR-BATCH:'+basePaymentId+':'+no:'',
        customer:invoice?.customer,
        location:invoice?.locationCode,
        currency:invoice?.currency,
        exchangeRate:invoice?.exchangeRate
      });
      await sendOrQueue(p);
    }
  }

  async function backupClearedRequest(source,result){
    const requestId=clean(source?.requestId);
    const request=requestCache.get(requestId)||{};
    const allocations=Array.isArray(request?.allocations)?request.allocations:[];
    const basePaymentId=clean(result?.paymentId);

    for(const allocation of allocations){
      const no=clean(allocation?.invoiceNo);
      if(!no)continue;
      const invoice=invoiceCache.get(no)||{};
      const p=paymentPayload(no,allocation?.requestedAmount,source,result,{
        paymentId:basePaymentId?basePaymentId+':'+no:'',
        backupKey:basePaymentId?'AR-REQUEST:'+basePaymentId+':'+no:'',
        customer:request?.customer||invoice?.customer,
        salesman:request?.salesmanName,
        location:invoice?.locationCode,
        currency:allocation?.currency||request?.currency||invoice?.currency,
        exchangeRate:invoice?.exchangeRate,
        note:request?.note,
        transactionId:source?.transactionId,
        paymentMethod:source?.paymentMethod||result?.paymentMethod
      });
      await sendOrQueue(p);
    }
  }

  async function retryQueue(){
    const q=readQueue();
    if(!q.length)return;
    const remaining=[];
    for(const payload of q){
      try{await send(payload)}catch(_){remaining.push(payload)}
    }
    writeQueue(remaining);
  }

  function install(){
    const adapter=window.BBARAdapter;
    if(!adapter||typeof adapter.apiPost!=='function'||adapter.apiPost.__bbReceivableBackupWrapped)return false;

    const original=adapter.apiPost;
    const wrapped=async function(params={}){
      const action=clean(params?.action);
      const paymentData=parsePayload(params?.paymentData);
      const requestData=parsePayload(params?.requestData);
      const result=await original.call(adapter,params);

      if(action==='arList'&&result?.success)rememberReceivables(result);
      if(action==='arRequestDetail'&&result?.success)rememberRequest(result);

      if(result?.success){
        if(action==='arPayment'){
          backupSingle(paymentData,result).catch(error=>console.warn('BIG BROTHER A/R backup:',error));
        }else if(action==='arBatchPayment'){
          backupBatch(paymentData,result).catch(error=>console.warn('BIG BROTHER A/R batch backup:',error));
        }else if(action==='arClearRequest'){
          backupClearedRequest(requestData,result).catch(error=>console.warn('BIG BROTHER A/R request backup:',error));
        }
      }

      return result;
    };

    wrapped.__bbReceivableBackupWrapped=true;
    adapter.apiPost=wrapped;
    retryQueue().catch(()=>{});
    return true;
  }

  if(!install()){
    let tries=0;
    const timer=setInterval(()=>{
      tries+=1;
      if(install()||tries>=40)clearInterval(timer);
    },100);
  }

  window.BBReceivableBackupV1={retry:retryQueue,endpoint:ENDPOINT};
})();
