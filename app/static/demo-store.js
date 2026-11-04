'use strict';
// Local demonstration snapshots are isolated from the server's operational tables.
window.BytPersistence=(()=>{
 let ready=null,revision=0,pending=null,saving=false,conflict=false,timer=null;
 const marker='bytmarket-demo-sync';
 function status(text,error=false){const el=document.getElementById('save-state');if(el){el.textContent=text;el.classList.toggle('is-error',error);}}
 async function request(method,data){const r=await fetch('/api/demo-state',{method,headers:{'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});let body=await r.json();if(!r.ok){const error=Error(body.error||'Не удалось сохранить демо');error.conflict=r.status===409;throw error;}return body;}
 async function hydrate(){
  if(ready)return ready;
  ready=(async()=>{try{const remote=await request('GET');revision=remote.revision;const local=localStorage.getItem(DEMO_KEY),sync=JSON.parse(localStorage.getItem(marker)||'null');if(remote.state){if(local&&sync?.pending){demoData=JSON.parse(local);if(sync.revision!==revision){conflict=true;status('Есть две версии демо · откройте «Интеграции»',true);return;}}else{demoData=remote.state;localStorage.setItem(DEMO_KEY,JSON.stringify(demoData));}}else demoLoad();demoRecalculate(demoData);schedule(demoData);}catch(error){demoLoad();status('Сохранено в браузере · сервер недоступен',true);}})();return ready;
 }
 function schedule(data){pending=JSON.stringify(data);localStorage.setItem(marker,JSON.stringify({revision,pending:true}));status(conflict?'Конфликт версий · копия в браузере':'Сохраняем демо…',conflict);clearTimeout(timer);timer=setTimeout(flush,200);}
 async function flush(){
  if(saving||!pending||conflict)return;
  saving=true;const candidate=pending;pending=null;
  try{const result=await request('POST',{expected_revision:revision,state:JSON.parse(candidate)});revision=result.revision;localStorage.setItem(marker,JSON.stringify({revision,pending:!!pending}));status('Демо сохранено на этом компьютере');}
  catch(error){if(!pending)pending=candidate;conflict=!!error.conflict;status(conflict?'Есть две версии демо · откройте «Интеграции»':'Сохранено в браузере · повторить в «Интеграциях»',true);}
  finally{saving=false;if(pending&&!conflict)setTimeout(()=>{if(navigator.onLine)flush();},5000);}
 }
 async function loadRemote(){const remote=await request('GET');if(!remote.state)throw Error('Серверная копия пока пуста');localStorage.setItem(DEMO_KEY+'-conflict-backup',JSON.stringify(demoLoad()));demoData=remote.state;revision=remote.revision;pending=null;conflict=false;localStorage.setItem(DEMO_KEY,JSON.stringify(demoData));localStorage.setItem(marker,JSON.stringify({revision,pending:false}));demoRecalculate(demoData);status('Загружена серверная копия');await refresh();notify('Версия сервера загружена. Предыдущая локальная копия сохранена в резерве браузера.');}
 window.addEventListener('online',flush);
 return {hydrate,schedule,flush,loadRemote};
})();
