/* BIG BROTHER — Accounts Receivable Supabase Adapter V1 */
(function(){
  'use strict';

  const URL='https://sjfhlaclgmkwwofzstok.supabase.co';
  const KEY='sb_publishable_w762jR65CWwlO30fKQsYOw_6L9grx8S';
  const SESSION_KEY='BB_SUPABASE_DEV_SESSION_V1';
  let session=null;

  function readSession(){
    try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}
    catch(_){return null}
  }

  function saveSession(value){
    session=value||null;
    try{
      if(!value){localStorage.removeItem(SESSION_KEY);return;}
      if(!value.expires_at&&value.expires_in){
        value.expires_at=Math.floor(Date.now()/1000)+Number(value.expires_in);
      }
      localStorage.setItem(SESSION_KEY,JSON.stringify(value));
    }catch(_){}
  }

  async function parse(response){
    const text=await response.text();
    let data={};
    try{data=text?JSON.parse(text):{}}
    catch(_){data={message:text}}
    if(!response.ok){
      throw new Error(
        data.message||data.error_description||data.error||
        ('Accounts Receivable database request failed ('+response.status+')')
      );
    }
    return data;
  }

  async function refreshSession(){
    const current=readSession();
    if(!current?.refresh_token){
      throw new Error('Please sign in to BIG BROTHER first.');
    }
    const response=await fetch(URL+'/auth/v1/token?grant_type=refresh_token',{
      method:'POST',
      headers:{apikey:KEY,'Content-Type':'application/json'},
      body:JSON.stringify({refresh_token:current.refresh_token})
    });
    const next=await parse(response);
    saveSession(next);
    return next;
  }

  async function ensureSession(){
    session=readSession();
    if(!session?.access_token){
      throw new Error('Please sign in to BIG BROTHER first.');
    }
    const now=Math.floor(Date.now()/1000);
    if(session.expires_at&&Number(session.expires_at)<now+30){
      await refreshSession();
    }
    return session;
  }

  async function rpc(fn,args={}){
    await ensureSession();
    const response=await fetch(URL+'/rest/v1/rpc/'+fn,{
      method:'POST',
      headers:{
        apikey:KEY,
        Authorization:'Bearer '+session.access_token,
        'Content-Type':'application/json'
      },
      body:JSON.stringify(args||{}),
      cache:'no-store'
    });
    return parse(response);
  }

  function payload(value){
    if(value&&typeof value==='object')return value;
    if(typeof value!=='string'||!value.trim())return {};
    try{return JSON.parse(value)}
    catch(_){throw new Error('Invalid Accounts Receivable request data.');}
  }

  async function apiPost(params={}){
    const action=String(params.action||'');
    switch(action){
      case 'arList':
        return String(params.view||'').toLowerCase()==='all'
          ? rpc('bb_ar_list_all')
          : rpc('bb_ar_list');
      case 'arDetail':
        return String(params.view||'').toLowerCase()==='all'
          ? rpc('bb_ar_detail_all',{p_invoice_no:String(params.invoiceNo||'')})
          : rpc('bb_ar_detail',{p_invoice_no:String(params.invoiceNo||'')});
      case 'arPaymentRequest':
      case 'arBatchRequest':
        return rpc('bb_ar_create_request',{p_payload:payload(params.requestData)});
      case 'arPayment':
        return rpc('bb_ar_receive_payment',{p_payload:payload(params.paymentData)});
      case 'arBatchPayment':
        return rpc('bb_ar_receive_batch_payment',{p_payload:payload(params.paymentData)});
      case 'arRequestDetail':
        return rpc('bb_ar_request_detail',{p_request_id:String(params.requestId||'')});
      case 'arClearRequest':
        return rpc('bb_ar_clear_request',{p_payload:payload(params.requestData)});
      case 'arRejectRequest':
        return rpc('bb_ar_reject_request',{p_payload:payload(params.requestData)});
      case 'arRevision': {
        const revision=await rpc('bb_ar_revision');
        return {success:true,revision:String(revision||'')};
      }
      default:
        throw new Error('Unsupported Accounts Receivable action: '+action);
    }
  }

  async function accessProfile(view=''){
    let scope=String(view||'').toLowerCase();
    if(!scope){
      try{scope=String(new URLSearchParams(location.search).get('view')||'').toLowerCase()}catch(_){}
    }
    return scope==='all'
      ? rpc('bb_ar_access_profile_all')
      : rpc('bb_ar_access_profile');
  }

  async function signOut(){
    const current=readSession();
    try{
      if(current?.access_token){
        await fetch(URL+'/auth/v1/logout',{
          method:'POST',
          headers:{apikey:KEY,Authorization:'Bearer '+current.access_token}
        });
      }
    }catch(_){}
    saveSession(null);
  }

  window.BBARAdapter={rpc,apiPost,accessProfile,ensureSession,signOut};

  /* Load the audit/continuity backup only after the real Supabase adapter exists. */
  try{
    const script=document.createElement('script');
    script.src='receivable-backup-v1.js?v=20260916-1';
    script.async=false;
    (document.head||document.documentElement).appendChild(script);
  }catch(error){
    console.warn('BIG BROTHER receivable backup loader:',error);
  }
})();
