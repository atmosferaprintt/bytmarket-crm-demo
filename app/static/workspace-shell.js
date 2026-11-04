'use strict';
// UI demo scopes only. Production access control belongs on the server.
window.BytShell=(()=>{
 let started=false,lastRole='',wired=false;
 const equal=(a,b)=>String(a)===String(b);
 const helpers=()=>({escapeHTML,money,number,icon});
 function assertAction(action,id='',payload={}){
  const s=demoLoad();if(!window.BytRoles||BytRoles.current(s).role==='Владелец')return;
  if(!BytRoles.canAction(action,s))throw Error('Это действие недоступно в выбранной роли. Переключите сотрудника для просмотра.');
  const view=BytRoles.project(s);let collection='';
  if(/^workspace\.(edit|start|complete|reopen)-task$|^business\.complete-task$/.test(action))collection='repTasks';
  else if(/^fulfillment\.(edit-delivery|depart|deliver|fail)$/.test(action))collection='deliveries';
  else if(/^fulfillment\.(refund|inspect)$/.test(action))collection=action.endsWith('inspect')?'quarantine':'returns';
  else if(/^fulfillment\.(new-delivery|new-return|ship)$|^core\.cancel$|^pay-order$|^refund-order$|^catalog\.print-order$/.test(action))collection='orders';
  else if(/^catalog\.(edit-client|save-client)$/.test(action))collection='clients';
  else if(['send-message','select-chat'].includes(action))collection='chats';
  else if(/^business\.visit-result$/.test(action))collection='visits';
  if(collection&&id&&!view[collection]?.some(x=>equal(x.id,id)))throw Error('Запись недоступна этому сотруднику.');
  for(const [key,rows]of [['client_id','clients'],['order_id','orders']])if(payload[key]&&!view[rows]?.some(x=>equal(x.id,payload[key])))throw Error('Выберите доступную запись.');
  if((/^workspace\.(new|edit)-task$/.test(action)||['business.new-task','business.new-visit'].includes(action))&&payload.employee_id&&!view.team.some(x=>equal(x.id,payload.employee_id)))throw Error('В этой роли можно назначать задачи только себе.');
 }
 function stampCreated(s,before){
  const p=BytRoles.current(s);if(!p.employee_id)return;s.roleDemo??={};s.roleDemo.clientOwners??={};s.roleDemo.orderOwners??={};
  for(const c of s.clients)if(!before.clients.has(String(c.id))){c.responsible_id=p.employee_id;c.responsible=p.name;s.roleDemo.clientOwners[c.id]=p.employee_id;}
  for(const o of s.orders)if(!before.orders.has(String(o.id))){o.responsible_id=p.employee_id;o.employee_id=p.employee_id;o.responsible_name=p.name;s.roleDemo.orderOwners[o.id]=p.employee_id;}
 }
 function track(s){return {clients:new Set(s.clients.map(x=>String(x.id))),orders:new Set(s.orders.map(x=>String(x.id)))};}
 function startup(s){
  if(started)return;started=true;BytSettings?.apply(s);
  if(!location.hash){const key=s.settings?.interface?.landingSection;if(key&&sections[key]&&BytRoles.allowedSections(s).includes(key)){section=key;history.replaceState(null,'','#'+key);}}
 }
 function prepare(s){
  const full=demoLoad();BytRoles.enhance(full);BytSettings.apply(full);const view=BytRoles.project(full),p=BytRoles.current(full),allowed=BytRoles.allowedSections(full);
  if(!allowed.includes(section)){section='overview';history.replaceState(null,'','#overview');}
  document.body.dataset.section=section;
  document.querySelectorAll('#nav [data-section]').forEach(a=>a.hidden=!allowed.includes(a.dataset.section));
  document.querySelectorAll('#nav .nav-group').forEach(group=>{let next=group.nextElementSibling,visible=false;while(next&&!next.classList.contains('nav-group')){if(next.matches('a')&&!next.hidden)visible=true;next=next.nextElementSibling;}group.hidden=!visible;});
  document.getElementById('profile-name').textContent=p.name;document.getElementById('profile-role').textContent=p.role+' · сменить роль';document.getElementById('profile-initials').textContent=p.initials;
  const today=new Date().toLocaleDateString('sv-SE'),tasks=view.repTasks.filter(t=>t.status!=='completed'&&t.date<=today),alerts=full.settings?.notifications?.taskAlerts!==false;
  document.querySelector('[data-task-alerts]').hidden=!alerts;document.getElementById('task-alert-count').textContent=tasks.length;
  document.querySelector('[data-task-alerts]').title=tasks.length?'Задачи на сегодня и просроченные: '+tasks.length:'На сегодня всё выполнено';
  if(lastRole!==p.role){lastRole=p.role;document.getElementById('nav').scrollTop=0;}
  return view;
 }
 function descriptor(el){
  if(el.dataset.featureOpen)return[el.dataset.featureOpen,el.dataset.id];
  if(el.dataset.featureAction)return[el.dataset.featureAction,el.dataset.id];
  if(el.dataset.demoAction)return[el.dataset.demoAction,el.dataset.id];
  if(el.dataset.operationAction)return[el.dataset.operationAction,el.dataset.id];
  if(el.dataset.paymentDialog)return[el.dataset.paymentDialog,el.dataset.id];
  if(el.dataset.open)return['core.'+el.dataset.open,''];
  if(el.hasAttribute('data-cancel'))return['core.cancel',el.dataset.cancel];
  if(el.hasAttribute('data-repeat-order')||el.hasAttribute('data-chat-order'))return['core.order',''];
  if(el.matches('[data-demo-reset],[data-demo-undo],[data-demo-sync],[data-demo-load-server],[data-demo-export-json]'))return['settings.data',''];
  if(el.matches('[data-show-drafts],[data-restore-draft],[data-remove-draft]'))return['core.order',''];
  return null;
 }
 const selector='[data-feature-open],[data-feature-action],[data-demo-action],[data-operation-action],[data-payment-dialog],[data-open],[data-cancel],[data-repeat-order],[data-chat-order],[data-demo-reset],[data-demo-undo],[data-demo-sync],[data-demo-load-server],[data-demo-export-json],[data-show-drafts],[data-restore-draft],[data-remove-draft]';
 function afterRender(root=document){
  if(root===document){const taskButton=document.querySelector('.ws-heading [data-feature-open]');if(section==='tasks'&&taskButton){taskButton.classList.add('primary');document.getElementById('page-actions').append(taskButton);document.querySelector('.ws-heading').hidden=true;}const exports=document.querySelector('.an-export-menu');if(exports&&section==='reports')document.getElementById('page-actions').append(exports);}

  root.querySelectorAll(selector).forEach(el=>{if(el.tagName==='FORM')return;const d=descriptor(el);if(!d)return;try{assertAction(...d);el.hidden=false;}catch{el.hidden=true;}});
  if(!BytRoles.allowedSections(demoLoad()).includes('settings'))document.querySelectorAll('a[href="#settings"]').forEach(el=>el.hidden=true);
 }
 function dialog(id,title,body){
  let d=document.getElementById(id);if(!d){d=document.createElement('dialog');d.id=id;document.body.append(d);}
  d.setAttribute('aria-labelledby',id+'-title');d.innerHTML=`<div class="modal-head"><div class="dialog-heading"><span class="dialog-kicker">БЫТМАРКЕТ · ДЕМО</span><h2 id="${id}-title">${escapeHTML(title)}</h2></div><button type="button" class="icon-button" data-shell-close aria-label="Закрыть">×</button></div><div class="shell-dialog-body">${body}</div>`;d.showModal();return d;
 }
 function rolePicker(){dialog('role-picker','Посмотреть как сотрудник',BytRoles.picker(demoLoad(),helpers()));}
 function openSearch(){const d=dialog('global-search','Быстрый поиск','<label class="shell-search-label">Клиент, заказ или товар<input type="search" id="global-search-input" placeholder="Название, телефон, артикул или номер" autocomplete="off"></label><div id="global-search-results"></div>');search('');d.querySelector('input').focus();}
 function search(query){const v=state,q=query.trim().toLocaleLowerCase('ru'),allowed=BytRoles.allowedSections(demoLoad()),matches=x=>String(x).toLocaleLowerCase('ru').includes(q),e=escapeHTML;
  const groups=[['Разделы',Object.entries(sections).filter(([k,x])=>allowed.includes(k)&&matches(x[0])).map(([k,x])=>`<a href="#${k}" data-search-go><span>${e(x[0])}</span><small>Открыть раздел ↗</small></a>`)],['Клиенты',q?(v.clients||[]).filter(c=>matches(c.name+' '+c.phone)).slice(0,6).map(c=>`<button data-client-detail="${e(c.id)}" data-search-go><span>${e(c.name)}</span><small>${e(c.phone||'Клиент')}</small></button>`):[]],['Заказы',q?(v.orders||[]).filter(o=>matches(o.id+' '+o.client_name)).slice(0,6).map(o=>`<button data-order-detail="${e(o.id)}" data-search-go><span>№ ${e(o.id)} · ${e(o.client_name)}</span><small>${money(o.total)}</small></button>`):[]],['Товары',q&&allowed.includes('products')?(v.products||[]).filter(p=>matches(p.name+' '+p.sku+' '+p.barcode)).slice(0,6).map(p=>`<button data-search-product="${e(p.id)}"><span>${e(p.name)}</span><small>${e(p.sku)} · ${money(p.price)}</small></button>`):[]]];
  document.getElementById('global-search-results').innerHTML=groups.filter(([,r])=>r.length).map(([t,r])=>`<section><h3>${t}</h3>${r.join('')}</section>`).join('')||'<p class="help">Совпадений нет. Попробуйте другой запрос.</p>';
 }
 function install(){
  if(wired)return;wired=true;
  for(const m of window.BytModules||[]){const original=m.handleAction;if(!original)continue;m.handleAction=function(action,id,s,payload={}){assertAction(action,id,payload);const before=track(s),result=original.call(this,action,id,s,payload);stampCreated(s,before);return result;};}
  for(const target of [window.BytDemo,window.BytOperations]){const original=target?.handleAction;if(original)target.handleAction=function(action,id,s,payload={}){assertAction(action,id,payload);return original.call(this,action,id,s,payload);};}
  document.addEventListener('click',async event=>{
   const restricted=event.target.closest(selector);if(restricted){try{assertAction(...(descriptor(restricted)||[]));}catch(error){event.preventDefault();event.stopImmediatePropagation();notify(error.message);return;}}
   if(event.target.closest('[data-search-go]'))document.getElementById('global-search')?.close();
   if(event.target.closest('[data-shell-close]'))event.target.closest('dialog').close();
   if(event.target.closest('[data-role-picker]')){rolePicker();return;}
   const choice=event.target.closest('[data-role-choice]');if(choice){document.querySelectorAll('dialog[open]').forEach(d=>d.close());BytRoles.switchRole(choice.dataset.roleChoice,demoLoad());demoSave();location.hash='overview';await refresh();return;}
   if(event.target.closest('[data-global-search]'))openSearch();
   const product=event.target.closest('[data-search-product]');if(product){const p=state.products.find(x=>equal(x.id,product.dataset.searchProduct));document.getElementById('global-search').close();showDemoDetails(p.name,`<div class="detail-grid"><p>Артикул<strong>${escapeHTML(p.sku)}</strong></p><p>Цена<strong>${money(p.price)}</strong></p><p>Доступно<strong>${number(p.available)} шт.</strong></p></div><a class="button primary" href="#products" data-close-details>Каталог товаров</a>`);}
   if(event.target.closest('[data-task-alerts]')){demoLoad().taskView.filter='all';demoSave();location.hash='tasks';await refresh();}
  },true);
  document.addEventListener('input',event=>{if(event.target.id==='global-search-input')search(event.target.value);});
  document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(!document.querySelector('dialog[open]'))openSearch();}});
  const observer=new MutationObserver(records=>{for(const r of records)for(const el of r.addedNodes)if(el.nodeType===1&&(el.closest('dialog')||el.tagName==='DIALOG'))afterRender(el);});observer.observe(document.body,{childList:true,subtree:true});
 }
 document.addEventListener('DOMContentLoaded',install);
 return{prepare,startup,afterRender,assertAction,track,stampCreated};
})();
