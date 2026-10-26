import {createRemoteJWKSet,jwtVerify} from 'jose';
export const token=()=>crypto.randomUUID()+crypto.randomUUID();
export const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export const cookie=(request,name)=>request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);
export const sessionCookie=(value,seconds=2592000)=>`__Host-audio_session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
export const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export async function passwordHash(password,salt){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);return Array.from(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:100000},key,256)),b=>b.toString(16).padStart(2,'0')).join('');}
export function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;}
export async function identity(request,env){
 const raw=cookie(request,'__Host-audio_session');
 if(raw){const session=await env.DB.prepare('SELECT s.csrf,u.* FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.hash=? AND s.expires>?').bind(await hash(raw),Date.now()).first();if(session)return session;}
 const id=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');
 // Dispatch supplies these authenticated headers. It is an owner recovery path,
 // never a substitute for Google or password authentication for listeners.
 if(id&&email&&email.toLowerCase()===env.ADMIN_EMAIL?.toLowerCase()){let owner=await env.DB.prepare('SELECT id,name FROM users WHERE admin=1 AND email=? LIMIT 1').bind(email.toLowerCase()).first();if(!owner){await env.DB.prepare('INSERT INTO users(id,provider,subject,email,name,admin,created) VALUES(?,?,?,?,?,1,?) ON CONFLICT(id) DO NOTHING').bind('sites:'+id,'sites',id,email.toLowerCase(),email,Date.now()).run();owner={id:'sites:'+id,name:email};}return {id:owner.id,provider:'sites',email:email.toLowerCase(),name:owner.name,admin:1,csrf:cookie(request,'__Host-audio_owner_csrf')};}
 return null;
}
export async function createSession(env,userId){const raw=token(),csrf=token();await env.DB.prepare('INSERT INTO sessions(hash,user_id,csrf,expires) VALUES(?,?,?,?)').bind(await hash(raw),userId,csrf,Date.now()+2592000000).run();return {raw,csrf};}
export function requireUser(user){if(!user)fail('Сначала войди в аккаунт.',401);return user;}
export function requireAdmin(user){requireUser(user);if(!user.admin)fail('Это действие доступно только администратору.',403);}
export function originCheck(request,env){const expected=env.PUBLIC_ORIGIN||new URL(request.url).origin;if(request.headers.get('origin')!==expected)fail('Запрос с другого сайта запрещён.',403);}
export async function throttle(request,env,key,maximum){const ip=request.headers.get('cf-connecting-ip')||'local',id=await hash(ip+':'+key),now=Date.now();await env.DB.prepare('INSERT INTO auth_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<? THEN 1 ELSE count+1 END, expires=CASE WHEN expires<? THEN excluded.expires ELSE expires END').bind(id,now+900000,now,now).run();const row=await env.DB.prepare('SELECT count FROM auth_limits WHERE key=?').bind(id).first();if(row.count>maximum)fail('Слишком много попыток. Попробуй через 15 минут.',429);}
const googleKeys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export async function googleStart(request,env){
 if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)fail('Вход Google ещё не настроен. Используй почту и пароль.',503);
 const state=token(),nonce=token(),verifier=token();await env.DB.prepare('INSERT INTO oauth_flows(hash,nonce,verifier,expires) VALUES(?,?,?,?)').bind(await hash(state),nonce,verifier,Date.now()+600000).run();
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));const challenge=btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:env.PUBLIC_ORIGIN+'/api/auth/google/callback',response_type:'code',scope:'openid email profile',state,nonce,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account'}).toString();
 return new Response(null,{status:302,headers:{Location:url.href,'Set-Cookie':`__Host-audio_oauth=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,'Cache-Control':'no-store'}});
}
export async function googleCallback(request,env){
 const url=new URL(request.url),state=url.searchParams.get('state'),code=url.searchParams.get('code');if(!state||!code||!equal(state,cookie(request,'__Host-audio_oauth')))fail('Вход Google прерван. Попробуй снова.',400);
 const flow=await env.DB.prepare("DELETE FROM oauth_flows WHERE hash=? AND provider='google' AND expires>? RETURNING *").bind(await hash(state),Date.now()).first();if(!flow)fail('Время входа истекло. Начни заново.',400);
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,code,code_verifier:flow.verifier,grant_type:'authorization_code',redirect_uri:env.PUBLIC_ORIGIN+'/api/auth/google/callback'})});
 if(!response.ok)fail('Google не подтвердил вход. Попробуй снова.',401);const credentials=await response.json();
 const {payload}=await jwtVerify(credentials.id_token,googleKeys,{issuer:['https://accounts.google.com','accounts.google.com'],audience:env.GOOGLE_CLIENT_ID,algorithms:['RS256']});if(payload.nonce!==flow.nonce||payload.email_verified!==true||!payload.sub||!payload.email)fail('Google не подтвердил аккаунт.',401);
 const linked=await env.DB.prepare('SELECT id FROM users WHERE google_subject=? OR (admin=1 AND email=?) LIMIT 1').bind(payload.sub,payload.email).first();const id=linked?.id||'google:'+payload.sub,admin=payload.email.toLowerCase()===env.ADMIN_EMAIL?.toLowerCase()?1:0;
 await env.DB.prepare('INSERT INTO users(id,provider,subject,email,name,admin,created,google_subject) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name,google_subject=excluded.google_subject').bind(id,'google',payload.sub,payload.email,String(payload.name||payload.email).slice(0,100),admin,Date.now(),payload.sub).run();
 const session=await createSession(env,id);return new Response(null,{status:302,headers:{Location:'/', 'Set-Cookie':sessionCookie(session.raw),'Cache-Control':'no-store'}});
}

