'use strict';
// Demo data never calls the server's business mutation endpoints.
const DEMO_KEY='bytmarket-demo-v1';
let demoData=null;
function demoLoad(){
  if(demoData)return demoData;
  try{demoData=JSON.parse(localStorage.getItem(DEMO_KEY));}catch{demoData=null;}
  if(!demoData || !Array.isArray(demoData.products))demoData=structuredClone(window.BytDemo.seed);
  return demoData;
}
function demoRecalculate(d){
  if(window.BytOperations)window.BytOperations.enhance(d);
  (window.BytModules||[]).forEach(m=>m.enhance?.(d));
  d.products.forEach(p=>{p.available=p.stock-p.reserved;});
  d.summary={products:d.products.length,clients:d.clients.length,orders:d.orders.filter(o=>o.status==='reserved').length,reserved_value:d.orders.filter(o=>o.status==='reserved').reduce((s,o)=>s+o.total,0)};
}
function demoSave(){demoRecalculate(demoData);localStorage.setItem(DEMO_KEY,JSON.stringify(demoData));window.BytPersistence?.schedule(demoData);}
function demoId(rows){return Math.max(0,...rows.map(r=>Number(r.id)||0))+1;}
function demoPositive(value,label){const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw new Error(label+': введите положительное целое число');return n;}
function demoApi(path,data){
  const d=demoLoad();demoRecalculate(d);
  if(data===undefined)return structuredClone(d);
  const backup=structuredClone(d);const ownership=window.BytShell?.track(d);
  try{
    let result;
    if(path==='/api/products'){
      if(!data.name.trim()||!data.sku.trim())throw new Error('Укажите название и артикул');
      if(d.products.some(p=>p.sku===data.sku || (data.barcode&&p.barcode===data.barcode)))throw new Error('Такой артикул или штрихкод уже есть');
      const price=Number(data.price);if(!Number.isFinite(price)||price<0)throw new Error('Проверьте цену');
      result={...data,id:demoId(d.products),unit_size:demoPositive(data.unit_size,'Упаковка'),price:Math.round(price*100)/100,stock:0,reserved:0,available:0};d.products.push(result);
    }else if(path==='/api/clients'){
      if(!data.name.trim())throw new Error('Укажите клиента');
      result={...data,id:demoId(d.clients)};d.clients.push(result);
    }else if(path==='/api/stock'){
      const p=d.products.find(p=>String(p.id)===String(data.product_id));if(!p)throw new Error('Товар не найден');
      const qty=demoPositive(data.quantity,'Количество');if(!data.reason.trim())throw new Error('Укажите основание');
      if(window.BytInventory){window.BytInventory.change(d,p.id,data.location_id||'warehouse',qty,0,data.reason);result=d.movements[0];}else{p.stock+=qty;result={id:demoId(d.movements),product_id:p.id,name:p.name,quantity:qty,reason:data.reason,created_at:new Date().toISOString(),author:'Демо-оператор'};d.movements.unshift(result);}
    }else if(path==='/api/orders'){
      const previous=d.orders.find(o=>o.idempotency_key===data.idempotency_key);
      if(previous){if(previous.payload!==JSON.stringify(data))throw new Error('Запрос с этим ключом уже сохранён с другим содержимым');return previous;}
      if(!data.lines.length)throw new Error('Добавьте товары');
      const client=d.clients.find(c=>String(c.id)===String(data.client_id));if(data.client_id&&!client)throw new Error('Клиент не найден');if(client?.active===false)throw new Error('Клиент неактивен');
      const locationId=data.location_id||'warehouse',priceType=data.price_type||window.BytPricing?.clientType(client)||'retail';
      if(!['retail','wholesale'].includes(priceType))throw new Error('Выберите розничную или оптовую цену');
      const lines=data.lines.map(l=>{
        const p=d.products.find(p=>String(p.id)===String(l.product_id));if(!p)throw new Error('Товар не найден');if(p.active===false)throw new Error('Товар неактивен: '+p.name);
        const qty=demoPositive(l.quantity,'Количество'),size=demoPositive(l.unit_size,'Упаковка');
        if(size!==1&&size!==p.unit_size)throw new Error('Упаковка изменилась');
        if((window.BytInventory?window.BytInventory.available(d,p.id,locationId):p.stock-p.reserved)<qty*size)throw new Error('Недостаточно товара: '+p.name);
        if(window.BytInventory)window.BytInventory.change(d,p.id,locationId,0,qty*size,'Резерв нового заказа');else p.reserved+=qty*size;
        const offer=window.BytPricing?window.BytPricing.calcPrice(p,{...client,price_type:priceType},d):{price:p.price};
        return{product_id:p.id,name:p.name,quantity:qty,unit_size:size,price:offer.price*size,total:Math.round(offer.price*size*qty*100)/100,cost_price:p.cost??null,base_price:offer.base_price??p.price,discount_reason:offer.discount_reason||''};
      });
      const total=Math.round(lines.reduce((sum,l)=>sum+l.total,0)*100)/100;
      if(Number(client?.credit_limit)>0){const due=d.orders.filter(o=>String(o.client_id)===String(client.id)&&o.status!=='cancelled').reduce((sum,o)=>sum+window.BytDemo.balance(o,d).due,0);if(due+total>Number(client.credit_limit))throw new Error('Превышен кредитный лимит клиента. Доступно: '+Math.max(0,client.credit_limit-due)+' ₽');}
      result={id:demoId(d.orders),client_id:client?.id||null,client_name:client?.name||'Без клиента',status:'reserved',location_id:locationId,price_type:priceType,due_date:client?.payment_days?new Date(Date.now()+Number(client.payment_days)*86400000).toISOString().slice(0,10):null,lines,total:Math.round(lines.reduce((s,l)=>s+l.total,0)*100)/100,paid:0,created_at:new Date().toISOString(),source:data.source||'manual',source_chat_id:data.source_chat_id||null,idempotency_key:data.idempotency_key,payload:JSON.stringify(data)};d.orders.unshift(result);
    }else if(/^\/api\/orders\/\d+\/cancel$/.test(path)){
      const o=d.orders.find(o=>String(o.id)===path.split('/')[3]);if(!o)throw new Error('Заказ не найден');
      if(o.status!=='cancelled'){
        if((d.returns||[]).some(r=>String(r.order_id)===String(o.id)))throw new Error('У заказа есть возвраты. Его история сохраняется.');
        if(o.status!=='reserved')throw new Error('Отгруженный заказ нельзя отменить. Для него нужен возврат товара.');
        if(Number(o.paid)>0)throw new Error('В заказе есть оплата. Для отмены сначала оформите возврат в «Финансах» → «Оплаты и долги».');
        const delivery=(d.deliveries||[]).find(x=>String(x.order_id)===String(o.id));
        if(delivery&&!['pending','assigned','ожидает назначения','назначена'].includes(delivery.status))throw new Error('Доставка уже выполняется: сначала урегулируйте возврат товара.');
        o.lines.forEach(l=>{const p=d.products.find(p=>String(p.id)===String(l.product_id));if(window.BytInventory)window.BytInventory.change(d,p.id,o.location_id||'warehouse',0,-l.quantity*l.unit_size,'Отмена заказа №'+o.id);else p.reserved-=l.quantity*l.unit_size;});o.status='cancelled';
        if(delivery)delivery.status='cancelled';
      }result=o;
    }else throw new Error('Операция пока недоступна в демонстрации');
    if(ownership)window.BytShell.stampCreated(d,ownership);demoSave();return structuredClone(result);
  }catch(error){demoData=backup;throw error;}
}
function showDemoDetails(title,body){
  let dlg=document.getElementById('demo-details');
  if(!dlg){dlg=document.createElement('dialog');dlg.id='demo-details';document.body.append(dlg);}
  const template=document.createElement('template');template.innerHTML=body;
  const payment=!!template.content.querySelector('#demo-payment-form'),documentView=!!template.content.querySelector('.register-receipt,.document-preview')||/чек|накладная/i.test(title);
  const kicker=payment?'Деньги и взаиморасчёты':documentView?'Предпросмотр документа':'Карточка и история';
  const description=payment?'Запись в учебном денежном журнале. Состав заказа и товарные остатки не изменяются.':documentView?'Учебный документ для проверки. Не является фискальным чеком; отправка клиенту не выполняется.':'Связанные сведения и исходные документы в одном месте. Все данные демонстрационные.';
  const symbol='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h4"/></svg>';
  dlg.setAttribute('aria-labelledby','demo-details-title');dlg.setAttribute('aria-describedby','demo-details-description');
  dlg.style.cssText=`width:min(${payment?580:documentView?720:860}px,calc(100vw - 24px));max-height:calc(100dvh - 40px);overflow:hidden`;
  dlg.innerHTML=`<div class="modal-head" style="flex-shrink:0"><div class="dialog-heading"><span class="dialog-symbol">${symbol}</span><div><div class="dialog-kicker">${escapeHTML(kicker)}</div><h2 id="demo-details-title">${escapeHTML(title)}</h2><p class="dialog-description" id="demo-details-description">${escapeHTML(description)}</p></div></div><button type="button" class="icon-button" data-close-details aria-label="Закрыть">×</button></div><div class="demo-detail-body" style="padding:24px 26px;overflow:auto;min-height:0;flex:1">${body}</div>${payment?'':'<div class="modal-actions" style="position:relative;margin:0;flex-shrink:0;padding:16px 26px"><button type="button" class="button secondary" data-close-details>Закрыть просмотр</button></div>'}`;
  if(payment){
    const form=dlg.querySelector('#demo-payment-form'),container=dlg.querySelector('.demo-detail-body'),footer=form.querySelector('.modal-actions');
    container.style.cssText='padding:0;display:flex;flex-direction:column;overflow:hidden;min-height:0;flex:1';
    form.style.cssText='display:flex;flex-direction:column;overflow:hidden;min-height:0;flex:1';
    const fields=document.createElement('div');fields.className='form-section';fields.style.cssText='overflow:auto;min-height:0;padding:22px 24px;margin:22px 24px 0';
    const heading=document.createElement('h3');heading.className='form-section-heading';heading.textContent='Сумма операции';fields.append(heading);
    [...form.childNodes].filter(node=>node!==footer).forEach(node=>fields.append(node));form.prepend(fields);
    if(footer)footer.style.cssText='position:relative;margin:20px 0 0;padding:16px 24px;flex-shrink:0';
  }
  if(!dlg.open)dlg.showModal();dlg.style.display='flex';dlg.style.flexDirection='column';
  dlg.addEventListener('close',()=>{dlg.style.removeProperty('display');},{once:true});
}
document.addEventListener('click',async event=>{
  if(event.target.closest('[data-close-details]'))document.getElementById('demo-details').close();
  const reset=event.target.closest('[data-demo-reset]');
  if(reset){localStorage.setItem(DEMO_KEY+'-previous',JSON.stringify(demoLoad()));demoData=structuredClone(window.BytDemo.seed);demoSave();await refresh();notify('Демо восстановлено. Предыдущее состояние можно вернуть кнопкой «Отменить сброс».');return;}
  if(event.target.closest('[data-demo-undo]')){const old=localStorage.getItem(DEMO_KEY+'-previous');if(old){demoData=JSON.parse(old);demoSave();await refresh();notify('Предыдущее демо восстановлено.');}else notify('Пока нечего восстанавливать.');return;}
  const action=event.target.closest('[data-demo-action]');
  if(action){const before=structuredClone(demoLoad());try{const result=window.BytDemo.handleAction(action.dataset.demoAction,action.dataset.id,demoData,{});demoSave();await refresh();if(result?.message)notify(result.message);}catch(e){demoData=before;notify(e.message);}return;}
  const client=event.target.closest('[data-client-detail]');
  if(client){const c=state.clients.find(c=>String(c.id)===client.dataset.clientDetail),orders=state.orders.filter(o=>String(o.client_id)===String(c.id));showDemoDetails(c.name,`<p>${escapeHTML(c.phone||'Телефон не указан')}</p><h3>Заказы клиента</h3>${orders.length?ordersTable(orders):'<p>Заказов пока нет</p>'}<p class="help">Демонстрационная карточка. Данные вымышлены.</p>`);}
  const order=event.target.closest('[data-order-detail]');
  if(order){const o=state.orders.find(o=>String(o.id)===order.dataset.orderDetail);const b=window.BytDemo.balance(o,state);showDemoDetails('Заказ № '+o.id,`<p>${escapeHTML(o.client_name||'Без клиента')}</p>${table(['Товар','Количество','Сумма'],o.lines.map(l=>`<tr><td>${escapeHTML(l.name)}</td><td>${l.quantity} × ${l.unit_size} шт.</td><td>${money(l.total)}</td></tr>`))}<div class="detail-grid"><p>Сумма: <strong>${money(o.total)}</strong></p><p>Возвращено товара: <strong>${money(b.returned)}</strong></p><p>После возврата: <strong>${money(b.net)}</strong></p><p>Переплата: <strong>${money(b.credit)}</strong></p><p>Оплачено в демо: <strong>${money(b.paid)}</strong></p><p>Осталось оплатить: <strong>${money(b.due)}</strong></p></div><div class="feature-actions"><button class="button secondary" data-feature-action="catalog.print-order" data-id="${o.id}">Печать заказа</button>${o.status==='reserved'?`<button class="button primary" data-feature-open="fulfillment.new-delivery" data-id="${o.id}">Назначить доставку</button><button class="button secondary" data-feature-action="fulfillment.ship" data-id="${o.id}">Выдать самовывоз</button>`:''}</div><p class="help">Не является фискальным чеком или документом реализации.</p>`);}
});
document.addEventListener('submit',async event=>{
  if(event.target.id!=='demo-chat-form')return;
  event.preventDefault();const form=new FormData(event.target),before=structuredClone(demoLoad());
  try{const result=window.BytDemo.handleAction('send-message',form.get('chat_id'),demoData,{message:form.get('message')});demoSave();await refresh();notify(result?.message||'Сообщение сохранено только в демо.');}catch(e){demoData=before;notify(e.message);}
});
document.addEventListener('input',event=>{
  if(event.target.id!=='demo-chat-search')return;
  const value=event.target.value,position=event.target.selectionStart;
  demoLoad().chatQuery=value;demoSave();state=structuredClone(demoData);render();
  const input=document.getElementById('demo-chat-search');input.focus();input.setSelectionRange(position,position);
});
