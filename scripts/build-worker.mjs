import {mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {build} from 'esbuild';
for(const item of await readdir('dist'))if(item!=='client')await rm('dist/'+item,{recursive:true,force:true});
await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});
const editorHtml=await readFile('dist/client/editor.html','utf8'),editorPath=editorHtml.match(/src="(\/assets\/editor-[^"]+\.js)"/)[1],editorJs=await readFile('dist/client'+editorPath,'utf8');
await build({entryPoints:['server/worker.mjs'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',define:{__EDITOR_HTML__:JSON.stringify(editorHtml),__EDITOR_JS__:JSON.stringify(editorJs)}});
// Protected editor resources must bypass the host static-asset cache.
await rm('dist/client/editor.html');await rm('dist/client'+editorPath);
const hosting=JSON.parse(await readFile('.openai/hosting.json','utf8'));await writeFile('dist/.openai/hosting.json',JSON.stringify(hosting));
await writeFile('dist/server/wrangler.json',JSON.stringify({name:'audio-service',main:'index.js',compatibility_date:'2026-10-24',compatibility_flags:['nodejs_compat'],assets:{directory:'../client',binding:'ASSETS',run_worker_first:true,html_handling:'auto-trailing-slash',not_found_handling:'none'},d1_databases:[{binding:'DB',database_name:'audio-library',database_id:'00000000-0000-4000-8000-000000000000'}],r2_buckets:[{binding:'BUCKET',bucket_name:'audio-media'}]}));
