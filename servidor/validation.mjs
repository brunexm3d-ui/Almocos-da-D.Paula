
const ALLERGENS = [
 ['gluten','Cereais com glúten'],['crustaceos','Crustáceos'],['ovos','Ovos'],['peixe','Peixe'],
 ['amendoim','Amendoim'],['soja','Soja'],['leite','Leite (inclui lactose)'],['frutos-casca-rija','Frutos de casca rija'],
 ['aipo','Aipo'],['mostarda','Mostarda'],['sesamo','Sementes de sésamo'],['sulfitos','Dióxido de enxofre e sulfitos'],
 ['tremoco','Tremoço'],['moluscos','Moluscos']
];
function cleanText(value,max,required=false){
 if(typeof value!=='string')throw Error('Texto inválido.');
 const s=value.trim(); if(s.length>max||(required&&!s))throw Error('Verifique os campos obrigatórios e o tamanho do texto.');return s;
}
function validDate(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;}
function shiftDate(s,n){const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
function validateAllergens(item){
 const allowed=new Set(ALLERGENS.map(x=>x[0]));
 if(!Array.isArray(item.allergens)||item.allergens.some(x=>!allowed.has(x))||new Set(item.allergens).size!==item.allergens.length)throw Error('Seleção de alergénios inválida.');
 return {allergens:item.allergens.slice(),allergensReviewed:item.allergensReviewed===true,allergenNotes:cleanText(item.allergenNotes||'',200)};
}
function validateMenu(input,allowDemoImages=false){
 if(!input||!validDate(input.weekStart)||new Date(input.weekStart+'T12:00:00Z').getUTCDay()!==1)throw Error('Escolha uma segunda-feira.');
 if(!Number.isInteger(input.version)||input.version<1)throw Error('Versão inválida.');
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.cutoffTime||''))throw Error('Hora limite inválida.');
 if(typeof input.accepting!=='boolean'||!Array.isArray(input.days)||input.days.length!==5||!Array.isArray(input.desserts)||input.desserts.length!==2)throw Error('A ementa precisa de cinco dias e dois espaços de sobremesa.');
 const days=input.days.map((d,i)=>{
  if(!d||d.date!==shiftDate(input.weekStart,i)||typeof d.available!=='boolean')throw Error('Dia inválido.');
  const image=d.image||'';
  if(typeof image!=='string'||image.length>180000||(image&&!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)&&!(allowDemoImages&&image.startsWith('data:image/svg+xml;charset=utf-8,'))))throw Error('Fotografia inválida.');
  return {date:d.date,title:cleanText(d.title||'',100,d.available),description:cleanText(d.description||'',220),image,available:d.available,...validateAllergens(d)};
 });
 const desserts=input.desserts.map((d,i)=>{
  if(!d||d.id!==['dessert-a','dessert-b'][i]||typeof d.available!=='boolean')throw Error('Sobremesa inválida.');
  return {id:d.id,title:cleanText(d.title||'',80,d.available),available:d.available,...validateAllergens(d)};
 });
 return {schemaVersion:4,version:input.version,weekStart:input.weekStart,title:cleanText(input.title,70,true),intro:cleanText(input.intro||'',240),notice:cleanText(input.notice||'',300),cutoffTime:input.cutoffTime,accepting:input.accepting,days,desserts};
}

const MAX_QUANTITY=99;
function requestClosed(day,menu,now,allowPast=false){
 return !menu.accepting||(!allowPast&&(day.date<now.date||(day.date===now.date&&now.time>=menu.cutoffTime)));
}
function makeOrder(input,menu,now,allowPast=false){
 if(!input||input.website||input.consent!==true)throw Error('Confirme a utilização do nome para tratar do pedido.');
 if(input.schemaVersion!==4)throw Error('Atualize a página para usar a nova versão dos pedidos.');
 if(typeof input.id!=='string'||!/^[A-Za-z0-9-]{20,80}$/.test(input.id))throw Error('Referência inválida.');
 if(input.version!==menu.version)throw Error('A ementa mudou. Atualize a página antes de enviar.');
 if(!menu.accepting)throw Error('Os pedidos estão fechados.');
 const name=cleanText(input.name,80,true);if(name.length<2)throw Error('Indique o seu nome.');
 const note=cleanText(input.note||'',400);
 if(!Array.isArray(input.items)||!input.items.length||input.items.length>5)throw Error('Escolha pelo menos um dia.');
 const seen=new Set();
 const items=input.items.map(x=>{
  if(!x||seen.has(x.date)||typeof x.want!=='boolean')throw Error('Escolha de dia inválida.');seen.add(x.date);
  const day=menu.days.find(d=>d.date===x.date);if(!day)throw Error('Dia inválido.');
  if(requestClosed(day,menu,now,allowPast))throw Error('Já passou a hora limite para um dos dias.');
  if(x.want&&(!day.available||!day.title))throw Error('O almoço de um dos dias já não está disponível.');
  if(!Number.isInteger(x.quantity)||(x.want?(x.quantity<1||x.quantity>MAX_QUANTITY):x.quantity!==0))throw Error('Quantidade de almoços inválida.');
  const dessertId=x.dessertId??'',dq=x.dessertQuantity??0;
  if(typeof dessertId!=='string'||!Number.isInteger(dq)||dq<0||dq>MAX_QUANTITY)throw Error('Quantidade de sobremesas inválida.');
  if(!dessertId&&dq!==0)throw Error('Escolha a sobremesa para as doses indicadas.');
  let dessert=null;
  if(dessertId){
   const d=menu.desserts.find(d=>d.id===dessertId&&d.available);
   if(!d||!d.title||dq<1)throw Error('Escolha uma sobremesa disponível e indique as doses.');
   dessert={id:d.id,title:d.title,quantity:dq,...validateAllergens(d)};
  }
  return {date:day.date,title:day.title,want:x.want,quantity:x.quantity,...validateAllergens(day),dessert};
 });
 return {schemaVersion:4,id:input.id,version:menu.version,weekStart:menu.weekStart,name,note,items};
}
function orderView(o){
 const info=d=>({allergens:Array.isArray(d.allergens)?d.allergens.slice():[],allergensReviewed:d.allergensReviewed===true,allergenNotes:d.allergenNotes||''});
 return {schemaVersion:4,id:o.id,version:o.version,weekStart:o.weekStart,name:o.name,note:o.note||'',createdAt:o.createdAt,
  items:(o.items||[]).map(x=>({date:x.date,title:x.title||'',want:x.want===true,quantity:x.want?x.quantity:0,...info(x),
   dessert:x.dessert?{id:x.dessert.id,title:x.dessert.title,quantity:x.dessert.quantity,...info(x.dessert)}:null}))};
}

export {ALLERGENS,MAX_QUANTITY,validateMenu,makeOrder,orderView};