const githubCookie=(state,seconds=600)=>`__Host-audio_github=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
export async function githubStart(request,env,user){
 if(!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET)fail('Вход GitHub ещё не настроен. Используй Google или почту.',503);
 const state=token(),verifier=token();
 await env.DB.prepare("INSERT INTO oauth_flows(hash,provider,user_id,nonce,verifier,expires) VALUES(?,'github',?,'',?,?)").bind(await hash(state),user?.id||null,verifier,Date.now()+600000).run();
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
 const challenge=btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const url=new URL('https://github.com/login/oauth/authorize');
 url.search=new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,redirect_uri:env.PUBLIC_ORIGIN+'/api/auth/github/callback',scope:'user:email',state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
 return new Response(null,{status:302,headers:{Location:url.href,'Set-Cookie':githubCookie(state),'Cache-Control':'no-store'}});
}
export async function githubCallback(request,env,user){
 const url=new URL(request.url),state=url.searchParams.get('state'),code=url.searchParams.get('code');
 if(!state||!code||!equal(state,cookie(request,'__Host-audio_github')))fail('Вход GitHub прерван. Попробуй снова.',400);
 const flow=await env.DB.prepare("DELETE FROM oauth_flows WHERE hash=? AND provider='github' AND expires>? RETURNING *").bind(await hash(state),Date.now()).first();
 if(!flow)fail('Время входа истекло. Начни заново.',400);
 // Connecting a provider must finish in the same authenticated account that started it.
 if(flow.user_id&&flow.user_id!==user?.id)fail('Сначала войди в исходный аккаунт Audio.',401);
 const response=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code,code_verifier:flow.verifier,redirect_uri:env.PUBLIC_ORIGIN+'/api/auth/github/callback'}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)fail('GitHub не подтвердил вход.',401);
 const credentials=await response.json();if(!credentials.access_token)fail('GitHub не подтвердил вход.',401);
 const headers={Authorization:'Bearer '+credentials.access_token,Accept:'application/vnd.github+json','User-Agent':'Audio','X-GitHub-Api-Version':'2022-11-28'};
 const [profileResponse,emailResponse]=await Promise.all(['https://api.github.com/user','https://api.github.com/user/emails'].map(endpoint=>fetch(endpoint,{headers,signal:AbortSignal.timeout(15000)})));
 if(!profileResponse.ok||!emailResponse.ok)fail('Не удалось получить профиль GitHub.',401);
 const profile=await profileResponse.json(),emails=await emailResponse.json();
 const email=(emails.find(item=>item.primary&&item.verified)||emails.find(item=>item.verified))?.email?.toLowerCase();
 if(!Number.isSafeInteger(profile.id)||profile.id<=0||!email)fail('Подтверди почту в GitHub и попробуй снова.',401);
 const subject=String(profile.id),linked=await env.DB.prepare('SELECT id FROM users WHERE github_subject=?').bind(subject).first();
 if(flow.user_id&&linked&&linked.id!==flow.user_id)fail('Этот GitHub уже связан с другим аккаунтом Audio.',409);
 const owner=await env.DB.prepare('SELECT id FROM users WHERE admin=1 AND email=? LIMIT 1').bind(email).first();
 const id=flow.user_id||linked?.id||owner?.id||'github:'+subject;
 const existing=await env.DB.prepare('SELECT github_subject FROM users WHERE id=?').bind(id).first();
 if(existing?.github_subject&&existing.github_subject!==subject)fail('У аккаунта уже подключён другой GitHub.',409);
 // Do not merge ordinary accounts by email or replace their password, library or display name.
 await env.DB.prepare('INSERT INTO users(id,provider,subject,email,name,admin,created,github_subject) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET github_subject=excluded.github_subject').bind(id,'github',subject,email,String(profile.name||profile.login).slice(0,100),email===env.ADMIN_EMAIL?.toLowerCase()?1:0,Date.now(),subject).run();
 const session=await createSession(env,id),resultHeaders=new Headers({Location:'/', 'Cache-Control':'no-store'});
 resultHeaders.append('Set-Cookie',sessionCookie(session.raw));resultHeaders.append('Set-Cookie',githubCookie('',0));
 return new Response(null,{status:302,headers:resultHeaders});
}
