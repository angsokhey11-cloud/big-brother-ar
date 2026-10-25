/* BIG BROTHER A/R Notification Focus V1
   One-time, permission-safe deep link. Uses only the rows already loaded by
   Your Receivable / All Receivable; never fetches extra data or changes A/R.
*/
(function(){
  'use strict';
  if(window.BBARNotificationFocusV1)return;
  var KEY='BB_NOTIFICATION_AR_FOCUS_V1',TTL_MS=120000;
  var view=new URLSearchParams(location.search).get('view')==='all'?'ar-all':'ar-your';
  var payload=null;
  try{payload=JSON.parse(sessionStorage.getItem(KEY)||'null');}catch(_){}
  if(!payload||payload.route!==view||!payload.customerId||
     !Number.isFinite(Number(payload.createdAt))||
     Date.now()-Number(payload.createdAt)>TTL_MS||
     Number(payload.createdAt)>Date.now()+10000){
    if(payload&&(!payload.createdAt||Date.now()-Number(payload.createdAt)>TTL_MS)){
      try{sessionStorage.removeItem(KEY);}catch(_){}
    }
    return;
  }
  var done=false,observer=null,timeout=null;
  function removeTarget(){
    try{
      var current=JSON.parse(sessionStorage.getItem(KEY)||'null');
      if(current&&current.createdAt===payload.createdAt&&current.customerId===payload.customerId)
        sessionStorage.removeItem(KEY);
    }catch(_){}
  }
  function stop(){
    done=true;
    if(observer){observer.disconnect();observer=null;}
    if(timeout){clearTimeout(timeout);timeout=null;}
  }
  function text(v){return String(v==null?'':v).trim();}
  function showFocus(customer,mode){
    var filters=document.querySelector('.filters');
    if(!filters||document.getElementById('bbArNotificationFocusLabel'))return;
    var line=document.createElement('div');
    line.id='bbArNotificationFocusLabel';
    line.setAttribute('role','status');
    line.style.cssText='display:flex;gap:7px;align-items:center;flex-wrap:wrap;padding:8px 11px;margin:5px 0 9px;border:1px solid #c9ddf5;background:#edf5ff;border-radius:9px;color:#174a86;font:700 12px Arial,sans-serif;';
    line.textContent='🔔 Notification filter · '+customer+' · '+mode;
    filters.parentNode.insertBefore(line,filters);
    // Don't leave a stale "Notification filter" caption if staff changes
    // the customer or another filter manually afterward.
    function clearCaption(){if(line.parentNode)line.remove();}
    document.addEventListener('bb-ar-customer-scope-changed',clearCaption,{once:true});
    filters.addEventListener('input',clearCaption,{once:true});
    filters.addEventListener('change',clearCaption,{once:true});
  }
  function apply(){
    if(done)return;
    if(!window.BBARCustomerExcelV1?.setSelectedCustomerId)return;
    var status=document.getElementById('syncStatus');
    if(!status||!/^Up to date/i.test(text(status.textContent)))return;
    if(typeof rows==='undefined'||!Array.isArray(rows))return;
    if(!document.getElementById('arBody'))return;
    var id=text(payload.customerId);
    // Never substitute customer names from the notification or query string.
    // The already-authorized A/R list is our only source of customer identity.
    var match=rows.find(function(r){return text(r.customerId)===id&&Number(r.outstanding)>0;});
    if(!match){
      removeTarget();
      stop();
      return; // No access, fully settled, or no longer outstanding.
    }
    ['searchBox','customerFilter','locationFilter','currencyFilter',
      'arFromDateFilter','arToDateFilter','arMinAmountFilter','arMaxAmountFilter'
    ].forEach(function(key){var el=document.getElementById(key);if(el)el.value='';});
    var dateField=document.getElementById('arDateFieldFilter');
    if(dateField)dateField.value='invoiceDate';
    var statusFilter=document.getElementById('statusFilter');
    if(statusFilter)statusFilter.value=payload.view==='All Outstanding'?'':'Overdue';
    if(window.BBARCustomerExcelV1.setSelectedCustomerId(id)){
      removeTarget();
      stop();
      showFocus(text(match.customer)||id,payload.view==='All Outstanding'?'All Outstanding':'Overdue Only');
    }
  }
  function attach(){
    if(done)return;
    apply();
    if(done||observer)return;
    observer=new MutationObserver(apply);
    var status=document.getElementById('syncStatus');
    if(status)observer.observe(status,{childList:true,subtree:true,characterData:true});
    else observer.observe(document.documentElement,{childList:true,subtree:true});
    timeout=setTimeout(function(){removeTarget();stop();},TTL_MS);
  }
  window.BBARNotificationFocusV1={apply:apply};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',attach,{once:true});
  else attach();
})();
