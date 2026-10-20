/* BIG BROTHER A/R — pending customer chooser + standalone offline XLSX export.
   Export always refetches authorized Supabase A/R rows; it never queries raw tables.
   Location and customer filters apply; invoice/status/currency filters do not truncate
   a customer's open-invoice ledger. No customer data is stored remotely. */
(function(){
  'use strict';
  if(window.BBARCustomerExcelV1)return;

  var chosenExact='';
  var customerMenu, customerInput, customerWrap, customerArrow, exportButton;
  var menuOpen=false;
  var exportBusy=false;

  function id(name){return document.getElementById(name);}
  function str(v){return String(v==null?'':v).trim();}
  function norm(v){return str(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').toLowerCase();}
  function amount(v){var n=Number(v);return Number.isFinite(n)?n:0;}
  function cleanCurrency(v){return str(v).toUpperCase()==='KHR'?'KHR':'USD';}
  function currentLocation(){return str(id('locationFilter')?.value).toLowerCase();}
  function allowedLocation(r,loc){return !loc||str(r.locationCode).toLowerCase()===loc;}
  function isOpen(r){return amount(r.outstanding)>0.000001;}
  function filenameSafe(s){return str(s).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,70)||'Accounts_Receivable';}

  function pendingCustomers(){
    var loc=currentLocation(), found=new Map();
    (Array.isArray(rows)?rows:[]).forEach(function(r){
      if(!allowedLocation(r,loc)||!isOpen(r))return;
      var name=str(r.customer),key=norm(name);
      if(!name)return;
      if(!found.has(key))found.set(key,{name:name,count:0});
      found.get(key).count++;
    });
    return [...found.values()].sort(function(a,b){return a.name.localeCompare(b.name,undefined,{sensitivity:'base'});});
  }
  function setMenu(open){
    menuOpen=!!open;
    if(customerMenu)customerMenu.hidden=!menuOpen;
    if(customerArrow)customerArrow.setAttribute('aria-expanded',String(menuOpen));
  }
  function displayOptions(showAll){
    if(!customerMenu)return;
    var needle=showAll?'':norm(customerInput?.value), choices=pendingCustomers().filter(function(x){
      return !needle||norm(x.name).includes(needle);
    });
    customerMenu.replaceChildren();
    if(!choices.length){
      var none=document.createElement('div');
      none.className='bb-ar-customer-empty';
      none.textContent='No pending customers in this location';
      customerMenu.appendChild(none);
      return;
    }
    var all=document.createElement('button');
    all.type='button';all.className='bb-ar-customer-option bb-ar-customer-all';
    all.textContent='All pending customers';
    all.addEventListener('click',function(){
      chosenExact='';customerInput.value='';setMenu(false);filterChanged();
    });
    customerMenu.appendChild(all);
    choices.forEach(function(x){
      var b=document.createElement('button');
      b.type='button';b.className='bb-ar-customer-option';b.title=x.name;
      var name=document.createElement('span');name.className='bb-ar-name';name.textContent=x.name;
      var count=document.createElement('span');count.className='bb-ar-count';count.textContent=x.count+' invoice'+(x.count===1?'':'s');
      b.append(name,count);
      b.addEventListener('click',function(){
        chosenExact=norm(x.name);customerInput.value=x.name;setMenu(false);filterChanged();
      });
      customerMenu.appendChild(b);
    });
  }
  function refreshCustomerMenu(){
    if(!customerInput)return;
    if(chosenExact&&!pendingCustomers().some(function(x){return norm(x.name)===chosenExact;})){
      chosenExact='';customerInput.value='';
      // Location changed: discard a customer that is no longer in the permitted scope.
      // The caller's original renderRows already ran; rerender once with the cleared filter.
      if(typeof filterChanged==='function')filterChanged();
      return;
    }
    displayOptions(false);
  }

  function installUI(){
    customerInput=id('customerFilter');
    var filters=document.querySelector('.filters');
    if(!customerInput||!filters||id('bbArExcelExport'))return false;

    customerWrap=document.createElement('div');
    customerWrap.className='bb-ar-customer-combo';
    customerInput.parentNode.insertBefore(customerWrap,customerInput);
    customerWrap.appendChild(customerInput);
    customerInput.setAttribute('aria-label','Search or choose a pending customer');
    customerInput.setAttribute('placeholder','Search / choose pending customer');

    customerArrow=document.createElement('button');
    customerArrow.type='button';
    customerArrow.className='bb-ar-customer-arrow';
    customerArrow.setAttribute('aria-label','Show pending customer names');
    customerArrow.setAttribute('aria-haspopup','listbox');
    customerArrow.setAttribute('aria-expanded','false');
    customerArrow.textContent='▾';
    customerWrap.appendChild(customerArrow);

    customerMenu=document.createElement('div');
    customerMenu.className='bb-ar-customer-menu';
    customerMenu.setAttribute('role','listbox');
    customerMenu.hidden=true;
    customerWrap.appendChild(customerMenu);

    customerArrow.addEventListener('click',function(ev){
      ev.preventDefault();ev.stopPropagation();
      if(menuOpen){setMenu(false);return;}
      displayOptions(true);setMenu(true);
    });
    customerInput.addEventListener('focus',function(){displayOptions(false);setMenu(true);});
    customerInput.addEventListener('input',function(){
      chosenExact='';
      displayOptions(false);
      setMenu(true);
    });
    customerInput.addEventListener('keydown',function(ev){
      if(ev.key==='Escape')setMenu(false);
    });
    document.addEventListener('pointerdown',function(ev){
      if(customerWrap&&!customerWrap.contains(ev.target))setMenu(false);
    });
    id('locationFilter')?.addEventListener('change',function(){refreshCustomerMenu();});

    var bar=document.createElement('div');
    bar.className='bb-ar-export-bar';
    var hint=document.createElement('span');
    hint.textContent='Excel: all outstanding invoices · 1 sheet per customer · selected permitted location';
    exportButton=document.createElement('button');
    exportButton.type='button';exportButton.id='bbArExcelExport';
    exportButton.className='btn bb-ar-export-btn';
    exportButton.textContent='⬇ Export Excel';
    exportButton.addEventListener('click',exportExcel);
    bar.append(hint,exportButton);
    filters.insertAdjacentElement('afterend',bar);

    var styles=document.createElement('style');
    styles.id='bbArCustomerExcelStyles';
    styles.textContent=[
      '.bb-ar-customer-combo{position:relative;min-width:0;width:100%}',
      '.bb-ar-customer-combo #customerFilter{padding-right:37px;width:100%;box-sizing:border-box}',
      '.bb-ar-customer-arrow{position:absolute;top:1px;right:1px;bottom:1px;width:36px;z-index:2;border:0;border-left:1px solid #cbd6e3;border-radius:0 8px 8px 0;background:#edf5ff;color:#17457a;font-size:21px;cursor:pointer}',
      '.bb-ar-customer-menu{position:absolute;z-index:1200;top:calc(100% + 3px);left:0;right:0;min-width:min(340px,88vw);max-height:280px;overflow:auto;background:#fff;border:1px solid #9ebcdd;box-shadow:0 10px 28px #163b6933;border-radius:10px;padding:4px}',
      '.bb-ar-customer-menu[hidden]{display:none!important}',
      '.bb-ar-customer-option{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 10px;border:0;background:#fff;color:#20384f;text-align:left;cursor:pointer;width:100%;font-size:13px;border-radius:6px}',
      '.bb-ar-customer-option:hover,.bb-ar-customer-option:focus{background:#eaf3ff}',
      '.bb-ar-name{font-family:"Noto Sans Khmer","Khmer OS System",Arial,sans-serif;white-space:normal}',
      '.bb-ar-count{flex:none;font-size:11px;color:#65788d}',
      '.bb-ar-customer-all{font-weight:750;color:#1759a1;border-bottom:1px solid #dbe5f0}',
      '.bb-ar-customer-empty{padding:12px;color:#718097;font-size:12px}',
      '.bb-ar-export-bar{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:8px 14px;border-bottom:1px solid #e1eaf5;background:#fafcff}',
      '.bb-ar-export-bar span{color:#516984;font-size:11px;font-weight:600}',
      '.bb-ar-export-btn{background:#157245;color:#fff;white-space:nowrap}',
      '.bb-ar-export-btn:disabled{opacity:.55;cursor:wait}',
      '@media(max-width:900px){.filters.bb-mobile-filter-panel .bb-ar-customer-combo{grid-column:1/-1!important}.bb-ar-export-bar{padding:7px 10px}.bb-ar-export-bar span{max-width:60%;font-size:10px}.bb-ar-export-btn{font-size:11px;padding:8px 11px}}'
    ].join('\n');
    document.head.appendChild(styles);

    // This global renderer is invoked both after initial data load and every 20s sync.
    var originalRender=window.renderRows;
    if(typeof originalRender==='function'){
      window.renderRows=function(){var out=originalRender.apply(this,arguments);refreshCustomerMenu();return out;};
    }
    refreshCustomerMenu();
    return true;
  }

  function xml(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
  function ref(col,row){return col+String(row);}
  function textCell(col,row,value,style){
    return '<c r="'+ref(col,row)+'" s="'+(style||0)+'" t="inlineStr"><is><t xml:space="preserve">'+xml(value)+'</t></is></c>';
  }
  function numberCell(col,row,value,style){
    return '<c r="'+ref(col,row)+'" s="'+(style||3)+'"><v>'+amount(value)+'</v></c>';
  }
  function formulaCell(col,row,formula,cached,style){
    return '<c r="'+ref(col,row)+'" s="'+(style||3)+'"><f>'+xml(formula)+'</f><v>'+amount(cached)+'</v></c>';
  }
  function excelRow(n,cells){return '<row r="'+n+'">'+cells.join('')+'</row>';}
  function dateText(value){
    return typeof formatReceivableInvoiceDate==='function'?formatReceivableInvoiceDate(value):str(value);
  }
  function sheetXml(entry,locationLabel){
    var list=typeof sortReceivablesOldestFirst==='function'?sortReceivablesOldestFirst(entry.rows):entry.rows.slice();
    var sh=['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="7" topLeftCell="A8" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
      '<cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="3" width="17" customWidth="1"/><col min="4" max="4" width="28" customWidth="1"/><col min="5" max="5" width="12" customWidth="1"/><col min="6" max="8" width="19" customWidth="1"/><col min="9" max="9" width="16" customWidth="1"/></cols><sheetData>'];
    sh.push(excelRow(1,[textCell('A',1,'BIG BROTHER — ACCOUNTS RECEIVABLE',2)]));
    sh.push(excelRow(2,[textCell('A',2,'Customer: '+entry.name,2)]));
    sh.push(excelRow(3,[textCell('A',3,'Location: '+locationLabel)]));
    sh.push(excelRow(4,[textCell('A',4,'Exported: '+new Date().toLocaleString())]));
    sh.push(excelRow(5,[textCell('A',5,'Open invoices: '+list.length)]));
    var headers=['Invoice No.','Invoice Date','Due Date','Location','Currency','Grand Total','Amount Paid','Outstanding','Status'];
    sh.push(excelRow(7,headers.map(function(h,i){return textCell('ABCDEFGHI'[i],7,h,1);})));
    var usd=0,khr=0;
    list.forEach(function(r,i){
      var row=i+8,ccy=cleanCurrency(r.currency),style=ccy==='KHR'?4:3,val=amount(r.outstanding);
      if(ccy==='KHR')khr+=val;else usd+=val;
      sh.push(excelRow(row,[
        textCell('A',row,str(r.invoiceNo)),
        textCell('B',row,dateText(r.invoiceDate)),
        textCell('C',row,dateText(r.dueDate)),
        textCell('D',row,str(r.locationName||r.locationCode)+' ('+str(r.locationCode)+')'),
        textCell('E',row,ccy),
        numberCell('F',row,r.grandTotal,style),
        numberCell('G',row,r.amountPaid,style),
        numberCell('H',row,val,style),
        textCell('I',row,str(r.arStatus||'Outstanding'))
      ]));
    });
    var end=7+list.length,usdRow=end+2,khrRow=end+3;
    sh.push(excelRow(usdRow,[
      textCell('F',usdRow,'TOTAL OUTSTANDING USD',2),
      formulaCell('H',usdRow,'SUMIF(E8:E'+end+',"USD",H8:H'+end+')',usd,3)
    ]));
    sh.push(excelRow(khrRow,[
      textCell('F',khrRow,'TOTAL OUTSTANDING KHR',2),
      formulaCell('H',khrRow,'SUMIF(E8:E'+end+',"KHR",H8:H'+end+')',khr,4)
    ]));
    sh.push('</sheetData><autoFilter ref="A7:I'+Math.max(7,end)+'"/></worksheet>');
    return sh.join('');
  }
  function bookStyles(){
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
      '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FF173F73"/><sz val="12"/><name val="Calibri"/></font></fonts>'+
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF174F8A"/><bgColor indexed="64"/></patternFill></fill></fills>'+
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
      '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'+
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  }
  function uniqueSheetNames(entries){
    var used=new Set();
    entries.forEach(function(e){
      var base=[...e.name.replace(/[\\/*?:\[\]]/g,' ').replace(/^'+|'+$/g,'').trim()].slice(0,31).join('')||'Customer';
      var name=base,n=2;
      while(used.has(name.toLowerCase())){
        var suffix=' ('+n+++')';
        name=[...base].slice(0,31-suffix.length).join('')+suffix;
      }
      e.sheet=name;used.add(name.toLowerCase());
    });
  }
  function bookFiles(entries,locationLabel){
    uniqueSheetNames(entries);
    var sheets=entries.map(function(e,i){return '<sheet name="'+xml(e.sheet)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>';}).join('');
    var rels=entries.map(function(e,i){
      return '<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>';
    }).join('');
    var types=entries.map(function(e,i){
      return '<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    }).join('');
    var f=[
      {name:'[Content_Types].xml',text:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+types+'</Types>'},
      {name:'_rels/.rels',text:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
      {name:'xl/workbook.xml',text:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+sheets+'</sheets><calcPr fullCalcOnLoad="1"/></workbook>'},
      {name:'xl/_rels/workbook.xml.rels',text:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+rels+'<Relationship Id="rId'+(entries.length+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},
      {name:'xl/styles.xml',text:bookStyles()}
    ];
    entries.forEach(function(e,i){f.push({name:'xl/worksheets/sheet'+(i+1)+'.xml',text:sheetXml(e,locationLabel)});});
    return f;
  }

  // A dependency-free ZIP "store" writer keeps XLSX export usable offline.
  var crcTable=(function(){
    var t=new Uint32Array(256);
    for(var n=0;n<256;n++){var c=n;for(var k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}
    return t;
  })();
  function crc32(data){
    var c=0xFFFFFFFF;
    for(var i=0;i<data.length;i++)c=crcTable[(c^data[i])&255]^(c>>>8);
    return (c^0xFFFFFFFF)>>>0;
  }
  function zipStore(files){
    var encoder=new TextEncoder(),parts=[],directory=[],offset=0,size=0;
    files.forEach(function(file){
      var name=encoder.encode(file.name),data=encoder.encode(file.text),crc=crc32(data);
      var local=new Uint8Array(30+name.length),v=new DataView(local.buffer);
      v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);
      v.setUint16(6,0x0800,true);v.setUint16(8,0,true);
      v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);
      v.setUint16(26,name.length,true);local.set(name,30);
      parts.push(local,data);
      var dir=new Uint8Array(46+name.length),d=new DataView(dir.buffer);
      d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);
      d.setUint16(8,0x0800,true);d.setUint16(10,0,true);
      d.setUint32(16,crc,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);
      d.setUint16(28,name.length,true);d.setUint32(42,offset,true);dir.set(name,46);
      directory.push(dir);size+=dir.length;offset+=local.length+data.length;
    });
    var end=new Uint8Array(22),v=new DataView(end.buffer);
    v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);
    v.setUint16(10,files.length,true);v.setUint32(12,size,true);
    v.setUint32(16,offset,true);
    return new Blob(parts.concat(directory,[end]),{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }

  async function exportExcel(){
    if(exportBusy)return;
    exportBusy=true;exportButton.disabled=true;exportButton.textContent='Preparing Excel…';
    try{
      if(typeof apiPost!=='function'||!sessionToken)throw new Error('A/R session is not ready.');
      var loc=currentLocation(),typed=norm(customerInput?.value);
      var result=await apiPost({action:'arList',sessionToken:sessionToken,view:VIEW});
      if(!result||result.success!==true||!Array.isArray(result.receivables))throw new Error(result?.error||'Could not refresh authorized outstanding invoices.');
      var authorized=result.receivables.filter(function(r){
        if(!allowedLocation(r,loc)||!isOpen(r))return false;
        var key=norm(r.customer);
        return !typed||(chosenExact?key===chosenExact:key.includes(typed));
      });
      if(!authorized.length){alert('No outstanding invoices for the selected customer/location.');return;}
      var groups=new Map();
      authorized.forEach(function(r){
        var name=str(r.customer)||'Unnamed customer';
        var key=str(r.customerId)?('id:'+str(r.customerId)):('name:'+norm(name));
        if(!groups.has(key))groups.set(key,{name:name,rows:[]});
        groups.get(key).rows.push(r);
      });
      var entries=[...groups.values()].sort(function(a,b){return a.name.localeCompare(b.name,undefined,{sensitivity:'base'});});
      var locLabel=loc?(id('locationFilter')?.selectedOptions?.[0]?.textContent||loc):'All permitted locations';
      var book=zipStore(bookFiles(entries,locLabel));
      var href=URL.createObjectURL(book),link=document.createElement('a');
      var stamp=new Date(),date=stamp.getFullYear()+'-'+String(stamp.getMonth()+1).padStart(2,'0')+'-'+String(stamp.getDate()).padStart(2,'0');
      link.href=href;link.download=filenameSafe('BIG_BROTHER_AR_'+(loc||'All_Permitted')+'_'+date)+'.xlsx';
      document.body.appendChild(link);link.click();link.remove();
      setTimeout(function(){URL.revokeObjectURL(href);},15000);
    }catch(err){
      console.error('BIG BROTHER A/R Excel export:',err);
      alert('Excel export failed: '+String(err&&err.message||err));
    }finally{
      exportBusy=false;exportButton.disabled=false;exportButton.textContent='⬇ Export Excel';
    }
  }

  window.BBARCustomerExcelV1={exportExcel:exportExcel};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installUI,{once:true});
  else installUI();
})();