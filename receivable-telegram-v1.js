/* BIG BROTHER — Customer Telegram A/R Cleared Update V1
   Event-driven only. No customer polling/scanning.
   Triggered by successful A/R actions that return an exact paymentId. */
(function(){
  'use strict';

  if(window.BBReceivableTelegram)return;

  const SUPABASE_URL='https://sjfhlaclgmkwwofzstok.supabase.co';
  const SUPABASE_KEY='sb_publishable_w762jR65CWwlO30fKQsYOw_6L9grx8S';
  const SESSION_KEY='BB_SUPABASE_DEV_SESSION_V1';
  const FUNCTION_URL=SUPABASE_URL+'/functions/v1/bb-telegram-ar-update';

  let session=null;
  let promptRunning=false;
  const seenPayments=new Set();

  function clean(value){
    return String(value==null?'':value).trim();
  }

  function esc(value){
    return clean(value).replace(/[&<>"']/g,c=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[c]));
  }

  function money(value,currency){
    const n=Number(value)||0;
    const cur=clean(currency).toUpperCase()||'USD';
    if(cur==='KHR'){
      return 'KHR '+Math.round(n).toLocaleString('en-US');
    }
    return '$'+n.toLocaleString('en-US',{
      minimumFractionDigits:2,
      maximumFractionDigits:2
    });
  }

  function readSession(){
    try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch(_){return null}
  }

  function saveSession(value){
    session=value||null;
    try{
      if(!value){
        localStorage.removeItem(SESSION_KEY);
        return;
      }
      if(!value.expires_at&&value.expires_in){
        value.expires_at=Math.floor(Date.now()/1000)+Number(value.expires_in);
      }
      localStorage.setItem(SESSION_KEY,JSON.stringify(value));
    }catch(_){}
  }

  async function parse(response){
    const text=await response.text();
    let data={};
    try{data=text?JSON.parse(text):{}}catch(_){data={message:text}}
    if(!response.ok||data.success===false){
      const error=new Error(data.message||data.error||('Request failed ('+response.status+')'));
      error.status=response.status;
      error.data=data;
      throw error;
    }
    return data;
  }

  async function refreshSession(){
    const current=readSession();
    if(!current?.refresh_token)throw new Error('Please sign in to BIG BROTHER.');
    const response=await fetch(SUPABASE_URL+'/auth/v1/token?grant_type=refresh_token',{
      method:'POST',
      headers:{
        apikey:SUPABASE_KEY,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({refresh_token:current.refresh_token}),
      cache:'no-store'
    });
    const next=await parse(response);
    saveSession(next);
    return next;
  }

  async function ensureSession(){
    session=readSession();
    if(!session?.access_token)throw new Error('Please sign in to BIG BROTHER.');
    const now=Math.floor(Date.now()/1000);
    if(session.expires_at&&Number(session.expires_at)<now+45){
      await refreshSession();
    }
    return session;
  }

  async function call(payload,retry=true){
    await ensureSession();

    const request=()=>fetch(FUNCTION_URL,{
      method:'POST',
      headers:{
        apikey:SUPABASE_KEY,
        Authorization:'Bearer '+session.access_token,
        'Content-Type':'application/json'
      },
      body:JSON.stringify(payload||{}),
      cache:'no-store'
    });

    let response=await request();
    if(response.status===401&&retry){
      await refreshSession();
      response=await request();
    }
    return parse(response);
  }

  function outstandingHtml(snapshot){
    const totals=snapshot?.totals||{};
    const currencies=Object.keys(totals).sort();

    if(!currencies.length){
      return '<div class="bb-ar-tg-all-clear">✅ ALL CREDIT INVOICES CLEARED</div>';
    }

    return currencies.map(currency=>
      '<div class="bb-ar-tg-outstanding-row">'+
        '<span>'+esc(currency)+'</span>'+
        '<strong>'+esc(money(totals[currency],currency))+'</strong>'+
      '</div>'
    ).join('')+
    '<div class="bb-ar-tg-open-count">'+
      esc(snapshot?.openInvoiceCount||0)+' open credit invoice'+
      (Number(snapshot?.openInvoiceCount||0)===1?'':'s')+
    '</div>';
  }

  function closeModal(){
    document.getElementById('bbArTelegramModal')?.remove();
  }

  function ask(data){
    closeModal();

    return new Promise(resolve=>{
      const payment=data?.payment||{};
      const customer=data?.customer||{};
      const destination=data?.destination||{};
      const cleared=Array.isArray(data?.cleared_invoices)?data.cleared_invoices:[];

      const modal=document.createElement('div');
      modal.id='bbArTelegramModal';
      modal.className='bb-ar-tg-backdrop';

      modal.innerHTML=`
        <div class="bb-ar-tg-card" role="dialog" aria-modal="true">
          <div class="bb-ar-tg-head">
            <div>
              <div class="bb-ar-tg-kicker">CUSTOMER RECEIVABLE UPDATE</div>
              <h2>Send A/R Update to Telegram?</h2>
            </div>
            <button type="button" class="bb-ar-tg-close" aria-label="Close">×</button>
          </div>

          <div class="bb-ar-tg-success">✅ RECEIVABLE CLEARED</div>

          <div class="bb-ar-tg-details">
            <div><span>Customer</span><strong>${esc(customer.customer_name||customer.customer_id||'Customer')}</strong></div>
            <div><span>Payment ID</span><strong>${esc(payment.payment_id||'')}</strong></div>
            <div><span>Payment</span><strong>${esc(money(payment.amount,payment.currency))} · ${esc(payment.payment_method||'')}</strong></div>
            <div><span>Cleared Invoice${cleared.length===1?'':'s'}</span><strong>${esc(cleared.map(item=>item.invoiceNo).join(', '))}</strong></div>
            <div><span>Destination</span><strong>${esc(destination.label||'Telegram')}</strong></div>
          </div>

          <div class="bb-ar-tg-outstanding">
            <div class="bb-ar-tg-outstanding-title">Latest Customer Outstanding</div>
            ${outstandingHtml(data?.latest_outstanding||{})}
          </div>

          <div class="bb-ar-tg-note">
            This update uses the confirmed A/R payment and current Supabase outstanding balance. The bot does not clear or change receivables.
          </div>

          <div class="bb-ar-tg-actions">
            <button type="button" class="bb-ar-tg-cancel">Not Now</button>
            <button type="button" class="bb-ar-tg-send">✈ Send A/R Update</button>
          </div>
        </div>`;

      document.body.appendChild(modal);

      let settled=false;
      const finish=value=>{
        if(settled)return;
        settled=true;
        closeModal();
        resolve(value);
      };

      modal.querySelector('.bb-ar-tg-close')?.addEventListener('click',()=>finish(false));
      modal.querySelector('.bb-ar-tg-cancel')?.addEventListener('click',()=>finish(false));
      modal.querySelector('.bb-ar-tg-send')?.addEventListener('click',()=>finish(true));
      modal.addEventListener('click',event=>{
        if(event.target===modal)finish(false);
      });
    });
  }

  function showProgress(data){
    closeModal();
    const modal=document.createElement('div');
    modal.id='bbArTelegramModal';
    modal.className='bb-ar-tg-backdrop';
    modal.innerHTML=`
      <div class="bb-ar-tg-card bb-ar-tg-progress">
        <div class="bb-ar-tg-spinner"></div>
        <h2>Sending A/R Update…</h2>
        <p>${esc(data?.payment?.payment_id||'Payment')} is being sent to the customer Telegram destination.</p>
      </div>`;
    document.body.appendChild(modal);
  }

  function showResult(title,message,kind='success'){
    closeModal();

    return new Promise(resolve=>{
      const modal=document.createElement('div');
      modal.id='bbArTelegramModal';
      modal.className='bb-ar-tg-backdrop';
      modal.innerHTML=`
        <div class="bb-ar-tg-card bb-ar-tg-result ${esc(kind)}">
          <div class="bb-ar-tg-result-icon">${kind==='success'?'✅':'⚠️'}</div>
          <h2>${esc(title)}</h2>
          <p>${esc(message)}</p>
          <button type="button" class="bb-ar-tg-done">Done</button>
        </div>`;
      document.body.appendChild(modal);
      modal.querySelector('.bb-ar-tg-done')?.addEventListener('click',()=>{
        closeModal();
        resolve();
      });
    });
  }

  async function processPayment(paymentId){
    const id=clean(paymentId);
    if(!id||seenPayments.has(id))return;

    seenPayments.add(id);

    let eligibility;
    try{
      eligibility=await call({
        action:'eligibility',
        payment_id:id
      });
    }catch(error){
      console.warn('BIG BROTHER A/R Telegram eligibility:',error);
      return;
    }

    if(!eligibility?.eligible)return;

    /* Let the accounting success alert/load finish first. */
    await new Promise(resolve=>setTimeout(resolve,120));

    while(promptRunning){
      await new Promise(resolve=>setTimeout(resolve,120));
    }

    promptRunning=true;
    try{
      const shouldSend=await ask(eligibility);
      if(!shouldSend)return;

      showProgress(eligibility);

      try{
        const result=await call({
          action:'send',
          payment_id:id
        });

        await showResult(
          'A/R Update Sent',
          'Cleared invoice information and the latest customer outstanding were sent to '+
            (result?.destination_label||eligibility?.destination?.label||'the Telegram destination')+'.',
          'success'
        );
      }catch(error){
        const retry=error?.data?.retry_available===true;
        await showResult(
          'Telegram Send Failed',
          (error?.message||'Could not send the A/R update.')+
          (retry?' The failed job can be retried from Telegram Bot Manager.':''),
          'error'
        );
      }
    }finally{
      promptRunning=false;
    }
  }

  function handle(params,result){
    const action=clean(params?.action);
    if(!['arPayment','arBatchPayment','arClearRequest'].includes(action))return;
    if(!result?.success)return;

    const paymentId=clean(result?.paymentId);
    if(!paymentId)return;

    processPayment(paymentId).catch(error=>{
      console.warn('BIG BROTHER A/R Telegram event:',error);
    });
  }

  function ensureStyles(){
    if(document.getElementById('bb-ar-telegram-style'))return;

    const style=document.createElement('style');
    style.id='bb-ar-telegram-style';
    style.textContent=`
      .bb-ar-tg-backdrop{position:fixed;inset:0;z-index:100800;display:grid;place-items:center;padding:16px;background:rgba(7,20,38,.72);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
      .bb-ar-tg-card{width:min(440px,100%);max-height:min(88vh,760px);overflow:auto;border:1px solid #d8e4f1;border-radius:18px;background:#fff;box-shadow:0 24px 80px rgba(4,23,47,.3);padding:18px;color:#173f77;font-family:Arial,sans-serif}
      .bb-ar-tg-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
      .bb-ar-tg-kicker{color:#71859b;font-size:9px;font-weight:900;letter-spacing:.45px}
      .bb-ar-tg-head h2,.bb-ar-tg-progress h2,.bb-ar-tg-result h2{margin:4px 0 0;color:#173f77;font-size:20px;line-height:1.2}
      .bb-ar-tg-close{width:38px;height:38px;border:0;border-radius:10px;background:#edf2f7;color:#36536f;font-size:23px;font-weight:900}
      .bb-ar-tg-success{margin-top:14px;border-radius:11px;background:#eaf8ef;color:#126b3f;padding:11px 12px;font-size:13px;font-weight:900}
      .bb-ar-tg-details{display:grid;margin-top:13px;border:1px solid #e1e9f2;border-radius:13px;overflow:hidden}
      .bb-ar-tg-details>div{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:10px 12px;border-bottom:1px solid #edf2f6}
      .bb-ar-tg-details>div:last-child{border-bottom:0}
      .bb-ar-tg-details span{color:#71859a;font-size:11px}
      .bb-ar-tg-details strong{max-width:65%;color:#203e61;font-size:12px;text-align:right;overflow-wrap:anywhere}
      .bb-ar-tg-outstanding{margin-top:12px;border:1px solid #d7e3ef;border-radius:12px;background:#f8fbfe;padding:11px 12px}
      .bb-ar-tg-outstanding-title{margin-bottom:7px;color:#385b7f;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.35px}
      .bb-ar-tg-outstanding-row{display:flex;justify-content:space-between;gap:12px;padding:4px 0;font-size:12px}
      .bb-ar-tg-all-clear{color:#126b3f;font-size:12px;font-weight:900}
      .bb-ar-tg-open-count{margin-top:5px;color:#72869a;font-size:10px}
      .bb-ar-tg-note{margin-top:12px;color:#667b91;font-size:10px;line-height:1.45}
      .bb-ar-tg-actions{display:grid;grid-template-columns:1fr 1.4fr;gap:9px;margin-top:16px}
      .bb-ar-tg-actions button,.bb-ar-tg-done{min-height:48px;border:0;border-radius:11px;padding:10px 12px;font-size:13px;font-weight:900}
      .bb-ar-tg-cancel{background:#e9eef5;color:#36536f}
      .bb-ar-tg-send,.bb-ar-tg-done{background:#18864b;color:#fff}
      .bb-ar-tg-progress,.bb-ar-tg-result{text-align:center;padding:26px 22px}
      .bb-ar-tg-progress p,.bb-ar-tg-result p{margin:9px auto 0;max-width:340px;color:#64798f;font-size:11px;line-height:1.5}
      .bb-ar-tg-spinner{width:42px;height:42px;margin:0 auto 13px;border:4px solid #deebf7;border-top-color:#245fae;border-radius:50%;animation:bbArTgSpin .75s linear infinite}
      @keyframes bbArTgSpin{to{transform:rotate(360deg)}}
      .bb-ar-tg-result-icon{font-size:38px;line-height:1;margin-bottom:10px}
      .bb-ar-tg-result.error .bb-ar-tg-done{background:#b15c25}
      .bb-ar-tg-done{width:100%;margin-top:17px}
      @media(max-width:480px){.bb-ar-tg-backdrop{padding:10px}.bb-ar-tg-card{border-radius:15px;padding:15px}.bb-ar-tg-actions{grid-template-columns:1fr}.bb-ar-tg-details strong{max-width:60%}}
    `;
    document.head.appendChild(style);
  }

  ensureStyles();

  window.BBReceivableTelegram={
    handle,
    processPayment,
    eligibility:paymentId=>call({action:'eligibility',payment_id:paymentId})
  };
})();