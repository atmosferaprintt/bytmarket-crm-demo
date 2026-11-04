/* Fictional records for an isolated browser demo. No messaging or cash-register API. */
'use strict';
window.BytDemo = (() => {
  const products = [
    ['Fairy Лимон, средство для посуды 450 мл','Посуда',145,12,96],
    ['AOS Бальзам, средство для посуды 900 мл','Посуда',210,12,72],
    ['Persil Color, гель для стирки 1,3 л','Стирка',590,6,48],
    ['Ariel Горный родник, порошок 3 кг','Стирка',680,4,32],
    ['Lenor Свежесть, кондиционер 1 л','Стирка',320,12,60],
    ['Domestos Свежесть, чистящий гель 750 мл','Уборка',195,12,84],
    ['Санокс Ультра, чистящий гель 750 мл','Уборка',110,12,36],
    ['Мистер Мускул, средство для стёкол 500 мл','Уборка',245,12,48],
    ['Губки для посуды, упаковка 5 шт.','Для дома',65,24,120],
    ['Мешки для мусора 60 л, рулон 20 шт.','Для дома',95,20,80],
    ['Салфетка микрофибра 30 × 30 см','Для дома',75,20,100],
    ['Жидкое мыло Алоэ 500 мл','Гигиена',125,12,72]
  ].map(([name,category,price,unit_size,stock],i)=>({id:i+1,name,category,price,unit_size,stock,reserved:0,available:stock,sku:`БМ-${String(i+1).padStart(4,'0')}`,barcode:''}));
  const clients = [
    ['Магазин «У дома»','Опт','Кировский район'],['ИП Соколова · «Чистый дом»','Опт','Советский район'],['Кафе «Волга»','Организация','Ленинский район'],['Анна · розничный покупатель','Розница','Самовывоз'],['Гостевой дом «Берег»','Организация','Трусовский район'],['Магазин «Семейный»','Опт','Кировский район']
  ].map(([name,type,address],i)=>({id:i+1,name,type,address,phone:'',contact:'Демонстрационный контакт'}));
  function line(pid,quantity,unit_size=1){const p=products.find(p=>p.id===pid);return {product_id:pid,name:p.name,quantity,unit_size,price:p.price*unit_size,total:p.price*quantity*unit_size};}
  const orders = [
    {id:105,client_id:1,lines:[line(1,2,12),line(9,1,24)],paid:2000},
    {id:104,client_id:2,lines:[line(3,1,6),line(5,1,12)],paid:0},
    {id:103,client_id:3,lines:[line(6,1,12),line(10,1,20)],paid:4240},
    {id:102,client_id:4,lines:[line(1,2),line(8,1),line(12,1)],paid:0},
    {id:101,client_id:5,lines:[line(7,1,12),line(11,1,20)],paid:1000}
  ].map((o,i)=>({...o,client_name:clients.find(c=>c.id===o.client_id).name,status:'reserved',total:o.lines.reduce((s,l)=>s+l.total,0),created_at:`2026-11-05T0${9-i}:00:00+04:00`}));
  orders.forEach(o=>o.lines.forEach(l=>{const p=products.find(p=>p.id===l.product_id);p.reserved+=l.quantity*l.unit_size;p.available=p.stock-p.reserved;}));
  const seed = {products,clients,orders,summary:{products:12,clients:6,orders:5,reserved_value:orders.reduce((s,o)=>s+o.total,0)},
    movements:products.map((p,i)=>({id:i+1,product_id:p.id,name:p.name,quantity:p.stock,reason:'Начальный демо-остаток',author:'Демо-оператор',created_at:'2026-11-05T05:00:00+04:00'})),
    purchases:[{id:21,supplier:'Демо-поставщик «ЮгОпт»',expected:'06.11.2026',status:'expected',lines:[{product_id:7,quantity:48},{product_id:3,quantity:24}]},{id:22,supplier:'Демо-поставщик «ДомСнаб»',expected:'07.11.2026',status:'expected',lines:[{product_id:9,quantity:96},{product_id:10,quantity:60}]}],
    payments:orders.filter(o=>o.paid).map((o,i)=>({id:i+1,order_id:o.id,amount:o.paid,method:'Демо-перевод',created_at:o.created_at})),
    deliveries:[{id:31,order_id:105,courier:'Демо-курьер Алексей',address:'Астрахань · Кировский район',interval:'Сегодня, 14:00–16:00',status:'assigned'},{id:32,order_id:103,courier:'Демо-курьер Алексей',address:'Астрахань · Ленинский район',interval:'Сегодня, 16:00–18:00',status:'assigned'}],
    chats:[{id:1,client_id:1,name:'Магазин «У дома»',messages:[{direction:'in',text:'Добрый день! Подготовьте, пожалуйста, две коробки средства для посуды.',time:'09:05'},{direction:'out',text:'Демо-заказ №105 подготовлен. Проверяем сборку.',time:'09:08'}]},{id:2,client_id:2,name:'ИП Соколова · «Чистый дом»',messages:[{direction:'in',text:'Подскажите, есть ли гель для стирки в упаковках?',time:'08:35'}]},{id:3,client_id:5,name:'Гостевой дом «Берег»',messages:[{direction:'in',text:'Можно повторить заказ на средства для уборки?',time:'08:10'}]}]};
  const active = s=>s.orders.filter(o=>o.status!=='cancelled');
  const roundMoney=value=>Math.round(value*100)/100;
  function balance(o,s){
    const returned=roundMoney((s.returns||[]).filter(r=>String(r.order_id)===String(o.id)).reduce((sum,r)=>sum+Number(r.total||0),0));
    const net=o.status==='cancelled'?0:Math.max(0,roundMoney(o.total-returned));
    const paid=roundMoney((s.payments||[]).filter(p=>String(p.order_id)===String(o.id)).reduce((sum,p)=>sum+Number(p.amount||0),0));
    return {returned,net,paid,due:Math.max(0,roundMoney(net-paid)),credit:Math.max(0,roundMoney(paid-net))};
  }
  const outstanding=(o,s)=>balance(o,s).due;
  function render(section,s,h){
    const e=h.escapeHTML,m=h.money,n=h.number;
    const btn=(a,id,label)=>`<button class="button" data-demo-action="${a}" data-id="${e(id)}">${label}</button>`;
    const badge=t=>`<span class="status">${e(t)}</span>`;
    const table=(headers,rows)=>`<div class="table-wrap"><table><thead><tr>${headers.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td colspan="${headers.length}">Записей пока нет</td></tr>`}</tbody></table></div>`;
    const panel=(title,sub,body)=>`<section class="panel"><div class="panel-head"><div><h2>${title}</h2><p class="panel-subtitle">${sub}</p></div></div>${body}</section>`;
    const cards=items=>`<div class="metrics">${items.map(([label,value,note])=>`<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></div>`).join('')}</div>`;
    const order=id=>s.orders.find(o=>String(o.id)===String(id));
    if(section==='purchases')return panel('Ожидаемые поставки','Учебная приёмка увеличивает остатки только в демо-режиме.',table(['Заказ','Поставщик','Состав поставки','Ожидается','Статус','Действие'],s.purchases.map(p=>`<tr><td>ЗК-${p.id}</td><td>${e(p.supplier)}</td><td>${p.lines.map(l=>`${e(s.products.find(x=>x.id===l.product_id)?.name||'Товар')} · ${n(l.quantity)} шт.`).join('<br>')}</td><td>${e(p.expected)}</td><td>${badge(p.status==='received'?'Принята':'Ожидается')}</td><td>${p.status==='received'?'Остатки обновлены':btn('receive-purchase',p.id,'Принять поставку')}</td></tr>`)));
    if(section==='money')return cards([['Поступления от клиентов',m(s.payments.reduce((v,p)=>v+p.amount,0)),'Оплаты минус возвраты · без вычета расходов'],['Осталось оплатить',m(active(s).reduce((v,o)=>v+outstanding(o,s),0)),'За вычетом возвратов товара · не просрочка'],['Переплата',m(active(s).reduce((v,o)=>v+balance(o,s).credit,0)),'Сумма сверх стоимости оставшихся товаров']])+panel('Оплата заказов','Учебные частичные оплаты и возвраты денег. Касса и банк не подключены.',table(['Заказ / клиент','Стоимость после возвратов','Оплачено','Остаток / переплата','Действие'],active(s).map(o=>{const b=balance(o,s);return `<tr><td>№ ${o.id}<br><span class="help">${e(o.client_name||'Без клиента')}</span></td><td>${m(b.net)}${b.returned?`<div class="cell-sub">Возврат товара: ${m(b.returned)}</div>`:''}</td><td>${m(b.paid)}</td><td>${b.credit?'Переплата '+m(b.credit):m(b.due)}</td><td>${b.due>0?`<button class="button" data-payment-dialog="pay-order" data-id="${o.id}">Записать оплату</button>`:'Оплачен'} ${b.paid>0?`<button class="button" data-payment-dialog="refund-order" data-id="${o.id}">Возврат денег</button>`:''}</td></tr>`;})))+panel('Платежи и возвраты','Все записи существуют только в демо. Возвраты показаны со знаком минус.',table(['Платёж','Заказ','Сумма','Способ'],s.payments.map(p=>`<tr><td>ПЛ-${p.id}</td><td>№ ${e(p.order_id)}</td><td>${m(p.amount)}</td><td>${e(p.method)}</td></tr>`)));
    if(section==='delivery')return panel('Маршрут доставок','Статус доставки не подтверждает оплату. Отгрузка в демо фиксируется при выезде.',table(['Заказ','Адрес / интервал','Курьер','Статус','К оплате','Действие'],s.deliveries.map(d=>{const o=order(d.order_id),cancelled=!o||o.status==='cancelled';return `<tr><td>№ ${d.order_id}</td><td>${e(d.address)}<br><span class="help">${e(d.interval)}</span></td><td>${e(d.courier)}</td><td>${badge(cancelled?'Заказ отменён':{assigned:'Назначена',in_transit:'В пути',delivered:'Доставлена'}[d.status])}</td><td>${m(o?outstanding(o,s):0)}</td><td>${cancelled?'Доставка недоступна':d.status==='delivered'?'Вручение отмечено':btn('advance-delivery',d.id,d.status==='assigned'?'Начать доставку':'Отметить вручение')}</td></tr>`;})));
    if(section==='reports'){
      const totals=active(s),sum=totals.reduce((v,o)=>v+o.total,0),shipped=totals.filter(o=>o.status==='shipped'||o.status==='delivered');
      return cards([['Сумма заказов',m(sum),'Все активные демо-заказы'],['Отгружено',m(shipped.reduce((v,o)=>v+o.total,0)),'По демо-событию выезда'],['Денежный итог',m(s.payments.reduce((v,p)=>v+p.amount,0)),'Платежи минус возвраты · не продажи'],['Валовая прибыль','Нет данных','Себестоимость не задана']])+panel('Заказы по клиентам','Все даты · отменённые заказы исключены · суммы рассчитываются из текущего демо-состояния.',table(['Клиент','Заказов','Сумма заказов','Оплачено','Осталось оплатить'],s.clients.map(c=>{const os=totals.filter(o=>o.client_id===c.id);return `<tr><td>${e(c.name)}</td><td>${os.length}</td><td>${m(os.reduce((v,o)=>v+o.total,0))}</td><td>${m(os.reduce((v,o)=>v+(o.paid||0),0))}</td><td>${m(os.reduce((v,o)=>v+outstanding(o,s),0))}</td></tr>`;})))+panel('Остатки и резервы','Количество в базовых единицах. Стоимость запасов не рассчитывается без себестоимости.',table(['Товар','На складе','В резерве','Доступно'],s.products.map(p=>`<tr><td>${e(p.name)}</td><td>${n(p.stock)}</td><td>${n(p.reserved)}</td><td>${n(p.available)}</td></tr>`)));
    }
    if(section==='chats'){
      const selected=s.chats.find(c=>String(c.id)===String(s.selectedChatId))||s.chats[0];
      const client=c=>s.clients.find(x=>String(x.id)===String(c?.client_id));
      const initials=name=>String(name||'Клиент').replace(/[«»"·]/g,' ').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toLocaleUpperCase('ru');
      const q=String(s.chatQuery||'').trim().toLocaleLowerCase('ru');
      const found=s.chats.filter(c=>`${c.name} ${client(c)?.phone||''}`.toLocaleLowerCase('ru').includes(q));
      const customer=client(selected),deals=selected?s.orders.filter(o=>String(o.client_id)===String(selected.client_id)):[];
      const statuses={reserved:'В резерве',shipped:'Отгружена',delivered:'Доставлена',cancelled:'Отменена',draft:'Черновик'};
      const wa='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.4-4.3A8 8 0 1 1 20 11.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 7.8c-.5 0-1 1-1 1.8 0 2.3 3.5 5.5 5.7 5.5.9 0 1.8-.8 1.8-1.3l-2-1.1-.9.8c-1.3-.6-2.1-1.4-2.7-2.7l.7-.9L9.7 8Z" fill="currentColor"/></svg>';
      return `<div class="wa-notice"><span class="wa-demo-badge">ДЕМО</span><span>WhatsApp не подключён. Сообщения сохраняются только в демо; внешней отправки нет.</span></div><div class="chat-layout wa-workspace"><aside class="panel chat-list wa-list"><div class="wa-list-heading"><div><h2>Сообщения</h2><p>${n(s.chats.length)} диалога в рабочем пространстве</p></div><span class="wa-channel-icon">${wa}</span></div><div class="toolbar"><input class="search" id="demo-chat-search" type="search" aria-label="Поиск по клиенту или телефону" placeholder="Клиент или телефон…" value="${e(s.chatQuery||'')}"></div><div class="wa-channel-label">${wa}<span>WhatsApp</span><span class="wa-count">${n(found.length)}</span></div><div class="wa-contact-list">${found.map(c=>{const last=c.messages.at(-1);return `<button type="button" class="chat-item wa-contact ${selected?.id===c.id?'active':''}" data-demo-action="select-chat" data-id="${e(c.id)}" aria-pressed="${selected?.id===c.id}"><span class="wa-avatar" aria-hidden="true">${e(initials(c.name))}</span><span class="wa-contact-body"><span class="wa-contact-top"><strong>${e(c.name)}</strong><time>${e(last?.time||'')}</time></span><span class="wa-preview">${last?.direction==='out'?'Вы: ':''}${e(last?.text||'Нет сообщений')}</span><span class="wa-contact-channel">WhatsApp · демо</span></span></button>`;}).join('')||'<div class="wa-list-empty">Ничего не найдено.<br>Попробуйте другое имя или телефон.</div>'}</div><div class="wa-list-foot">Номер и подключение канала настроим позже</div></aside>${selected?`<section class="panel chat-thread wa-thread"><header class="wa-thread-head"><div class="wa-person"><span class="wa-avatar">${e(initials(selected.name))}</span><div><h2>${e(selected.name)}</h2><p>${customer?.phone?e(customer.phone)+' · ':''}WhatsApp <span class="wa-demo-badge">ДЕМО</span></p></div></div><div class="wa-head-actions">${customer?`<button type="button" class="button secondary small" data-client-detail="${e(customer.id)}">Карточка клиента</button>`:''}<button type="button" class="button primary small" data-chat-order="${e(selected.id)}">+ Создать сделку</button></div></header><div class="wa-thread-body"><div class="wa-dialogue"><div class="chat-messages wa-messages"><div class="wa-history-label">Учебная переписка</div>${selected.messages.map(msg=>`<div class="chat-message ${msg.direction==='out'?'outgoing':'incoming'}"><p>${e(msg.text)}</p><small>${e(msg.time)} · ${msg.direction==='out'?'В демо':'Пример входящего'}</small></div>`).join('')||'<div class="wa-list-empty">В этом диалоге пока нет сообщений.</div>'}</div><form id="demo-chat-form" class="chat-compose wa-compose"><input type="hidden" name="chat_id" value="${e(selected.id)}"><input class="search" name="message" aria-label="Текст демо-сообщения" placeholder="Написать сообщение в демо…" required maxlength="2000"><button class="button primary" type="submit">Отправить в демо</button></form><div class="wa-compose-note">Сохраняется локально. Клиент сообщение не получит.</div></div><aside class="wa-deals"><div class="wa-deals-heading"><h3>Сделки клиента</h3><span class="wa-count">${n(deals.length)}</span></div><p class="wa-deals-description">Заказы и история работы с клиентом</p>${deals.map(o=>`<button type="button" class="wa-deal" data-order-detail="${e(o.id)}"><span class="wa-deal-top"><strong>Сделка № ${e(o.id)}</strong><span aria-hidden="true">↗</span></span><span class="wa-deal-amount">${m(o.total)}</span><span class="wa-deal-status ${o.status==='cancelled'?'is-cancelled':''}">${e(statuses[o.status]||o.status)}</span><span class="wa-deal-source ${String(o.source_chat_id)===String(selected.id)?'is-linked':''}">${String(o.source_chat_id)===String(selected.id)?'Из этого чата':'Другой источник'}</span></button>`).join('')||'<div class="wa-deals-empty">Сделок ещё нет.<br>Создайте первую из этого диалога.</div>'}<div class="wa-deals-foot">Создание сделки не оформляет оплату или кассовый чек.</div></aside></div></section>`:'<section class="panel wa-no-chat"><h2>Пока нет диалогов</h2><p>Здесь появятся учебные переписки клиентов.</p></section>'}</div>`;
    }
    return '';
  }
  function handleAction(action,id,s,payload={}){
    const find=(list)=>list.find(x=>String(x.id)===String(id));
    const now=()=>new Date().toISOString();const next=list=>Math.max(0,...list.map(x=>Number(x.id)||0))+1;
    if(action==='select-chat'){if(!find(s.chats))throw new Error('Чат не найден');s.selectedChatId=Number(id);return {message:''};}
    if(action==='send-message'){
      const c=find(s.chats),text=String(payload.message||'').trim();if(!c||!text||text.length>2000)throw new Error('Введите сообщение от 1 до 2000 символов');
      c.messages.push({direction:'out',text,time:new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Astrakhan'}).format(new Date())});return {message:'Сообщение сохранено в демо. Внешняя отправка не выполнялась.'};
    }
    if(action==='receive-purchase'){
      const p=find(s.purchases);if(!p)throw new Error('Поставка не найдена');if(p.status==='received')return {message:'Поставка уже принята'};
      if(p.lines.some(l=>!s.products.find(x=>x.id===l.product_id)))throw new Error('Товар поставки не найден');
      p.lines.forEach(l=>{const item=s.products.find(x=>x.id===l.product_id);item.stock+=l.quantity;item.available=item.stock-item.reserved;s.movements.unshift({id:next(s.movements),product_id:item.id,name:item.name,quantity:l.quantity,reason:`Демо-приёмка ЗК-${p.id}`,author:'Демо-оператор',created_at:now()});});p.status='received';return {message:'Демо-поставка принята, остатки обновлены'};
    }
    if(action==='pay-order'){
      const o=find(s.orders);if(!o||o.status==='cancelled')throw new Error('Заказ недоступен для оплаты');
      const due=outstanding(o,s),amount=payload.amount===undefined?due:Number(payload.amount);if(!due)return {message:'Заказ уже оплачен'};
      if(!Number.isFinite(amount)||amount<=0||amount>due||Math.abs(amount*100-Math.round(amount*100))>0.00001)throw new Error('Сумма оплаты должна быть положительной, до копеек и не больше остатка');
      s.payments.push({id:next(s.payments),order_id:o.id,amount,method:'Демо-платёж',created_at:now()});o.paid=Math.round(s.payments.filter(p=>p.order_id===o.id).reduce((v,p)=>v+p.amount,0)*100)/100;return {message:'Учебный платёж записан. Фискальный чек не формировался.'};
    }
    if(action==='refund-order'){
      const o=find(s.orders);if(!o)throw new Error('Заказ не найден');
      const paid=balance(o,s).paid;
      if(paid<=0)return {message:'Возвращать нечего: демо-оплата уже возвращена'};
      const amount=payload.amount===undefined?paid:Number(payload.amount);
      if(!Number.isFinite(amount)||amount<=0||amount>paid||Math.abs(amount*100-Math.round(amount*100))>0.00001)throw new Error('Сумма возврата должна быть положительной, до копеек и не больше полученной оплаты');
      s.payments.push({id:next(s.payments),order_id:o.id,amount:-amount,method:'Демо-возврат денег',created_at:now()});o.paid=roundMoney(paid-amount);
      return {message:'Учебный возврат денег записан. Товары и доставка не изменялись.'};
    }
    if(action==='advance-delivery'){
      const d=find(s.deliveries),o=s.orders.find(o=>o.id===d?.order_id);if(!d||!o||o.status==='cancelled')throw new Error('Доставка недоступна');
      if(d.status==='delivered')return {message:'Вручение уже отмечено'};
      if(d.status==='assigned'){
        const needs=new Map();o.lines.forEach(l=>needs.set(l.product_id,(needs.get(l.product_id)||0)+l.quantity*l.unit_size));
        if(o.status==='reserved'){
          for(const [pid,qty] of needs){const p=s.products.find(x=>x.id===pid);if(!p||p.stock<qty||p.reserved<qty)throw new Error('Недостаточно резерва для отгрузки');}
          for(const [pid,qty] of needs){const p=s.products.find(x=>x.id===pid);p.stock-=qty;p.reserved-=qty;p.available=p.stock-p.reserved;s.movements.unshift({id:next(s.movements),product_id:pid,name:p.name,quantity:-qty,reason:`Демо-отгрузка заказа №${o.id}`,author:'Демо-оператор',created_at:now()});}
          o.status='shipped';
        }
        d.status='in_transit';
      }else if(d.status==='in_transit'){d.status='delivered';o.status='delivered';}
      return {message:'Статус демо-доставки обновлён. Оплата не изменялась.'};
    }
    throw new Error('Неизвестное демо-действие');
  }
  return {seed,render,handleAction,balance};
})();
