'use strict';
// Historical line.price is per historical selling unit; product.price is per piece.
// Keep the physical quantity even when the old packaging is no longer offered.
function prepareRepeatedOrder(order,products){
  const lines=[],missing=[];
  for(const line of order.lines||[]){
    const product=products.find(p=>String(p.id)===String(line.product_id));
    if(!product){missing.push(line.name);continue;}
    const oldUnit=Number(line.unit_size||1),oldQuantity=Number(line.quantity),baseQuantity=oldQuantity*oldUnit;
    if(!Number.isSafeInteger(oldUnit)||oldUnit<1||!Number.isSafeInteger(oldQuantity)||oldQuantity<1||!Number.isSafeInteger(baseQuantity))throw new Error('Некорректное количество в исходном заказе: '+line.name);
    const packageChanged=oldUnit!==1&&oldUnit!==Number(product.unit_size);
    const unitSize=packageChanged?1:oldUnit,quantity=packageChanged?baseQuantity:oldQuantity;
    const oldPiecePrice=Number(line.price)/oldUnit,currentPiecePrice=Number(product.price);
    lines.push({product_id:product.id,name:product.name,oldQuantity,oldUnit,baseQuantity,quantity,unit_size:unitSize,packageChanged,oldPiecePrice,currentPiecePrice,priceChanged:Math.abs(oldPiecePrice-currentPiecePrice)>0.000001,oldTotal:Number(line.total??oldQuantity*Number(line.price)),total:Math.round(baseQuantity*currentPiecePrice*100)/100,available:Number(product.available),shortage:baseQuantity>Number(product.available)});
  }
  return {lines,missing,total:Math.round(lines.reduce((sum,line)=>sum+line.total,0)*100)/100};
}
if(typeof module!=='undefined'&&module.exports)module.exports={prepareRepeatedOrder};
if(typeof document!=='undefined'){
let paymentBusy=false;
async function runOperation(action,id,payload={}){
  const before=structuredClone(demoLoad());
  try{const result=window.BytOperations.handleAction(action,id,demoData,payload);demoSave();await refresh();if(result?.message)notify(result.message);}
  catch(e){demoData=before;notify(e.message);}
}
document.addEventListener('click',async event=>{
  const paymentButton=event.target.closest('[data-payment-dialog]');
  if(paymentButton){
    const action=paymentButton.dataset.paymentDialog,order=state.orders.find(o=>String(o.id)===String(paymentButton.dataset.id));
    if(!order||!['pay-order','refund-order'].includes(action)){notify('Операция оплаты недоступна.');return;}
    const balance=window.BytDemo.balance(order,state),refund=action==='refund-order',maximum=Number(refund?balance.paid:balance.due),initial=Number(refund?(balance.credit>0?Math.min(balance.credit,balance.paid):balance.paid):balance.due);
    if(!Number.isFinite(maximum)||maximum<.01){notify(refund?'Нет доступной суммы для возврата.':'Заказ не требует оплаты.');return;}
    showDemoDetails((refund?'Учебный возврат денег':'Учебная оплата')+' · заказ № '+order.id,`<form id="demo-payment-form"><input type="hidden" name="action" value="${action}"><input type="hidden" name="order_id" value="${escapeHTML(order.id)}"><p class="help">Операция меняет только учебный денежный журнал. Остатки и возвраты товаров не изменяются. Банк и касса не подключены, внешних переводов нет.</p><p>${refund?'Доступно к возврату':'Осталось оплатить'}: <strong>${money(maximum)}</strong>${refund&&balance.credit>0?` · переплата: ${money(balance.credit)}`:''}</p><label>Сумма, ₽<input type="number" name="amount" required min="0.01" step="0.01" max="${maximum}" value="${initial.toFixed(2)}"></label><p class="form-error" id="demo-payment-error" role="alert"></p><div class="modal-actions"><button type="button" class="button secondary" data-close-details>Отмена</button><button type="submit" class="button primary">${refund?'Записать демо-возврат':'Записать демо-оплату'}</button></div></form>`);return;
  }
  const tabButton=event.target.closest('[data-analytics-tab]');
  if(tabButton){demoLoad().analyticsTab=tabButton.dataset.analyticsTab;demoSave();await refresh();return;}
  const detailButton=event.target.closest('[data-analytics-detail]');
  if(detailButton){const detail=window.BytAnalytics.detail(detailButton.dataset.analyticsDetail,state,{escapeHTML,money,number,icon});showDemoDetails(detail.title,detail.body);return;}
  const operation=event.target.closest('button[data-operation-action]');
  if(operation){await runOperation(operation.dataset.operationAction,operation.dataset.id||'',{});return;}
  const fromChat=event.target.closest('[data-chat-order]');
  if(fromChat){const chat=state.chats.find(c=>String(c.id)===fromChat.dataset.chatOrder);if(!chat)return;openModal('order');draftChatId=chat.id;const select=$('#modal-form select[name=client_id]');if(select){select.value=String(chat.client_id);select.dispatchEvent(new Event('change',{bubbles:true}));}$('#modal-title').textContent='Сделка из WhatsApp-чата';$('#modal-fields').insertAdjacentHTML('afterbegin',`<div class="demo-banner">Из диалога «${escapeHTML(chat.name)}». Клиент уже выбран, добавьте товары. Это демо-сделка.</div>`);return;}
  const repeat=event.target.closest('[data-repeat-order]');
  if(repeat){const order=state.orders.find(o=>String(o.id)===repeat.dataset.repeatOrder);if(!order)return;
    let prepared;try{prepared=prepareRepeatedOrder(order,state.products.filter(p=>p.active!==false).map(p=>({...p,price:window.BytPricing?window.BytPricing.calcPrice(p,{price_type:order.price_type||'retail'},state).price:p.price,available:window.BytInventory?window.BytInventory.available(state,p.id,order.location_id||'warehouse'):p.available})));}catch(error){notify(error.message);return;}
    if(!prepared.lines.length){notify('Повторить заказ невозможно: товары исходного заказа не найдены в каталоге.');return;}
    openModal('order');$('#modal-form select[name=client_id]').value=String(order.client_id||'');$('#modal-form select[name=price_type]').value=order.price_type||'retail';$('#modal-form select[name=location_id]').value=order.location_id||'warehouse';$('#order-lines').innerHTML='';
    for(const line of prepared.lines){addLine();const row=$('#order-lines').lastElementChild;row.querySelector('.line-product').value=String(line.product_id);updateUnits(row);row.querySelector('.line-quantity').value=line.quantity;row.querySelector('.line-unit').value=String(line.unit_size);}
    const changes=prepared.lines.map(line=>{const notes=[];
      if(line.packageChanged)notes.push(`Прежняя упаковка ${number(line.oldUnit)} шт. больше не доступна: ${number(line.oldQuantity)} × ${number(line.oldUnit)} шт. заменены на ${number(line.quantity)} шт. Общее количество сохранено.`);
      if(line.priceChanged)notes.push(`Цена за штуку: ${money(line.oldPiecePrice)} → ${money(line.currentPiecePrice)}. Сумма строки: ${money(line.oldTotal)} → ${money(line.total)}.`);
      if(line.shortage)notes.push(`Недостаточно наличия: нужно ${number(line.baseQuantity)} шт., доступно ${number(line.available)} шт. Уменьшите количество перед подтверждением.`);
      return notes.length?`<li><strong>${escapeHTML(line.name)}</strong><br>${notes.map(escapeHTML).join('<br>')}</li>`:'';
    }).filter(Boolean).join('');
    updateTotal();$('#modal-title').textContent='Повтор заказа № '+order.id;$('#modal-fields').insertAdjacentHTML('afterbegin',`<section class="demo-banner" style="display:block" aria-label="Проверка повторного заказа"><strong>Проверьте изменения до подтверждения</strong><p>Ранее: ${money(order.total)}. Предварительный итог повторения: ${money(prepared.total)}. Цены и наличие проверяются заново; резерв ещё не создан.</p>${changes?`<ul style="padding-left:18px;margin:10px 0;display:grid;gap:10px">${changes}</ul>`:'<p>Изменений цен и упаковок нет. Количество сохранено.</p>'}${prepared.missing.length?`<p>Не найдены и не включены в повтор: ${escapeHTML(prepared.missing.join(', '))}.</p>`:''}<p>После ваших правок актуальная сумма показана в поле «Итого» ниже.</p></section>`);return;}
});
document.addEventListener('change',async event=>{
  if(event.target.id==='analytics-period'){demoLoad().analyticsPeriod=event.target.value;demoSave();await refresh();return;}
  if(event.target.dataset.operationAction==='select-return-order'){await runOperation('select-return-order',event.target.value,{order_id:event.target.value});return;}
  if(event.target.name==='member_id'&&event.target.form?.id==='operations-team-form'){const member=state.team.find(m=>String(m.id)===event.target.value);event.target.form.elements.name.value=member?.name||'';if(member)event.target.form.elements.role.value=member.role;}
});
document.addEventListener('submit',async event=>{
  if(event.target.id==='demo-payment-form'){
    event.preventDefault();if(paymentBusy)return;
    const form=event.target,payload=Object.fromEntries(new FormData(form)),amount=Number(payload.amount),action=payload.action;
    const before=structuredClone(demoLoad()),order=demoData.orders.find(o=>String(o.id)===String(payload.order_id));
    const errorElement=form.querySelector('#demo-payment-error'),submit=form.querySelector('[type=submit]');
    paymentBusy=true;submit.disabled=true;errorElement.textContent='';
    try{
      if(!order||!['pay-order','refund-order'].includes(action))throw new Error('Операция недоступна.');
      const balance=window.BytDemo.balance(order,demoData),maximum=Number(action==='refund-order'?balance.paid:balance.due);
      if(!Number.isFinite(amount)||amount<.01||Math.abs(amount*100-Math.round(amount*100))>.000001||amount>maximum)throw new Error('Введите сумму от 0,01 до '+money(maximum)+' с точностью до копеек.');
      const result=window.BytDemo.handleAction(action,payload.order_id,demoData,{amount});
      demoSave();document.getElementById('demo-details').close();await refresh();if(result?.message)notify(result.message);
    }catch(error){demoData=before;errorElement.textContent=error.message;}
    finally{paymentBusy=false;submit.disabled=false;}
    return;
  }
  if(!event.target.id.startsWith('operations-'))return;
  event.preventDefault();const payload=Object.fromEntries(new FormData(event.target));await runOperation(event.target.dataset.operationAction,payload.member_id||payload.order_id||'',payload);
});
}
