import {localEnv} from './local-env.mjs';
import {handleApi} from './api.mjs';
import {createSession,sessionCookie,identity} from './auth.mjs';
import {readdir,readFile} from 'node:fs/promises';
export function audioDev(){let env;return {name:'audio-development-api',async configureServer(server){
 env=await localEnv();await env.DB.prepare('CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)').run();
 for(const file of (await readdir('drizzle')).filter(x=>x.endsWith('.sql')).sort()){if(!await env.DB.prepare('SELECT name FROM local_migrations WHERE name=?').bind(file).first()){env.sqlite.exec(await readFile('drizzle/'+file,'utf8'));await env.DB.prepare('INSERT INTO local_migrations(name) VALUES(?)').bind(file).run();}}
 server.middlewares.use(async(req,res,next)=>{
  if(!req.url.startsWith('/api/')&&!/^\/editor(?:\.html)?(?:\?|$)/.test(req.url))return next();
  try{const url=new URL(req.url,'http://'+req.headers.host),headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(','):value);const request=new Request(url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:ReadableStream.from(req),duplex:'half'}:{})});
   let response;
   if(url.pathname==='/api/dev/login'){
    const allowed=new Set(['admin','alice','bob']),as=url.searchParams.get('as');if(!allowed.has(as)){res.writeHead(400);res.end();return;}
    const id='dev:'+as;await env.DB.prepare('INSERT INTO users(id,provider,subject,email,name,admin,created) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,'development',as,as==='admin'?env.ADMIN_EMAIL:as+'@audio.test',as==='admin'?'Администратор':as,as==='admin'?1:0,Date.now()).run();const session=await createSession(env,id);response=new Response(null,{status:302,headers:{Location:'/', 'Set-Cookie':sessionCookie(session.raw)}});
   }else if(url.pathname.startsWith('/api/'))response=await handleApi(request,{...env,PUBLIC_ORIGIN:url.origin});
   else {const user=await identity(request,env);if(user?.admin)return next();response=new Response('Редактор доступен только администратору.',{status:403});}
   res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body){for await(const chunk of response.body)res.write(chunk);}res.end();
  }catch(error){console.error(error);res.writeHead(500);res.end('Ошибка локального сервера');}
 });
 }};}
