import {handleApi} from './api.mjs';
import {identity} from './auth.mjs';
export default {async fetch(request,env){
 const path=new URL(request.url).pathname;
 if(path.startsWith('/api/'))return handleApi(request,env);
 if(/^\/editor(?:\.html)?\/?$/.test(path)||/^\/assets\/editor-[^/]+\.js$/.test(path)){
  const user=await identity(request,env);if(!user?.admin)return new Response('Редактор субтитров доступен только администратору.',{status:403,headers:{'Content-Type':'text/plain;charset=utf-8','Cache-Control':'no-store'}});
  const script=path.startsWith('/assets/');if(!script&&typeof __EDITOR_HTML__!=='undefined')return new Response(__EDITOR_HTML__,{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'private, no-store'}});if(script&&typeof __EDITOR_JS__!=='undefined')return new Response(__EDITOR_JS__,{headers:{'Content-Type':'application/javascript;charset=utf-8','Cache-Control':'private, no-store'}});
 }
 return env.ASSETS.fetch(request);
}};
