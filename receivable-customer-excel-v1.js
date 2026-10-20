/* BIG BROTHER A/R — multi-select pending customer filter + standalone offline XLSX.
   Both table and export respect the user's authorized A/R view and location.
   When customer checkboxes are selected, they replace free-text customer filtering.
   The Excel export refetches authorized balances, then creates one sheet/customer. */
(function(){
  'use strict';
  if(window.BBARCustomerExcelV1)return;

  var selectedCustomers=new Set();
  var customerMenu,customerInput,customerWrap,customerArrow,exportButton;
  var menuOpen=false,exportBusy=false;

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
    var loc=currentLocation(),found=new Map();
    (Array.isArray(rows)?rows:[]).forEach(function(r){
      if(!allowedLocation(r,loc)||!isOpen(r))return;
      var name=str(r.customer),key=norm(name);
      if(!name)return;
      if(!found.has(key))found.set(key,{name:name,count:0});
      found.get(key).count++;
    });
    return [...found.values()].sort(function(a,b){return a.name.localeCompare(b.name,undefined,{sensitivity:'base'});});
  }
  function filterSelectedCustomers(list){
    return selectedCustomers.size?list.filter(function(r){return selectedCustomers.has(norm(r.customer));}):list;
  }
  function setMenu(open){
    menuOpen=!!open;
    if(customerMenu)customerMenu.hidden=!menuOpen;
    if(customerArrow)customerArrow.setAttribute('aria-expanded',String(menuOpen));
  }
  function updateInputSummary(){
    if(!customerInput)return;
    var count=selectedCustomers.size;
    customerInput.placeholder=count?(count+' customer'+(count===1?'':'s')+' selected · search to add'):'Search / choose pending customers';
    customerInput.setAttribute('aria-label',count?(count+' customers selected. Search to add more.'):'Search or select pending customers');
    if(customerWrap)customerWrap.classList.toggle('bb-ar-has-selection',count>0);
  }
  function pruneLocationSelections(){
    if(!selectedCustomers.size)return;
    var allowed=new Set(pendingCustomers().map(function(x){return norm(x.name);}));
    for(var key of [...selectedCustomers])if(!allowed.has(key))selectedCustomers.delete(key);
  }
  function renderChanged(){
    // Checked invoice selections must not survive changes to the customer scope.
    if(typeof selectedInvoices!=='undefined')selectedInvoices.clear();
    if(typeof renderRows==='function')renderRows();
  }
  function displayOptions(showAll){
    if(!customerMenu||!customerInput)return;
    var scrollTop=customerMenu.scrollTop;
    var needle=showAll?'':norm(customerInput.value);
    var options=pendingCustomers().filter(function(x){return !needle||norm(x.name).includes(needle);});
    customerMenu.replaceChildren();

    var tools=document.createElement('div');
    tools.className='bb-ar-multi-actions';
    var all=document.createElement('button');
    all.type='button';all.className='bb-ar-multi-action';
    all.textContent='All customers';
    all.title='Clear customer checkboxes and view every customer in this location';
    all.addEventListener('click',function(){
      selectedCustomers.clear();
      customerInput.value='';
      renderChanged();
      setMenu(true);
    });
    var selectShown=document.createElement('button');
    selectShown.type='button';selectShown.className='bb-ar-multi-action';
    selectShown.textContent='✓ Select shown ('+options.length+')';
    selectShown.disabled=!options.length;
    selectShown.title='Select every customer currently listed in this dropdown';
    selectShown.addEventListener('click',function(){
      options.forEach(function(x){selectedCustomers.add(norm(x.name));});
      renderChanged();
      setMenu(true);
    });
    var counter=document.createElement('span');
    counter.className='bb-ar-multi-counter';
    counter.textContent=selectedCustomers.size+' selected';
    counter.setAttribute('aria-live','polite');
    tools.append(all,selectShown,counter);
    customerMenu.appendChild(tools);

    if(!options.length){
      var none=document.createElement('div');
      none.className='bb-ar-customer-empty';
      none.textContent='No pending customers match this search';
      customerMenu.appendChild(none);
    }

    options.forEach(function(x){
      var item=document.createElement('label');
      item.className='bb-ar-customer-option bb-ar-check-option';
      item.title=x.name;
      var checkbox=document.createElement('input');
      checkbox.type='checkbox';
      checkbox.checked=selectedCustomers.has(norm(x.name));
      checkbox.setAttribute('aria-label','Include '+x.name+' in customer review');
      var name=document.createElement('span');
      name.className='bb-ar-name';name.textContent=x.name;
      var count=document.createElement('span');
      count.className='bb-ar-count';count.textContent=x.count+' invoice'+(x.count===1?'':'s');
      item.append(checkbox,name,count);
      checkbox.addEventListener('change',function(){
        var key=norm(x.name);
        if(checkbox.checked)selectedCustomers.add(key);
        else selectedCustomers.delete(key);
        renderChanged();
        setMenu(true);
      });
      customerMenu.appendChild(item);
    });
    customerMenu.scrollTop=scrollTop;
  }
  function refreshCustomerMenu(){
    pruneLocationSelections();
    updateInputSummary();
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
    customerInput.removeAttribute('readonly');
    customerInput.removeAttribute('list'); // no native datalist on top of the checkbox list
    customerInput.setAttribute('aria-label','Search or select pending customers');

    customerArrow=document.createElement('button');
    customerArrow.type='button';
    customerArrow.className='bb-ar-customer-arrow';
    customerArrow.setAttribute('aria-label','Show pending customers and checkboxes');
    customerArrow.setAttribute('aria-haspopup','listbox');
    customerArrow.setAttribute('aria-expanded','false');
    customerArrow.textContent='▾';
    customerWrap.appendChild(customerArrow);

    customerMenu=document.createElement('div');
    customerMenu.className='bb-ar-customer-menu';
    customerMenu.setAttribute('role','group');
    customerMenu.setAttribute('aria-label','Pending customer multiple selection');
    customerMenu.hidden=true;
    customerWrap.appendChild(customerMenu);

    customerArrow.addEventListener('click',function(ev){
      ev.preventDefault();ev.stopPropagation();
      if(menuOpen){setMenu(false);return;}
      displayOptions(true);setMenu(true);
    });
    customerInput.addEventListener('focus',function(){displayOptions(false);setMenu(true);});
    customerInput.addEventListener('input',function(){displayOptions(false);setMenu(true);});
    customerInput.addEventListener('keydown',function(ev){
      if(ev.key==='Escape')setMenu(false);
    });
    document.addEventListener('pointerdown',function(ev){
      if(customerWrap&&!customerWrap.contains(ev.target))setMenu(false);
    });

    var bar=document.createElement('div');
    bar.className='bb-ar-export-bar';
    var hint=document.createElement('span');
    hint.textContent='Excel: selected customers · all outstanding invoices · one sheet each';
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
      '.bb-ar-customer-combo.bb-ar-has-selection #customerFilter::placeholder{color:#145b9b;opacity:1;font-weight:750}',
      '.bb-ar-customer-arrow{position:absolute;top:1px;right:1px;bottom:1px;width:36px;z-index:2;border:0;border-left:1px solid #cbd6e3;border-radius:0 8px 8px 0;background:#edf5ff;color:#17457a;font-size:21px;cursor:pointer}',
      '.bb-ar-customer-menu{position:absolute;z-index:1200;top:calc(100% + 3px);left:0;right:0;min-width:min(365px,88vw);max-height:min(45vh,330px);overflow:auto;background:#fff;border:1px solid #9ebcdd;box-shadow:0 10px 28px #163b6933;border-radius:10px;padding:4px}',
      '.bb-ar-customer-menu[hidden]{display:none!important}',
      '.bb-ar-multi-actions{display:flex;align-items:center;gap:5px;flex-wrap:wrap;position:sticky;top:-4px;z-index:1;padding:6px 3px;background:#fff;border-bottom:1px solid #dce8f5}',
      '.bb-ar-multi-action{background:#edf5ff;border:1px solid #d7e6f7;border-radius:6px;color:#1759a1;font:700 11px Arial,sans-serif;padding:6px;cursor:pointer}',
      '.bb-ar-multi-action:disabled{opacity:.5}',
      '.bb-ar-multi-counter{font:700 10px Arial,sans-serif;color:#536c86;margin-left:auto}',
      '.bb-ar-customer-option{display:flex;align-items:center;gap:9px;padding:9px 10px;border:0;background:#fff;color:#20384f;text-align:left;cursor:pointer;width:100%;box-sizing:border-box;font-size:13px;border-radius:6px}',
      '.bb-ar-customer-option:hover,.bb-ar-customer-option:focus-within{background:#eaf3ff}',
      '.bb-ar-customer-option input[type="checkbox"]{appearance:auto!important;flex:0 0 16px!important;width:16px!important;height:16px!important;margin:0!important;padding:0!important;accent-color:#175ba2;cursor:pointer}',
      '.bb-ar-name{font-family:"Noto Sans Khmer","Khmer OS System",Arial,sans-serif;white-space:normal;flex:1;min-width:0}',
      '.bb-ar-count{flex:none;font-size:11px;color:#65788d}',
      '.bb-ar-customer-empty{padding:12px;color:#718097;font-size:12px}',
      '.bb-ar-export-bar{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:8px 14px;border-bottom:1px solid #e1eaf5;background:#fafcff}',
      '.bb-ar-export-bar span{color:#516984;font-size:11px;font-weight:600}',
      '.bb-ar-export-btn{background:#157245;color:#fff;white-space:nowrap}',
      '.bb-ar-export-btn:disabled{opacity:.55;cursor:wait}',
      '@media(max-width:900px){.filters.bb-mobile-filter-panel .bb-ar-customer-combo{grid-column:1/-1!important}.bb-ar-export-bar{padding:7px 10px}.bb-ar-export-bar span{max-width:60%;font-size:10px}.bb-ar-export-btn{font-size:11px;padding:8px 11px}}'
    ].join('\n');
    document.head.appendChild(styles);

    // The original A/R renderer calculates table + totals from "rows".
    // Apply the checkbox scope only for that synchronous render; restore the
    // complete authorized list afterward for payment actions and Excel export.
    var originalRender=window.renderRows;
    if(typeof originalRender==='function'){
      window.renderRows=function(){
        pruneLocationSelections();
        var allRows=rows;
        var originalSearch=customerInput.value;
        if(selectedCustomers.size){
          rows=filterSelectedCustomers(allRows);
          customerInput.value=''; // legacy text search must not remove other checked customers
        }
        try{return originalRender.apply(this,arguments);}
        finally{
          rows=allRows;
          customerInput.value=originalSearch;
          refreshCustomerMenu();
        }
      };
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
      var loc=currentLocation(),typed=selectedCustomers.size?'':norm(customerInput?.value);
      var result=await apiPost({action:'arList',sessionToken:sessionToken,view:VIEW});
      if(!result||result.success!==true||!Array.isArray(result.receivables))throw new Error(result?.error||'Could not refresh authorized outstanding invoices.');
      var authorized=result.receivables.filter(function(r){
        if(!allowedLocation(r,loc)||!isOpen(r))return false;
        var key=norm(r.customer);
        return selectedCustomers.size?selectedCustomers.has(key):(!typed||key.includes(typed));
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

  window.BBARCustomerExcelV1={exportExcel:exportExcel,filterSelectedCustomers:filterSelectedCustomers,getSelectedNames:function(){return [...selectedCustomers];},setSelectedNames:function(names){selectedCustomers=new Set((names||[]).map(norm));},clearSelection:function(){selectedCustomers.clear();if(customerInput)customerInput.value='';refreshCustomerMenu();}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installUI,{once:true});
  else installUI();
})();