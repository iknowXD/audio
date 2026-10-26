import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localEnv} from '../server/local-env.mjs';
import {handleApi} from '../server/api.mjs';
import worker from '../server/worker.mjs';
import {createSession,sessionCookie} from '../server/auth.mjs';
async function setup(){const dir=await mkdtemp(join(tmpdir(),'audio-account-tests-')),env=await localEnv(dir,true);env.PUBLIC_ORIGIN='https://audio.test';for(const file of(await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())env.sqlite.exec(await readFile('drizzle/'+file,'utf8'));return env;}
async function call(env,path,{user,method='GET',data,bytes,headers={}}={}){return handleApi(new Request('https://audio.test'+path,{method,headers:{Origin:'https://audio.test',...(user?{cookie:sessionCookie(user.raw),'x-audio-csrf':user.csrf}:{}),...(data?{'content-type':'application/json'}:{}),...headers},body:bytes||data&&JSON.stringify(data)}),env);}
async function user(env,name,admin=false){const id=name;await env.DB.prepare('INSERT INTO users(id,provider,subject,email,name,admin,created) VALUES(?,?,?,?,?,?,?)').bind(id,'test',id,name+'@test.dev',name,admin?1:0,Date.now()).run();return {...await createSession(env,id),id};}
async function asset(env,owner,kind='audio',bytes='test audio',mime='audio/mpeg'){const response=await call(env,'/api/assets?kind='+kind,{user:owner,method:'POST',bytes,headers:{'content-type':mime,'content-length':String(new TextEncoder().encode(bytes).byteLength),'x-audio-filename':'test.mp3'}});assert.equal(response.status,201);return (await response.json()).id;}
test('accounts: registration cannot claim owner role, password login works, sessions expire and CSRF is enforced',async()=>{const env=await setup();try{
 const register=await call(env,'/api/auth/register',{method:'POST',data:{email:'listener@test.dev',password:'Long-test-password',name:'Not owner',admin:true}});assert.equal(register.status,201);const raw=register.headers.get('set-cookie').split(';')[0].split('=')[1];const info=await call(env,'/api/session',{user:{raw}});const session=await info.json();assert.equal(session.user.isAdmin,false);assert.equal((await call(env,'/api/admin/tracks',{user:{raw,csrf:session.csrf},method:'PUT',data:{}})).status,403);
 assert.equal((await call(env,'/api/auth/login',{method:'POST',data:{email:'listener@test.dev',password:'wrong-password'}})).status,401);assert.equal((await call(env,'/api/auth/login',{method:'POST',data:{email:'listener@test.dev',password:'Long-test-password'}})).status,200);
 assert.equal((await call(env,'/api/library',{method:'POST',user:{raw,csrf:'wrong'},data:{id:'x'}})).status,403);assert.equal((await call(env,'/api/auth/login',{method:'POST',data:{email:'x',password:'x'},headers:{origin:'https://evil.test'}})).status,403);
 await env.DB.prepare('UPDATE sessions SET expires=0').run();assert.equal((await(await call(env,'/api/session',{user:{raw}})).json()).user,null);
}finally{env.sqlite.close();}});
test('accounts: draft and media are private, only admin publishes, two listeners keep independent libraries and playlists',async()=>{const env=await setup();try{
 const admin=await user(env,'admin',true),alice=await user(env,'alice'),bob=await user(env,'bob'),audioId=await asset(env,admin);let track={id:'song',title:'Свет',artist:'Артист',album:'Альбом',filename:'test.mp3',audioId,published:false};
 assert.equal((await call(env,'/api/admin/tracks',{user:admin,method:'PUT',data:track})).status,200);assert.deepEqual((await(await call(env,'/api/catalog',{user:alice})).json()).tracks,[]);assert.equal((await call(env,'/api/media/'+audioId,{user:alice})).status,404);assert.equal((await call(env,'/api/assets?kind=audio',{user:alice,method:'POST',bytes:'x',headers:{'content-length':'1'}})).status,403);
 track.published=true;assert.equal((await call(env,'/api/admin/tracks',{user:admin,method:'PUT',data:track})).status,200);const result=await(await call(env,'/api/catalog?q='+encodeURIComponent('СВЕТ'),{user:alice})).json();assert.equal(result.tracks.length,1);
 assert.equal((await call(env,'/api/library',{user:alice,method:'POST',data:{id:'song'}})).status,200);assert.equal((await call(env,'/api/library/song',{user:alice,method:'PATCH',data:{favorite:true}})).status,200);
 const playlist={id:'same-id',kind:'playlist',name:'Alice only',trackIds:['song']};assert.equal((await call(env,'/api/playlists',{user:alice,method:'PUT',data:playlist})).status,200);const bobState=await(await call(env,'/api/bootstrap',{user:bob})).json();assert.equal(bobState.tracks.length,0);assert.equal(bobState.collections.length,0);assert.equal((await call(env,'/api/library/song',{user:bob,method:'PATCH',data:{favorite:true}})).status,404);
 assert.equal((await call(env,'/api/playlists',{user:bob,method:'PUT',data:{id:'same-id',name:'Bob only',trackIds:[]}})).status,200);const aliceState=await(await call(env,'/api/bootstrap',{user:alice})).json();assert.equal(aliceState.tracks[0].favorite,true);assert.equal(aliceState.collections[0].name,'Alice only');
 const range=await call(env,'/api/media/'+audioId,{user:alice,headers:{range:'bytes=0-3'}});assert.equal(range.status,206);assert.equal(await range.text(),'test');assert.equal(range.headers.get('content-range'),'bytes 0-3/10');assert.equal((await call(env,'/api/media/'+audioId,{user:alice,headers:{range:'bytes=100-200'}})).status,416);
 const privateArt=await asset(env,alice,'playlist','image bytes','image/png');assert.equal((await call(env,'/api/media/'+privateArt,{user:bob})).status,404);
 track.published=false;await call(env,'/api/admin/tracks',{user:admin,method:'PUT',data:track});assert.equal((await call(env,'/api/media/'+audioId,{user:alice})).status,404);assert.equal((await(await call(env,'/api/bootstrap',{user:alice})).json()).tracks.length,0);
}finally{env.sqlite.close();}});
test('accounts: artist crop and avatar are separate and editor routes reject listeners on the server',async()=>{const env=await setup();try{
 const admin=await user(env,'admin',true),alice=await user(env,'alice'),banner=await asset(env,admin,'profile','banner','image/jpeg'),avatar=await asset(env,admin,'avatar','avatar','image/png');const collection={id:'artist:test',kind:'artist',name:'Test',mediaId:banner,avatarId:avatar,bannerX:12,bannerY:75,bannerScale:1.8};
 assert.equal((await call(env,'/api/admin/profiles',{user:alice,method:'PUT',data:{collection}})).status,403);assert.equal((await call(env,'/api/admin/profiles',{user:admin,method:'PUT',data:{collection}})).status,200);const state=await(await call(env,'/api/bootstrap',{user:alice})).json();assert.equal(state.collections[0].bannerY,75);assert.equal(state.collections[0].avatar,'/api/media/'+avatar);assert.equal(state.collections[0].media,'/api/media/'+banner);
 env.ASSETS={fetch:()=>new Response('editor')};for(const path of ['/editor.html','/editor','/assets/editor-abc.js'])assert.equal((await worker.fetch(new Request('https://audio.test'+path,{headers:{cookie:sessionCookie(alice.raw)}}),env)).status,403);
 assert.equal((await worker.fetch(new Request('https://audio.test/editor.html',{headers:{cookie:sessionCookie(admin.raw)}}),env)).status,200);
 assert.equal((await call(env,'/api/auth/google',{user:alice})).status,503);assert.equal((await call(env,'/api/auth/google/callback?code=x&state=bad',{user:alice})).status,302);
}finally{env.sqlite.close();}});

test('accounts: only trusted owner can create administrator password and preserves its stable identity',async()=>{const env=await setup();try{
 const data={email:env.ADMIN_EMAIL,password:'Owner-test-password',name:'Owner'};
 assert.equal((await call(env,'/api/auth/register',{method:'POST',data})).status,403);
 const headers={'oai-authenticated-user-id':'native-owner','oai-authenticated-user-email':env.ADMIN_EMAIL};
 const before=await(await call(env,'/api/session',{headers})).json();assert.equal(before.user.isAdmin,true);assert.equal((await env.DB.prepare('SELECT id FROM users WHERE admin=1 AND email=?').bind(env.ADMIN_EMAIL).first()).id,before.user.id);
 const response=await call(env,'/api/auth/register',{method:'POST',data,headers});assert.equal(response.status,201);
 const raw=response.headers.get('set-cookie').split(';')[0].split('=')[1],after=await(await call(env,'/api/session',{user:{raw}})).json();assert.equal(after.user.id,before.user.id);assert.equal(after.user.isAdmin,true);
 assert.equal((await call(env,'/api/auth/login',{method:'POST',data})).status,200);
}finally{env.sqlite.close();}});

test('accounts: upload survives proxy without content-length and rejects forged declared size',async()=>{const env=await setup();try{
 const admin=await user(env,'admin',true),options={user:admin,method:'POST',bytes:'12345',headers:{'content-type':'audio/mpeg','x-audio-size':'5'}};
 const response=await call(env,'/api/assets?kind=audio',options);assert.equal(response.status,201);const id=(await response.json()).id;assert.equal(await(await call(env,'/api/media/'+id,{user:admin})).text(),'12345');
 assert.equal((await call(env,'/api/assets?kind=audio',{...options,headers:{...options.headers,'x-audio-size':'1'}})).status,400);
 assert.equal((await call(env,'/api/assets?kind=audio',{...options,headers:{...options.headers,'x-audio-size':'9'}})).status,400);
}finally{env.sqlite.close();}});
test('accounts: multipart upload streams ordered parts, protects ownership and waits for every part',async()=>{const env=await setup();try{
 const admin=await user(env,'admin',true),alice=await user(env,'alice');const size=6*1024*1024+3;
 assert.equal((await call(env,'/api/uploads',{user:alice,method:'POST',data:{kind:'audio',mime:'audio/mpeg',size,filename:'long.flac'}})).status,403);
 const start=await call(env,'/api/uploads',{user:admin,method:'POST',data:{kind:'audio',mime:'audio/flac',size,filename:'long.flac'}});assert.equal(start.status,200);const {id,partSize}=await start.json();assert.equal(partSize,6*1024*1024);
 assert.equal((await call(env,'/api/uploads/'+id+'/parts/1',{user:alice,method:'PUT',bytes:'bad'})).status,404);
 assert.equal((await call(env,'/api/uploads/'+id+'/complete',{user:admin,method:'POST'})).status,400);
 assert.equal((await call(env,'/api/uploads/'+id+'/parts/2',{user:admin,method:'PUT',bytes:'bad size'})).status,400);
 const first=new Uint8Array(partSize);first.fill(42);assert.equal((await call(env,'/api/uploads/'+id+'/parts/1',{user:admin,method:'PUT',bytes:first})).status,200);
 assert.equal((await call(env,'/api/uploads/'+id+'/parts/2',{user:admin,method:'PUT',bytes:'end'})).status,200);const end=await call(env,'/api/uploads/'+id+'/complete',{user:admin,method:'POST'});assert.equal(end.status,200);
 const response=await call(env,'/api/media/'+id,{user:admin,headers:{range:'bytes=-3'}});assert.equal(response.status,206);assert.equal(await response.text(),'end');assert.equal(response.headers.get('content-range'),`bytes ${size-3}-${size-1}/${size}`);assert.equal((await call(env,'/api/media/'+id,{user:alice})).status,404);
}finally{env.sqlite.close();}});
