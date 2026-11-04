(function(g){
'use strict';
const definitions=[
 ['Владелец','Александр Волков','Результат магазина, деньги и решения',['overview','sales','register','clients','chats','products','stock','purchases','returns','imports','finance','delivery','reports','visits','pricing','team','channels','settings','tasks']],
 ['Продавец','Анна Орлова','Быстрая продажа и работа со сменой',['overview','register','products','returns','tasks']],
 ['Менеджер','Михаил Соколов','Свои клиенты, заказы и повторные продажи',['overview','sales','clients','chats','products','delivery','returns','tasks']],
 ['Торговый представитель','Елена Миронова','Визиты, свои торговые точки и заказы',['overview','visits','clients','sales','chats','products','tasks']],
 ['Бухгалтер','Ольга Белова','Расчёты, документы и контроль расхождений',['overview','finance','reports','sales','clients','returns','tasks']],
 ['Сотрудник склада','Сергей Крылов','Приёмка, остатки, выдача и проверка возвратов',['overview','stock','purchases','returns','delivery','products','tasks']],
 ['Диспетчер','Марина Лебедева','Назначения, выезды и проблемные доставки',['overview','delivery','tasks']],
 ['Курьер','Денис Морозов','Только назначенные доставки и мои задачи',['overview','delivery','tasks']],
];
const aliases={'Представитель':'Торговый представитель','Склад':'Сотрудник склада'};
const canonical=role=>aliases[role]||role;
const same=(a,b)=>String(a)===String(b);
const id=rows=>Math.max(0,...rows.map(r=>Number(r.id)||0))+1;
const def=role=>definitions.find(x=>x[0]===canonical(role))||definitions[0];
function enhance(s){
 s.team??=[];s.roleDemo??={};const meta=s.roleDemo;meta.personas??={};meta.clientOwners??={};meta.orderOwners??={};meta.deliveryOwners??={};
 for(const [role,name,description]of definitions){
  const saved=meta.personas[role];let member=saved&&s.team.find(m=>same(m.id,saved.employee_id));
  if(!member){member=s.team.find(m=>canonical(m.role)===role&&m.active!==false&&!/^Демо[ -]/i.test(m.name));if(!member){member={id:id(s.team),name,role,active:true,role_demo:true};s.team.push(member);}}
  // Older generic demo staff remain untouched; their existing demo work belongs to this persona.
  const legacy=s.team.filter(m=>canonical(m.role)===role&&/^Демо[ -]/i.test(m.name)).map(m=>m.id);
  meta.personas[role]={role,name:member.name,initials:String(member.name).split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join(''),employee_id:member.id,employee_ids:[member.id,...legacy],description};
 }
 const salesRoles=['Менеджер','Торговый представитель'];
 for(const [index,c]of (s.clients||[]).entries()){
  if(meta.clientOwners[c.id]!==undefined)continue;
  const assignment=(s.clientAssignments||[]).find(a=>same(a.client_id,c.id));
  if(assignment){meta.clientOwners[c.id]=assignment.employee_id;continue;}
  const explicit=c.employee_id??c.responsible_id;
  meta.clientOwners[c.id]=explicit??meta.personas[salesRoles[index%2]].employee_id;
 }
 for(const o of s.orders||[])if(meta.orderOwners[o.id]===undefined)meta.orderOwners[o.id]=o.responsible_id??o.employee_id??meta.clientOwners[o.client_id]??meta.personas['Продавец'].employee_id;
 const courier=meta.personas['Курьер'];
 for(const d of s.deliveries||[])if(meta.deliveryOwners[d.id]===undefined){const matching=s.team.find(t=>t.name===d.courier);meta.deliveryOwners[d.id]=d.courier_id??d.employee_id??matching?.id??(/^Демо[ -]/i.test(d.courier||'')?courier.employee_id:null);}
 s.currentRole=def(s.currentRole)[0];return s;
}
function current(s){const role=def(s.currentRole)[0];const saved=s.roleDemo?.personas?.[role];if(saved)return {...saved,employee_ids:[...saved.employee_ids]};const d=def(role);return{role,name:d[1],initials:d[1].split(' ').map(x=>x[0]).join(''),employee_id:null,employee_ids:[],description:d[2]};}
function allowedSections(s){return [...def(s.currentRole)[3]];}
function switchRole(role,s){role=canonical(role);if(!definitions.some(d=>d[0]===role))throw Error('Неизвестная демо-роль');enhance(s);s.currentRole=role;return current(s);}
function own(person,value){return person.employee_ids.some(x=>same(x,value));}
function costless(value){if(Array.isArray(value)){value.forEach(costless);return;}if(!value||typeof value!=='object')return;for(const k of Object.keys(value)){if(['cost','cost_price','purchase_price','profit','gross_profit','margin','cost_total','known_profit'].includes(k))delete value[k];else costless(value[k]);}}
function project(source){
 const s=structuredClone(source);enhance(s);const person=current(s),role=person.role,meta=s.roleDemo;
 if(role==='Владелец')return s;
 const commercial=['Менеджер','Торговый представитель'].includes(role),courier=role==='Курьер',seller=role==='Продавец',logistics=['Сотрудник склада','Диспетчер','Курьер'].includes(role);
 if(commercial){
  const clients=new Set((s.clients||[]).filter(c=>{const assignment=(s.clientAssignments||[]).find(a=>same(a.client_id,c.id));return own(person,assignment?.employee_id??c.responsible_id??c.employee_id??meta.clientOwners[c.id]);}).map(c=>String(c.id)));
  const orders=(s.orders||[]).filter(o=>own(person,o.responsible_id??o.employee_id??meta.orderOwners[o.id])||(o.responsible_id==null&&o.employee_id==null&&clients.has(String(o.client_id))));
  // An explicitly assigned order also grants the minimum associated client context.
  for(const o of orders)if(o.client_id!=null)clients.add(String(o.client_id));
  s.clients=s.clients.filter(c=>clients.has(String(c.id)));s.orders=orders;s.chats=(s.chats||[]).filter(c=>clients.has(String(c.client_id)));
  s.clientAssignments=(s.clientAssignments||[]).filter(a=>own(person,a.employee_id));
 }
 if(seller){s.orders=(s.orders||[]).filter(o=>['register','register_demo'].includes(o.source)||own(person,o.responsible_id??o.employee_id??meta.orderOwners[o.id]));const ids=new Set(s.orders.map(o=>String(o.client_id)));s.clients=(s.clients||[]).filter(c=>ids.has(String(c.id)));s.chats=[];}
 if(courier){s.deliveries=(s.deliveries||[]).filter(d=>{const named=s.team.find(t=>t.name===d.courier);const owner=d.courier_id??d.employee_id??named?.id??(/^Демо[ -]/i.test(d.courier||'')?meta.deliveryOwners[d.id]:null);return own(person,owner);});const ids=new Set(s.deliveries.map(d=>String(d.order_id)));s.orders=(s.orders||[]).filter(o=>ids.has(String(o.id)));const cids=new Set(s.orders.map(o=>String(o.client_id)));s.clients=(s.clients||[]).filter(c=>cids.has(String(c.id))).map(c=>({id:c.id,name:c.name,phone:c.phone}));s.chats=[];s.products=[];s.inventory=[];s.purchases=[];s.quarantine=[];s.movements=[];s.inventoryDocuments=[];s.returns=[];}
 if(logistics&&!courier){s.chats=[];if(role==='Диспетчер'){s.products=[];s.inventory=[];s.purchases=[];s.quarantine=[];s.movements=[];s.inventoryDocuments=[];s.returns=[];}s.clients=(s.clients||[]).map(c=>({id:c.id,name:c.name,phone:c.phone,addresses:c.addresses}));}
 const orderIds=new Set((s.orders||[]).map(o=>String(o.id)));
 if(commercial||seller||courier){for(const key of ['payments','returns','deliveries','registerReceipts'])s[key]=(s[key]||[]).filter(r=>orderIds.has(String(r.order_id)));const rids=new Set((s.returns||[]).map(r=>String(r.id)));s.quarantine=(s.quarantine||[]).filter(q=>rids.has(String(q.return_id)));}
 s.visits=(s.visits||[]).filter(v=>own(person,v.employee_id));s.repTasks=(s.repTasks||[]).filter(t=>own(person,t.employee_id??t.assignee_id));
 if(role!=='Бухгалтер'){s.expenses=[];costless(s);}
 if(logistics){for(const d of s.deliveries||[]){const o=s.orders.find(o=>same(o.id,d.order_id));if(o)d.amount_to_collect=g.BytDemo?.balance(o,s)?.due??Math.max(0,o.total-(o.paid||0));}s.payments=(s.payments||[]).map(x=>({order_id:x.order_id,amount:x.amount}));s.registerCart=[];s.registerReceipts=[];s.registerShifts=[];}
 if(!['Бухгалтер'].includes(role)){s.audit=[];s.channelProfiles={};}
 s.team=(s.team||[]).filter(t=>own(person,t.id));s.orderDrafts=[];delete s.savedOrderDraft;delete s.orderDraft;s.summary={products:s.products.length,clients:s.clients.length,orders:s.orders.filter(o=>o.status==='reserved').length,reserved_value:s.orders.filter(o=>o.status==='reserved').reduce((sum,o)=>sum+o.total,0)};
 return s;
}
const common=new Set(['roles.switch','business.switch-role','workspace.task','workspace.new-task','workspace.edit-task','workspace.complete-task','workspace.reopen-task','workspace.start-task','workspace.task-filter','workspace.task-mode','workspace.task-create','workspace.task-start','workspace.task-complete','workspace.task-status','workspace.task-update','workspace.task-detail','workspace.task-edit']);
const policies={
 'Продавец':[/^register\.(?!channel|save-channel)/,/^catalog\.(?:apply-view|save-view|load-view|print-product)$/,/^(?:core\.client|\/api\/clients)$/,/^fulfillment\.new-return$/],
 'Менеджер':[/^(?:core\.(?:order|client)|\/api\/(?:orders|clients))$/,/^catalog\.(?:new-client|edit-client|save-client|apply-view|save-view|load-view|print-product|print-order)$/,/^fulfillment\.(?:new-delivery|edit-delivery|new-return)$/,/^business\.(?:new-task|complete-task)$/,/^(send-message|select-chat)$/],
 'Торговый представитель':[/^(?:core\.(?:order|client)|\/api\/(?:orders|clients))$/,/^catalog\.(?:new-client|edit-client|save-client|apply-view|save-view|load-view|print-product|print-order)$/,/^business\.(?:new-visit|visit-result|new-task|complete-task)$/,/^(send-message|select-chat)$/],
 'Бухгалтер':[/^analytics\./,/^pay-order$|^refund-order$/,/^fulfillment\.refund$/,/^business\.(?:new-expense|void-expense|new-task|complete-task)$/,/^catalog\.(?:edit-client|save-client|export-|print-|apply-view|save-view|load-view|print-product)/],
 'Сотрудник склада':[/^inventory\./,/^fulfillment\.(?:ship|new-purchase|receive|new-return|inspect)$/,/^catalog\.(?:apply-view|save-view|load-view|print-product|export-movements)$/],
 'Диспетчер':[/^fulfillment\.(?:new-delivery|edit-delivery|depart|deliver|fail)$/],
 'Курьер':[/^fulfillment\.(?:depart|deliver|fail)$/],
};
function canAction(action,s){const role=current(s).role;action=String(action||'');if(role==='Владелец')return true;if(common.has(action)||action.startsWith('workspace.task.'))return true;return (policies[role]||[]).some(rule=>rule.test(action));}
function picker(s,h){const e=h.escapeHTML,active=current(s);const copy=structuredClone(s);enhance(copy);return `<div class="role-picker-intro"><span class="role-kicker">ДЕМО-КОМАНДА</span><h2>Посмотрите на работу глазами сотрудника</h2><p>Выберите сотрудника, чтобы увидеть его рабочий стол, задачи и доступные действия.</p></div><div class="role-person-grid">${definitions.map(([role])=>{const p=copy.roleDemo.personas[role];return `<button type="button" class="role-person ${role===active.role?'is-selected':''}" data-role-choice="${e(role)}" aria-pressed="${role===active.role}"><span class="role-avatar">${e(p.initials)}</span><span class="role-person-copy"><strong>${e(p.name)}</strong><span>${e(role)}</span><small>${e(p.description)}</small></span><span class="role-person-check">${role===active.role?'✓':'→'}</span></button>`;}).join('')}</div><p class="role-demo-note">Все демо-персоны вымышлены. Рабочие данные сохраняются при переключении.</p>`;}
function home(source,h){const s=project(source),p=current(source),role=p.role,e=h.escapeHTML,m=h.money,n=h.number||String;const list=(title,rows)=>`<section class="role-panel"><div class="role-panel-heading"><h2>${title}</h2></div>${rows.length?`<div class="role-work-list">${rows.join('')}</div>`:'<p class="role-empty">Сейчас нет записей, требующих действия.</p>'}</section>`;const link=(section,label)=>`<a class="role-action" href="#${section}">${label}<span>↗</span></a>`;const item=(title,note,tag)=>`<div class="role-work-item"><div><strong>${e(title)}</strong><span>${e(note)}</span></div><b>${e(tag)}</b></div>`;const cards=rows=>`<div class="role-stats">${rows.map(([label,value,note])=>`<div class="role-stat"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join('')}</div>`;const tasks=(s.repTasks||[]).filter(t=>t.status!=='completed'),reserved=s.orders.filter(o=>o.status==='reserved'),pending=(s.deliveries||[]).filter(d=>!['delivered','cancelled'].includes(d.status));let title='',subtitle='',actions='',body='';
 if(role==='Владелец'){title='Магазин под контролем';subtitle='Продажи, команда и решения на сегодня';actions=link('reports','Открыть аналитику')+link('tasks','Задачи команды')+link('finance','Проверить расчёты');const money=(s.payments||[]).reduce((sum,x)=>sum+x.amount,0),due=s.orders.reduce((sum,o)=>sum+(g.BytDemo?.balance(o,s)?.due||0),0);body=cards([['Активные заказы',n(reserved.length),'Ожидают отгрузки'],['Денежный итог',m(money),'Поступления минус возвраты'],['Осталось оплатить',m(due),'Не является просрочкой'],['В работе',n(tasks.length),'Открытые задачи команды']])+`<div class="role-columns">${list('Требует решения',[(pending.some(d=>d.status==='failed')?item('Проблемные доставки','Нужны перенос или связь с клиентом',pending.filter(d=>d.status==='failed').length):''),...s.products.filter(x=>x.available<=Number(x.min_stock||0)).slice(0,3).map(x=>item(x.name,'Остаток ниже минимума',x.available+' шт.'))].filter(Boolean))}${list('Последние заказы',s.orders.slice(0,5).map(o=>item('№ '+o.id,o.client_name||'Без клиента',m(o.total))))}</div>`;}
 if(role==='Продавец'){title='Готовы к следующей покупке';subtitle='Касса, покупатель и ваша смена';actions=link('register','Открыть кассу')+link('products','Найти товар')+link('returns','Возврат покупателя');const shift=(s.registerShifts||[]).find(x=>x.status==='open');body=cards([['Смена',shift?'Открыта':'Закрыта','Учебная касса'],['Продажи',n(s.orders.length),'В доступной истории'],['В корзине',n((s.registerCart||[]).length),'Товарных строк']])+list('Мои задачи',tasks.slice(0,5).map(t=>item(t.title,t.date||'Без срока',t.status==='in_progress'?'В работе':'Новая')));}
 if(role==='Менеджер'){title='Каждый заказ — следующий шаг';subtitle='Ваши клиенты, переписка и договорённости';actions=link('sales','Мои заказы')+link('chats','Сообщения клиентов')+link('clients','Мои клиенты');body=cards([['Мои клиенты',n(s.clients.length),'Закреплённые и по назначенным заказам'],['В резерве',n(reserved.length),'Передать на отгрузку'],['Диалоги',n((s.chats||[]).length),'По доступным клиентам']])+list('Заказы в работе',reserved.slice(0,6).map(o=>item('№ '+o.id,o.client_name||'Без клиента',m(o.total))));}
 if(role==='Торговый представитель'){title='Ваш маршрут на сегодня';subtitle='Торговые точки, визиты и повторные заказы';actions=link('visits','План визитов')+link('clients','Мои точки')+link('sales','Оформить заказ');body=cards([['Торговые точки',n(s.clients.length),'Ваши клиенты'],['Визиты',n((s.visits||[]).filter(v=>v.status==='planned').length),'Запланированы'],['Задачи',n(tasks.length),'Нужен следующий шаг']])+list('План работы',(s.visits||[]).slice(0,6).map(v=>item(s.clients.find(c=>same(c.id,v.client_id))?.name||'Торговая точка',v.purpose||'Визит',v.date)));}
 if(role==='Бухгалтер'){title='Расчёты без пропусков';subtitle='Платежи, возвраты и документы для сверки';actions=link('finance','Платежи и взаиморасчёты')+link('finance/expenses','Расходы')+link('reports','Сверить отчёт');body=cards([['Платежи',n((s.payments||[]).length),'В журнале операций'],['Возвраты',n((s.returns||[]).filter(r=>r.refund_status!=='refunded').length),'Проверить денежный расчёт'],['Расходы',m((s.expenses||[]).filter(x=>x.status!=='void').reduce((sum,x)=>sum+x.amount,0)),'Учебные записи']])+list('Последние платежи',(s.payments||[]).slice(-6).reverse().map(x=>item('Заказ № '+x.order_id,x.method||'Платёж',m(x.amount))));}
 if(role==='Сотрудник склада'){title='Принять. Собрать. Выдать.';subtitle='Фактический товар и очередь складских операций';actions=link('stock','Остатки и движения')+link('purchases','Ожидаемые поставки')+link('returns','Проверить возвраты');body=cards([['К отгрузке',n(reserved.length),'Заказы с резервом'],['Ожидаемые поставки',n((s.purchases||[]).filter(x=>x.status==='expected').length),'Проверить при приёмке'],['Карантин',n((s.quarantine||[]).filter(x=>x.status==='awaiting_inspection').length),'Позиций на проверке']])+list('Очередь выдачи',reserved.slice(0,6).map(o=>item('Заказ № '+o.id,o.lines.map(l=>l.name).join(', '),o.lines.reduce((sum,l)=>sum+l.quantity*l.unit_size,0)+' шт.')));}
 if(role==='Диспетчер'){title='Каждая доставка на своём месте';subtitle='Назначения, выезды и решение проблем';actions=link('delivery','Управлять доставками')+link('tasks','Задачи диспетчера');body=cards([['Назначены',n(pending.filter(d=>d.status==='assigned').length),'Подтвердить выезд'],['В пути',n(pending.filter(d=>d.status==='in_transit').length),'Ожидается вручение'],['Проблемы',n(pending.filter(d=>d.status==='failed').length),'Нужно переназначение']])+list('Контроль маршрута',pending.slice(0,7).map(d=>item('Заказ № '+d.order_id,d.courier+' · '+d.address,{assigned:'Назначена',in_transit:'В пути',failed:'Проблема'}[d.status]||d.status)));}
 if(role==='Курьер'){title='Мои доставки';subtitle='Ваши адреса и результаты вручения';actions=link('delivery','Открыть маршрут')+link('tasks','Мои поручения');body=cards([['Осталось доставить',n(pending.length),'Только назначенные вам'],['Вручено',n((s.deliveries||[]).filter(d=>d.status==='delivered').length),'В доступной истории']])+list('Следующие адреса',pending.map(d=>item('Заказ № '+d.order_id,d.address+' · '+d.interval,{assigned:'Можно выезжать',in_transit:'В пути',failed:'Свяжитесь с диспетчером'}[d.status]||d.status)));}
 return `<div class="role-workspace role-${definitions.findIndex(d=>d[0]===role)}"><section class="role-hero"><div><span class="role-kicker">${e(role.toUpperCase())} · ДЕМО</span><h1>${title}</h1><p>${subtitle}</p></div><button type="button" class="role-current-person" data-role-picker aria-label="Сменить демо-сотрудника"><span class="role-avatar">${e(p.initials)}</span><span><strong>${e(p.name)}</strong><small>Сменить сотрудника ↗</small></span></button></section><div class="role-quick-actions">${actions}</div>${body}<p class="role-demo-note">Демо-пространство · данные вымышлены, изменения сохраняются при смене роли.</p></div>`;
}
g.BytRoles={enhance,current,allowedSections,project,canAction,picker,home,switchRole};
(g.BytModules||=[]).push({key:'roles',sections:[],enhance,render:()=>null,dialog:()=>null,handleAction(action,id,s,p={}){if(action!=='roles.switch')return null;switchRole(p.role||id,s);return{message:'Рабочее место: '+s.currentRole};}});
})(window);
