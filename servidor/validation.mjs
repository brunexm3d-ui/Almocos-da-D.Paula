
const ALLERGENS = [
 ['gluten','Cereais com glúten'],['crustaceos','Crustáceos'],['ovos','Ovos'],['peixe','Peixe'],
 ['amendoim','Amendoim'],['soja','Soja'],['leite','Leite (inclui lactose)'],['frutos-casca-rija','Frutos de casca rija'],
 ['aipo','Aipo'],['mostarda','Mostarda'],['sesamo','Sementes de sésamo'],['sulfitos','Dióxido de enxofre e sulfitos'],
 ['tremoco','Tremoço'],['moluscos','Moluscos']
];
function cents(value){return Math.round(Number(value)*100);}
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
function validatePrice(n,required=false){
 if(n===null&&!required)return null;
 if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>500)throw Error('Indique um preço válido entre 0 e 500 €.');
 return cents(n)/100;
}
function validateMenuV2(input,allowDemoImages=false){
 if(!input||!validDate(input.weekStart)||new Date(input.weekStart+'T12:00:00Z').getUTCDay()!==1)throw Error('Escolha uma segunda-feira.');
 if(!Number.isInteger(input.version)||input.version<1)throw Error('Versão inválida.');
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.cutoffTime||''))throw Error('Hora limite inválida.');
 if(typeof input.accepting!=='boolean'||!Array.isArray(input.days)||input.days.length!==5||!Array.isArray(input.desserts)||input.desserts.length!==2)throw Error('A ementa precisa de cinco dias e dois espaços de sobremesa.');
 const days=input.days.map((d,i)=>{
  if(!d||d.date!==shiftDate(input.weekStart,i)||typeof d.available!=='boolean')throw Error('Dia inválido.');
  const image=d.image||'';
  if(typeof image!=='string'||image.length>180000||(image&&!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)&&!(allowDemoImages&&image.startsWith('data:image/svg+xml;charset=utf-8,'))))throw Error('Fotografia inválida.');
  return {date:d.date,title:cleanText(d.title||'',100,d.available),description:cleanText(d.description||'',220),price:validatePrice(d.price),image,available:d.available,...validateAllergens(d)};
 });
 const desserts=input.desserts.map((d,i)=>{
  if(!d||d.id!==['dessert-a','dessert-b'][i]||typeof d.available!=='boolean')throw Error('Sobremesa inválida.');
  return {id:d.id,title:cleanText(d.title||'',80,d.available),price:validatePrice(d.price,d.available),available:d.available,...validateAllergens(d)};
 });
 return {version:input.version,weekStart:input.weekStart,title:cleanText(input.title,70,true),intro:cleanText(input.intro||'',240),notice:cleanText(input.notice||'',300),cutoffTime:input.cutoffTime,accepting:input.accepting,days,desserts};
}
function makeOrderV2(input,menu,now,allowPast=false){
 if(!input||input.website||input.consent!==true)throw Error('Pedido inválido. Confirme a utilização do nome para tratar do pedido.');
 if(typeof input.id!=='string'||!/^[A-Za-z0-9-]{20,80}$/.test(input.id))throw Error('Referência inválida.');
 if(input.version!==menu.version)throw Error('A ementa mudou. Atualize a página antes de enviar.');
 if(!menu.accepting)throw Error('Os pedidos estão fechados.');
 const name=cleanText(input.name,80,true);if(name.length<2)throw Error('Indique o seu nome.');
 const note=cleanText(input.note||'',400);
 if(!Array.isArray(input.items)||!input.items.length||input.items.length>5)throw Error('Escolha pelo menos um dia.');
 const seen=new Set();let totalCents=0,unknownPrice=false;
 const items=input.items.map(x=>{
  if(!x||seen.has(x.date)||typeof x.want!=='boolean')throw Error('Escolha de dia inválida.');seen.add(x.date);
  const day=menu.days.find(d=>d.date===x.date);
  if(!day||!day.available||!day.title)throw Error('Um dos dias já não está disponível.');
  if(!allowPast&&(day.date<now.date||(day.date===now.date&&now.time>=menu.cutoffTime)))throw Error('Já passou a hora limite para um dos dias.');
  if(!Number.isInteger(x.quantity)||x.quantity<(x.want?1:0)||x.quantity>(x.want?10:0))throw Error('Quantidade de almoços inválida.');
  const dessertId=x.dessertId||'',dq=x.dessertQuantity??0;
  if(!Number.isInteger(dq)||dq<0||dq>x.quantity)throw Error('Quantidade de sobremesas inválida.');
  if((!x.want&&(dessertId||dq))||(!dessertId&&dq))throw Error('A sobremesa deve acompanhar um almoço.');
  let dessert=null;
  if(dessertId){
   const d=menu.desserts.find(d=>d.id===dessertId&&d.available);
   if(!d||!d.title||dq<1||typeof d.price!=='number')throw Error('A sobremesa escolhida já não está disponível.');
   dessert={id:d.id,title:d.title,quantity:dq,unitCents:cents(d.price),allergens:d.allergens.slice(),allergensReviewed:d.allergensReviewed,allergenNotes:d.allergenNotes||''};
   totalCents+=dessert.unitCents*dq;
  }
  if(x.want){if(typeof day.price==='number')totalCents+=cents(day.price)*x.quantity;else unknownPrice=true;}
  return {date:day.date,title:day.title,want:x.want,quantity:x.quantity,unitCents:typeof day.price==='number'?cents(day.price):null,allergens:day.allergens.slice(),allergensReviewed:day.allergensReviewed,allergenNotes:day.allergenNotes||'',dessert};
 });
 return {id:input.id,version:menu.version,weekStart:menu.weekStart,name,note,items,totalCents,unknownPrice};
}

export {ALLERGENS,validateMenuV2,makeOrderV2};
