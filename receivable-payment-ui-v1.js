/* BIG BROTHER — Receivable Payment UI V1
   Shared by PC + Mobile A/R.
   - Keeps Payment History compact: newest first, two visible rows, scroll for older rows.
   - Shows invoice exchange rate and live USD/KHR cash equivalent.
   - Blocks Cash save in the UI when physical cash does not equal the receivable amount to clear.
   Server-side Supabase validation remains authoritative. */
(function(){
  'use strict';
  if(window.BBReceivablePaymentUIV1)return;
  window.BBReceivablePaymentUIV1={installed:true};

  const byId=id=>document.getElementById(id);
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
  const clean=v=>String(v==null?'':v).trim();

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

  function money(value,currency){
    return String(currency||'USD').toUpperCase()==='KHR'
      ? '៛'+Math.round(num(value)).toLocaleString('en-US')
      : '$'+num(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  }

  function ensureCalculator(){
    const cashBox=byId('cashReceiptFields');
    if(!cashBox)return;
    const note=cashBox.querySelector('.cash-note');
    if(note)note.textContent='Enter the real cash received. USD and KHR may be combined. The invoice exchange rate below converts the physical cash and the payment can continue only when it matches the Receivable Amount to Clear.';
    if(byId('bbReceivableFxCalc'))return;
    const box=document.createElement('div');
    box.id='bbReceivableFxCalc';
    box.style.cssText='margin-top:10px;padding:10px 11px;border:1px solid #b9d8c5;background:#f8fffa;border-radius:9px;font-size:11px;line-height:1.45;color:#315b45';
    box.innerHTML='<div style="font-weight:900;color:#146c43;margin-bottom:4px">Exchange Rate Calculation</div><div id="bbReceivableFxRate">Rate: —</div><div id="bbReceivableFxResult" style="margin-top:3px;font-weight:800">Enter cash received to calculate.</div>';
    cashBox.appendChild(box);
  }

  function calculation(){
    const inv=invoiceContext();
    if(!inv)return null;
    const currency=clean(inv.currency||'USD').toUpperCase();
    const rate=num(inv.exchangeRate);
    const clearAmount=num(byId('payAmount')?.value);
    const usd=num(byId('payCashUSD')?.value);
    const khr=num(byId('payCashKHR')?.value);
    let equivalent=0,needsRate=false;
    if(currency==='USD'){
      needsRate=khr>0;
      equivalent=usd+(khr>0&&rate>0?khr/rate:0);
    }else{
      needsRate=usd>0;
      equivalent=khr+(usd>0&&rate>0?usd*rate:0);
    }
    const tolerance=currency==='KHR'?1:0.05;
    const match=clearAmount>0&&(!needsRate||rate>0)&&Math.abs(equivalent-clearAmount)<=tolerance;
    return {currency,rate,clearAmount,usd,khr,equivalent,needsRate,tolerance,match};
  }

  function updateCalculator(){
    ensureCalculator();
    const rateEl=byId('bbReceivableFxRate'),resultEl=byId('bbReceivableFxResult');
    if(!rateEl||!resultEl)return;
    const c=calculation();
    if(!c){rateEl.textContent='Rate: —';resultEl.textContent='Select an invoice to calculate.';return;}
    rateEl.textContent=c.rate>0?'Invoice Rate: 1 USD = '+c.rate.toLocaleString('en-US')+' KHR':'Invoice Rate: not available';
    if(c.needsRate&&c.rate<=0){resultEl.textContent='Cross-currency cash requires a valid invoice exchange rate.';resultEl.style.color='#b42318';return;}
    if(c.usd<=0&&c.khr<=0){resultEl.textContent='Enter physical cash received in USD and/or KHR.';resultEl.style.color='#315b45';return;}
    resultEl.textContent='Cash Equivalent: '+money(c.equivalent,c.currency)+' · Amount to Clear: '+money(c.clearAmount,c.currency)+(c.match?' · ✓ MATCH':' · Not matched');
    resultEl.style.color=c.match?'#08783e':'#b42318';
  }

  function validateCashBeforeSave(){
    if(clean(byId('payMethod')?.value)!=='Cash')return true;
    const c=calculation();
    if(!c)return true;
    if(c.usd<=0&&c.khr<=0){setError('Enter the physical cash received in USD and/or KHR.');return false;}
    if(c.needsRate&&c.rate<=0){setError('Exchange Rate is required for cross-currency cash.');return false;}
    if(!c.match){setError('Physical cash equals '+money(c.equivalent,c.currency)+', but Amount to Clear is '+money(c.clearAmount,c.currency)+'. Adjust USD/KHR cash until the calculation matches.');return false;}
    return true;
  }

  function formatHistory(){
    const box=byId('paymentHistory');
    if(!box)return;
    const items=[...box.querySelectorAll('.historyitem')];
    if(!items.length){box.style.maxHeight='';box.style.overflowY='';return;}
    if(!items[0].dataset.bbNewestFirst){items.reverse().forEach(item=>{item.dataset.bbNewestFirst='1';box.appendChild(item)})}
    requestAnimationFrame(()=>{
      const visible=[...box.querySelectorAll('.historyitem')].slice(0,2);
      const height=visible.reduce((sum,item)=>sum+item.getBoundingClientRect().height,0)+(visible.length>1?7:0)+2;
      box.style.maxHeight=Math.ceil(height)+'px';
      box.style.overflowY=box.querySelectorAll('.historyitem').length>2?'auto':'visible';
      box.style.paddingRight=box.querySelectorAll('.historyitem').length>2?'4px':'0';
      box.scrollTop=0;
    });
  }

  function bindInput(id){
    const el=byId(id);if(!el||el.dataset.bbFxBound)return;
    el.dataset.bbFxBound='1';el.addEventListener('input',updateCalculator);
  }

  function install(){
    ensureCalculator();
    ['payAmount','payCashUSD','payCashKHR'].forEach(bindInput);
    const method=byId('payMethod');
    if(method&&!method.dataset.bbFxBound){method.dataset.bbFxBound='1';method.addEventListener('change',updateCalculator)}
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
    if(overlay&&!overlay.dataset.bbFxObserver){
      overlay.dataset.bbFxObserver='1';
      new MutationObserver(()=>{if(!overlay.classList.contains('hidden'))setTimeout(updateCalculator,0)}).observe(overlay,{attributes:true,attributeFilter:['class']});
    }
    updateCalculator();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,0),{once:true});
  else setTimeout(install,0);
  let tries=0;const timer=setInterval(()=>{tries++;install();if(tries>=30||byId('savePayBtn'))clearInterval(timer)},150);
})();
