'use strict';
window.BytModules=window.BytModules||[];
const featureHelpers=()=>({escapeHTML,money,number,icon});
function featureModule(action){return window.BytModules.find(m=>m.key===String(action).split('.')[0]);}
function featureResult(result){
  if(result?.download){const d=result.download,url=URL.createObjectURL(new Blob([d.content],{type:d.mime||'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=d.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  if(result?.print){let frame=document.getElementById('print-frame');if(frame)frame.remove();frame=document.createElement('iframe');frame.id='print-frame';frame.title='Документ для печати';frame.style.cssText='position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';document.body.append(frame);frame.srcdoc=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHTML(result.print.title)}</title><style>body{font:14px/1.5 Arial;padding:25px;color:#0a1c3a}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ddd;padding:9px;text-align:left}h1{font-size:24px}@page{margin:15mm}</style></head><body>${result.print.body}</body></html>`;frame.onload=()=>frame.contentWindow.print();}
  if(result?.preview)showDemoDetails(result.preview.title,result.preview.body);
  if(result?.message)notify(result.message);
}
async function performFeature(action,id,payload={},form=null){
  const module=featureModule(action);if(!module)throw Error('Раздел ещё загружается');
  const before=structuredClone(demoLoad());
  try{const result=await module.handleAction(action,id,demoData,payload);demoSave();if(result?.message)document.getElementById('demo-details')?.close();if(form?.id==='feature-form')document.getElementById('feature-dialog').close();await refresh();featureResult(result);return result;}
  catch(error){demoData=before;const field=form?.querySelector('[data-feature-error]');if(field)field.textContent=error.message;else notify(error.message);return null;}
}
function openFeature(action,id=''){
 const module=featureModule(action);if(!module?.dialog)return;const result=module.dialog(action,id,state,featureHelpers());if(!result)return;
 const contexts={workspace:['Задачник · команда','Задача и ответственный','Опишите ожидаемый результат, выберите сотрудника и срок.'],catalog:['Справочники','Данные карточки','Проверьте реквизиты и условия. История документов останется прежней.'],register:['Кассовое рабочее место','Параметры операции','Учебная операция без внешнего списания денег и фискализации.'],fulfillment:['Товародвижение','Данные документа','Проверьте заказ, количество и основание. Товары и расчёты учитываются отдельно.'],inventory:['Управление складом','Параметры документа','Выберите место хранения и количество в штуках. Операция будет отражена в журнале.'],business:['Работа с клиентами','Данные и условия','Заполните сведения для этого сценария в демонстрационном пространстве.']};
 const [kicker,sectionTitle,description]=contexts[module.key]||['БытМаркет CRM','Параметры','Проверьте сведения перед сохранением в учебном пространстве.'];
 const payment=action==='register.payment',picker=result.submitLabel===null;
 const detail=payment?'Укажите наличную и безналичную части оплаты. Сдача рассчитывается только из наличных.':picker?'Выберите документ, чтобы продолжить. На этом шаге данные ещё не изменяются.':description;
 const symbol=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${payment?'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h3"/>':'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h4"/>'}</svg>`;
 let dlg=document.getElementById('feature-dialog');if(!dlg){dlg=document.createElement('dialog');dlg.id='feature-dialog';dlg.setAttribute('aria-labelledby','feature-title');document.body.append(dlg);}
 dlg.setAttribute('aria-describedby','feature-description');dlg.style.cssText=`width:min(${payment?580:module.key==='catalog'?780:720}px,calc(100vw - 24px));max-height:calc(100dvh - 40px);overflow:hidden`;
 const template=document.createElement('template');template.innerHTML=result.body;
 template.content.querySelectorAll('form').forEach(form=>form.replaceWith(...form.childNodes));
 dlg.innerHTML=`<div class="modal-head" style="flex-shrink:0"><div class="dialog-heading"><span class="dialog-symbol">${symbol}</span><div><div class="dialog-kicker">${escapeHTML(kicker)}</div><h2 id="feature-title">${escapeHTML(result.title)}</h2><p id="feature-description" class="dialog-description">${escapeHTML(detail)}</p></div></div><button type="button" class="icon-button" data-feature-close aria-label="Закрыть">×</button></div><form id="feature-form" data-feature-form data-feature-action="${escapeHTML(result.action||action)}" data-id="${escapeHTML(id)}" style="padding:0;display:flex;flex-direction:column;min-height:0;flex:1;overflow:hidden"><div class="feature-fields" style="overflow:auto;min-height:0;padding:24px 26px 2px"><section class="form-section"><h3 class="form-section-heading">${escapeHTML(picker?'Выбор документа':payment?'Способы оплаты':sectionTitle)}</h3><div class="feature-section-content">${template.innerHTML}</div></section></div><p class="form-error" data-feature-error role="alert" style="margin:0;padding:0 26px;flex-shrink:0"></p><div class="modal-actions" style="position:relative;bottom:auto;margin:0;padding:17px 26px;flex-shrink:0"><button type="button" class="button secondary" data-feature-close>${picker?'Закрыть':'Отмена'}</button>${picker?'':`<button class="button primary" type="submit">${escapeHTML(result.submitLabel||'Сохранить')}</button>`}</div></form>`;
 document.getElementById('demo-details')?.close();if(!dlg.open)dlg.showModal();
 dlg.style.display='flex';dlg.style.flexDirection='column';
 dlg.addEventListener('close',()=>{dlg.style.removeProperty('display');},{once:true});
}
document.addEventListener('click',event=>{
 if(event.target.closest('[data-feature-close]'))event.target.closest('dialog')?.close();
 const open=event.target.closest('[data-feature-open]');if(open){try{openFeature(open.dataset.featureOpen,open.dataset.id||'');}catch(error){notify(error.message);}return;}
 const action=event.target.closest('button[data-feature-action]');if(action&&!(action.form&&action.type==='submit')){performFeature(action.dataset.featureAction,action.dataset.id||'',{});return;}
});
document.addEventListener('submit',async event=>{
 const form=event.target;if(!form.matches('[data-feature-form]'))return;event.preventDefault();if(form.dataset.busy)return;
 form.dataset.busy='1';const submit=form.querySelector('[type=submit]');if(submit)submit.disabled=true;
 try{await performFeature(event.submitter?.dataset.featureAction||form.dataset.featureAction,form.dataset.id||'',Object.fromEntries(new FormData(form)),form);}finally{delete form.dataset.busy;if(submit)submit.disabled=false;}
});
