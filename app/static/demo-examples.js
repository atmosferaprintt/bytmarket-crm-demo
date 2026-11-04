(function(global){
'use strict';
const next=rows=>Math.max(0,...rows.map(r=>Number(r.id)||0))+1,round=n=>Math.round(n*100)/100;
function today(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Astrakhan',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;}
function shift(day,n){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
function enhance(s){
 if(s.examplesVersion>=1)return s;
 for(const name of ['orders','payments','returns','quarantine','visits','repTasks','promotions','expenses','team','clientAssignments'])s[name]??=[];
 if(!s.products?.length||!s.clients?.length)return s;
 const day=today(),note='Вымышленная история для демонстрации. Начальные остатки уже отражают эти отгрузки и возвраты; текущий склад не изменён. Себестоимость учебная, зафиксирована в строках.';
 const staff=(role,name)=>{let member=s.team.find(m=>m.role===role&&m.active!==false);if(!member){member={id:next(s.team),name,role,active:true,demo_example:true};s.team.push(member);}return member;};
 const rep=staff('Торговый представитель','Демо-представитель'),manager=staff('Менеджер','Демо-менеджер');staff('Курьер','Демо-курьер');staff('Владелец','Демо-владелец');
 const added=[];
 for(let i=0;i<14;i++){
  const product=s.products[i%s.products.length],client=s.clients[i%s.clients.length],quantity=2+i%4,price=round(Number(product.price)||0),date=shift(day,i-13),created_at=date+`T${String(9+i%8).padStart(2,'0')}:20:00+04:00`;
  const line={product_id:product.id,name:product.name,quantity,unit_size:1,price,total:round(price*quantity),cost_price:round(price*(0.60+(i%3)*0.04))};
  const order={id:next(s.orders),client_id:client.id,client_name:client.name,status:i%3?'delivered':'shipped',lines:[line],total:line.total,paid:line.total,created_at,shipped_at:created_at,location_id:'warehouse',source:'demo_history',employee_id:i%2?rep.id:manager.id,responsible_id:i%2?rep.id:manager.id,responsible_name:i%2?rep.name:manager.name,idempotency_key:'examples-v1-'+i,demo_example:true,note};
  if(order.status==='delivered')order.delivered_at=date+'T18:00:00+04:00';s.orders.push(order);added.push(order);
  s.payments.push({id:next(s.payments),order_id:order.id,amount:order.total,method:'Учебная историческая оплата',created_at,demo_example:true});
 }
 // Both returns are independent documents; neither touches the current stock snapshot.
 for(let i=0;i<2;i++){
  const order=added[12+i],line=order.lines[0],created_at=day+'T19:00:00+04:00',completed=i===1;
  const returned={id:next(s.returns),order_id:order.id,lines:[{product_id:line.product_id,name:line.name,quantity:1,unit_price:line.price,total:line.price,source_line_index:0,order_line_index:0}],total:line.price,reason:completed?'Демо: повреждение, проверка завершена':'Демо: проверка упаковки',status:completed?'inspected':'quarantine',refund_status:completed?'refunded':'not_recorded',created_at,author:'Демо-оператор',demo_example:true};
  s.returns.push(returned);s.quarantine.push({id:next(s.quarantine),return_id:returned.id,order_id:order.id,product_id:line.product_id,name:line.name,quantity:1,location_id:'warehouse',status:completed?'written_off':'awaiting_inspection',created_at,...(completed?{inspected_at:created_at,inspection_reason:'Демо: повреждённая упаковка, списано из карантина'}:{}),demo_example:true});
  if(completed){s.payments.push({id:next(s.payments),order_id:order.id,return_id:returned.id,amount:-returned.total,method:'Учебный возврат по ВЗ-'+returned.id,created_at,demo_example:true});order.paid=round(order.paid-returned.total);}
 }
 if(!s.visits.length)for(let i=0;i<3;i++)s.visits.push({id:next(s.visits),client_id:s.clients[i%s.clients.length].id,employee_id:rep.id,date:shift(day,i-1),purpose:['Демо: повторный заказ','Демо: знакомство с ассортиментом','Демо: согласовать следующую поставку'][i],status:i===0?'completed':'planned',...(i===0?{result:'followup',comment:'Учебный результат: клиент попросил связаться завтра',completed_at:day+'T09:00:00+04:00'}:{}),demo_example:true});
 if(!s.repTasks.length)for(let i=0;i<2;i++)s.repTasks.push({id:next(s.repTasks),client_id:s.clients[i%s.clients.length].id,employee_id:rep.id,date:shift(day,i),title:i?'Демо: уточнить ассортимент следующего заказа':'Демо: подготовить предложение клиенту',status:'open',demo_example:true});
 if(!s.clientAssignments.length)s.clientAssignments.push({client_id:s.clients[0].id,employee_id:rep.id,demo_example:true});
 if(!s.promotions.length)s.promotions.push({id:next(s.promotions),name:'Демо: знакомство с ассортиментом',start:shift(day,-3),end:shift(day,7),discount:5,target_type:'product',target_id:String(s.products[0].id),client_type:'all',active:true,demo_example:true});
 if(!s.expenses.length)for(const [i,category,amount]of [[0,'Доставка',650],[1,'Реклама',1200],[2,'Прочее',350]])s.expenses.push({id:next(s.expenses),category,amount,date:shift(day,-i),comment:'Учебный пример расхода; реальной выплаты не было',status:'posted',created_at:day+'T10:00:00+04:00',demo_example:true});
 s.examplesNote=note;s.examplesVersion=1;s.examplesAddedAt=new Date().toISOString();return s;
}
(global.BytModules||=[]).push({key:'examples',sections:[],enhance,render:()=>null,dialog:()=>null,handleAction:()=>null});
})(window);
