/* A Mesa — API para GitHub Pages. Segredos apenas nas definições do Worker. */
import {validateMenu,makeOrder,orderView} from './validation.mjs';

class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
const fail=(status,message)=>{throw new HttpError(status,message);};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const hex=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
const hash=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
const randomToken=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
function safeEqual(a,b){let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0;}
function localNow(date=new Date()){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));
 return {date:p.year+'-'+p.month+'-'+p.day,time:p.hour+':'+p.minute};
}
function initialMenu(){
 const date=new Date(localNow().date+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
 const start=date.toISOString().slice(0,10),blank={allergens:[],allergensReviewed:false,allergenNotes:''};
 return {schemaVersion:4,version:1,weekStart:start,title:'A ementa desta semana',intro:'Comida caseira, feita com carinho.',notice:'Consulte os ingredientes e alergénios com a cozinha.',cutoffTime:'10:00',accepting:false,
 days:Array.from({length:5},(_,i)=>{const d=new Date(date);d.setUTCDate(d.getUTCDate()+i);return {date:d.toISOString().slice(0,10),title:'',description:'',image:'',available:false,...blank};}),
 desserts:['dessert-a','dessert-b'].map(id=>({id,title:'',available:false,...blank}))};
}
async function readBody(request,max){
 if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))fail(415,'Formato inválido.');
 if(Number(request.headers.get('Content-Length')||0)>max)fail(413,'Conteúdo demasiado grande.');
 const reader=request.body?.getReader();if(!reader)fail(400,'Faltam os dados.');
 let length=0;const chunks=[];
 for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>max){await reader.cancel();fail(413,'Conteúdo demasiado grande.');}chunks.push(value);}
 const all=new Uint8Array(length);let offset=0;for(const part of chunks){all.set(part,offset);offset+=part.length;}
 try{return JSON.parse(new TextDecoder().decode(all));}catch{fail(400,'Dados inválidos.');}
}
function validated(fn){try{return fn();}catch(e){fail(400,e.message);}}
async function getMenu(env){
 const seed=initialMenu();
 await env.DB.prepare('INSERT OR IGNORE INTO menu (id,version,data) VALUES (1,1,?)').bind(JSON.stringify(seed)).run();
 const row=await env.DB.prepare('SELECT data FROM menu WHERE id=1').first();return validateMenu(JSON.parse(row.data));
}
async function rateLimit(env,request,scope,max,seconds){
 const now=Math.floor(Date.now()/1000),bucket=Math.floor(now/seconds);
 const ip=request.headers.get('CF-Connecting-IP')||'unknown';
 const key=await hash(env.ADMIN_CODE+'\0'+scope+'\0'+ip+'\0'+bucket);
 const row=await env.DB.prepare('INSERT INTO rate_limits (key,n,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET n=n+1 RETURNING n').bind(key,now+seconds*2).first();
 if(row.n>max)fail(429,'Demasiadas tentativas. Aguarde alguns minutos e tente novamente.');
}
async function requireAdmin(request,env){
 const auth=request.headers.get('Authorization')||'';
 if(!/^Bearer [a-f0-9]{64}$/.test(auth))fail(401,'Entre novamente na cozinha.');
 const tokenHash=await hash(env.ADMIN_CODE+'\0'+auth.slice(7));
 const row=await env.DB.prepare('SELECT expires FROM sessions WHERE token_hash=?').bind(tokenHash).first();
 if(!row||row.expires<=Math.floor(Date.now()/1000))fail(401,'A sessão terminou. Entre novamente.');
 return tokenHash;
}
async function existingOrder(env,id,digest){
 const row=await env.DB.prepare('SELECT fingerprint FROM orders WHERE id=?').bind(id).first();
 if(!row)return null;
 if(row.fingerprint!==digest)fail(409,'Esta referência já foi usada. Atualize a página antes de enviar outro pedido.');
 return {id};
}
async function route(request,env,ctx){
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(!env.DB||!env.ADMIN_CODE||env.ADMIN_CODE.length<12)fail(503,'A cozinha ainda está a configurar o serviço.');
 if(method==='GET'&&path==='/api/menu')return json(await getMenu(env));
 if(method==='POST'&&path==='/api/login'){
  await rateLimit(env,request,'login',8,900);
  const input=await readBody(request,1024);
  if(typeof input?.code!=='string'||input.code.length>200)fail(401,'Código incorreto.');
  if(!safeEqual(await hash(input.code),await hash(env.ADMIN_CODE)))fail(401,'Código incorreto.');
  const token=randomToken();
  await env.DB.prepare('INSERT INTO sessions (token_hash,expires) VALUES (?,?)').bind(await hash(env.ADMIN_CODE+'\0'+token),Math.floor(Date.now()/1000)+8*3600).run();
  return json(token);
 }
 if(method==='POST'&&path==='/api/logout'){
  const session=await requireAdmin(request,env);
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(session).run();return json(true);
 }
 if(method==='GET'&&path==='/api/admin'){
  await requireAdmin(request,env);const menu=await getMenu(env);
  const data=await env.DB.prepare('SELECT data FROM orders WHERE week_start=? ORDER BY created_at DESC').bind(menu.weekStart).all();
  return json({menu,orders:data.results.map(row=>orderView(JSON.parse(row.data)))});
 }
 if(method==='PUT'&&path==='/api/menu'){
  await requireAdmin(request,env);
  const input=await readBody(request,950000),next=validated(()=>validateMenu(input));
  await getMenu(env);
  const oldVersion=next.version;next.version++;
  const result=await env.DB.prepare('UPDATE menu SET version=?,data=? WHERE id=1 AND version=?').bind(next.version,JSON.stringify(next),oldVersion).run();
  if(result.meta.changes!==1)fail(409,'A ementa mudou entretanto. Atualize o painel antes de publicar.');
  return json(next);
 }
 if(method==='POST'&&path==='/api/orders'){
  await rateLimit(env,request,'orders',60,3600);
  const input=await readBody(request,16000);
  if(typeof input?.id!=='string'||!/^[A-Za-z0-9-]{20,80}$/.test(input.id))fail(400,'Referência inválida.');
  // Keep only the fields accepted by the organiser.
  const relevant={schemaVersion:input.schemaVersion,id:input.id,version:input.version,name:input.name,note:input.note||'',website:input.website||'',consent:input.consent,items:input.items};
  const digest=await hash(JSON.stringify(relevant));
  const previous=await existingOrder(env,input.id,digest);if(previous)return json(previous);
  const menu=await getMenu(env),order=validated(()=>makeOrder(relevant,menu,localNow()));
  const createdAt=new Date().toISOString();order.createdAt=createdAt;
  // A coluna legada recebe um valor fixo para manter compatibilidade com bases existentes.
  const result=await env.DB.prepare("INSERT OR IGNORE INTO orders (id,week_start,created_at,fingerprint,data,email_status) SELECT ?,?,?,?,?,'disabled' WHERE EXISTS (SELECT 1 FROM menu WHERE id=1 AND version=?)")
    .bind(order.id,order.weekStart,createdAt,digest,JSON.stringify(order),menu.version).run();
  if(result.meta.changes!==1){
   const duplicate=await existingOrder(env,input.id,digest);if(duplicate)return json(duplicate);
   fail(409,'A ementa mudou. Atualize a página antes de enviar.');
  }
  return json({id:order.id},201);
 }
 fail(404,'Operação não encontrada.');
}
export default {
 async fetch(request,env,ctx){
  const origin=request.headers.get('Origin');
  const allowed=(env.ALLOWED_ORIGIN||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(origin&&!allowed.includes(origin))return json({error:'Origem não autorizada.'},403);
  let response;
  try{
   if(request.method==='OPTIONS')response=new Response(null,{status:204});
   else response=await route(request,env,ctx);
  }catch(error){
   response=json({error:error instanceof HttpError?error.message:'Não foi possível concluir. Tente novamente dentro de momentos.'},error instanceof HttpError?error.status:500);
  }
  const headers=new Headers(response.headers);
  if(origin&&allowed.includes(origin)){headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');}
  headers.set('Access-Control-Allow-Methods','GET, POST, PUT, OPTIONS');
  headers.set('Access-Control-Allow-Headers','Content-Type, Authorization');
  headers.set('Access-Control-Max-Age','600');
  return new Response(response.body,{status:response.status,headers});
 },
 async scheduled(event,env,ctx){
  const now=Math.floor(Date.now()/1000);
  await env.DB.batch([
   env.DB.prepare('DELETE FROM sessions WHERE expires<?').bind(now),
   env.DB.prepare('DELETE FROM rate_limits WHERE expires<?').bind(now)
  ]);
 }
};
