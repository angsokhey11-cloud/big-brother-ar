/* BIG BROTHER — Receivable Payment UI V1.2
   Shared by PC + Mobile A/R.
   - Payment History: newest first, two visible rows, scroll for older rows.
   - Adjustable payment-day USD/KHR exchange rate (never uses invoice rate for conversion).
   - Injects the payment-day rate into bb_ar_receive_payment.
   - Blocks Cash save when converted physical cash does not equal Amount to Clear.
   - Direct Request bypasses Cash/Bank validation because Admin chooses the final method later.
   Supabase remains authoritative. */
(function(){
  'use strict';
  if(window.BBReceivablePaymentUIV1)return;
  window.BBReceivablePaymentUIV1={installed:true};

  const byId=id=>document.getElementById(id);
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
  const clean=v=>String(v==null?'':v).trim();
  let overlayWasOpen=false;

  function setError(message){
    const box=byId('paymentError');
    if(!box)return;
    box.textContent=message||'';
    box.classList.toggle('show',!!message);
  }

  function invoiceContext(){
    try{if(typeof currentInvoice!=='undefined'&&currentInvoice)return currentInvoice}catch(_){}
    return null;
  }

  function isDirectRequest(){
    const note=byId('singleDirectRequestNote');
    if(note?.classList.contains('show'))return true;
    try{if(typeof VIEW!=='undefined'&&VIEW==='your')return true}catch(_){}
    return /direct request/i.test(clean(byId('savePayBtn')?.textContent));
  }

  function money(value,currency){
    return String(currency||'USD').toUpperCase()==='KHR'
      ? '៛'+Math.round(num(value)).toLocaleString('en-US')
      : '$'+num(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  }

  function ensureCalculator(){
    const cashBox=byId('cashReceiptFields');
    if(!cashBox||byId('bbReceivableFxCalc'))return;
    const box=document.createElement('div');
    box.id='bbReceivableFxCalc';
    box.style.cssText='margin-top:10px;padding:10px 11px;border:1px solid #b9d8c5;background:#f8fffa;border-radius:9px;font-size:11px;line-height:1.45;color:#315b45';
    box.innerHTML=`
      <div style="font-weight:900;color:#146c43;margin-bottom:7px">Payment-Day Exchange Rate</div>
      <label for="bbReceivableFxInput" style="display:block;font-weight:800;margin-bottom:4px">1 USD = KHR</label>
      <input id="bbReceivableFxInput" type="number" min="0" step="1" inputmode="decimal" placeholder="Enter today's rate, e.g. 4050" style="width:100%;box-sizing:border-box;margin-bottom:7px">
      <div style="font-size:10px;color:#5b7164;margin-bottom:5px">Adjust this rate for the day the customer pays. The invoice's old exchange rate is not used for this cash conversion.</div>
      <div id="bbReceivableFxResult" style="font-weight:800">Enter cash received to calculate.</div>`;
    cashBox.appendChild(box);
  }

  function rate(){return num(byId('bbReceivableFxInput')?.value)}

  function calculation(){
    const inv=invoiceContext();
    if(!inv)return null;
    const currency=clean(inv.currency||'USD').toUpperCase();
    const fx=rate();
    const clearAmount=num(byId('payAmount')?.value);
    const usd=num(byId('payCashUSD')?.value);
    const khr=num(byId('payCashKHR')?.value);
    let equivalent=0,needsRate=false;
    if(currency==='USD'){
      needsRate=khr>0;
      equivalent=usd+(khr>0&&fx>0?khr/fx:0);
    }else{
      needsRate=usd>0;
      equivalent=khr+(usd>0&&fx>0?usd*fx:0);
    }
    const tolerance=currency==='KHR'?1:0.05;
    const match=clearAmount>0&&(!needsRate||fx>0)&&Math.abs(equivalent-clearAmount)<=tolerance;
    return {currency,rate:fx,clearAmount,usd,khr,equivalent,needsRate,tolerance,match};
  }

  function updateCalculator(){
    ensureCalculator();
    const resultEl=byId('bbReceivableFxResult');
    if(!resultEl)return;
    const c=calculation();
    if(!c){resultEl.textContent='Select an invoice to calculate.';return;}
    if(c.usd<=0&&c.khr<=0){resultEl.textContent='Enter physical cash received in USD and/or KHR.';resultEl.style.color='#315b45';return;}
    if(c.needsRate&&c.rate<=0){
      resultEl.textContent='Enter today’s Exchange Rate for cross-currency cash.';
      resultEl.style.color='#b42318';return;
    }
    resultEl.textContent='Cash Equivalent: '+money(c.equivalent,c.currency)+' · Amount to Clear: '+money(c.clearAmount,c.currency)+(c.match?' · ✓ MATCH':' · Not matched');
    resultEl.style.color=c.match?'#08783e':'#b42318';
  }

  function validateCashBeforeSave(){
    if(isDirectRequest())return true;
    if(clean(byId('payMethod')?.value)!=='Cash')return true;
    const c=calculation();
    if(!c)return true;
    if(c.usd<=0&&c.khr<=0){setError('Enter the physical cash received in USD and/or KHR.');return false;}
    if(c.needsRate&&c.rate<=0){setError('Enter today’s Payment Exchange Rate for cross-currency cash.');return false;}
    if(!c.match){
      setError('Physical cash equals '+money(c.equivalent,c.currency)+', but Amount to Clear is '+money(c.clearAmount,c.currency)+'. Adjust the cash or today’s exchange rate until it matches.');
      return false;
    }
    return true;
  }

  function formatHistory(){
    const box=byId('paymentHistory');
    if(!box)return;
    const items=[...box.querySelectorAll('.historyitem')];
    if(!items.length){box.style.maxHeight='';box.style.overflowY='';return;}
    if(!items[0].dataset.bbNewestFirst){
      items.reverse().forEach(item=>{item.dataset.bbNewestFirst='1';box.appendChild(item)});
    }
    requestAnimationFrame(()=>{
      const visible=[...box.querySelectorAll('.historyitem')].slice(0,2);
      const height=visible.reduce((sum,item)=>sum+item.getBoundingClientRect().height,0)+(visible.length>1?7:0)+2;
      box.style.maxHeight=Math.ceil(height)+'px';
      box.style.overflowY=box.querySelectorAll('.historyitem').length>2?'auto':'visible';
      box.style.paddingRight=box.querySelectorAll('.historyitem').length>2?'4px':'0';
      box.scrollTop=0;
    });
  }

  function installRpcRateInjector(){
    if(window.fetch.__bbReceivablePaymentRate)return;
    const rawFetch=window.fetch.bind(window);
    const wrapped=async function(input,init){
      try{
        const url=typeof input==='string'?input:String(input?.url||'');
        if(url.includes('/rest/v1/rpc/bb_ar_receive_payment')&&init?.body){
          const body=JSON.parse(String(init.body));
          if(body?.p_payload&&typeof body.p_payload==='object'){
            body.p_payload.exchangeRate=rate();
            init={...init,body:JSON.stringify(body)};
          }
        }
      }catch(error){console.warn('BIG BROTHER payment rate injector:',error)}
      return rawFetch(input,init);
    };
    wrapped.__bbReceivablePaymentRate=true;
    window.fetch=wrapped;
  }

  function resetRateOnOpen(){
    const overlay=byId('paymentOverlay');
    if(!overlay)return;
    const open=!overlay.classList.contains('hidden');
    if(open&&!overlayWasOpen){
      const input=byId('bbReceivableFxInput');
      if(input)input.value='';
      setTimeout(updateCalculator,0);
    }
    overlayWasOpen=open;
  }

  function install(){
    ensureCalculator();
    installRpcRateInjector();
    ['payAmount','payCashUSD','payCashKHR','bbReceivableFxInput'].forEach(id=>{
      const el=byId(id);if(!el||el.dataset.bbFxInput)return;el.dataset.bbFxInput='1';el.addEventListener('input',updateCalculator);
    });
    const method=byId('payMethod');
    if(method&&!method.dataset.bbFxMethod){method.dataset.bbFxMethod='1';method.addEventListener('change',updateCalculator)}
    const save=byId('savePayBtn');
    if(save&&!save.dataset.bbFxGuard){
      save.dataset.bbFxGuard='1';
      save.addEventListener('click',event=>{if(!validateCashBeforeSave()){event.preventDefault();event.stopImmediatePropagation()}},true);
    }
    const history=byId('paymentHistory');
    if(history&&!history.dataset.bbHistoryObserver){
      history.dataset.bbHistoryObserver='1';
      new MutationObserver(()=>setTimeout(formatHistory,0)).observe(history,{childList:true,subtree:false});
      formatHistory();
    }
    const overlay=byId('paymentOverlay');
    if(overlay&&!overlay.dataset.bbFxOverlay){
      overlay.dataset.bbFxOverlay='1';
      new MutationObserver(resetRateOnOpen).observe(overlay,{attributes:true,attributeFilter:['class']});
    }
    resetRateOnOpen();
    updateCalculator();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,0),{once:true});
  else setTimeout(install,0);
  let tries=0;const timer=setInterval(()=>{tries++;install();if(tries>=40||byId('savePayBtn'))clearInterval(timer)},150);
})();
