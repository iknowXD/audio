import {DatabaseSync} from 'node:sqlite';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function localEnv(root='.local-data',memory=false){
 await mkdir(root,{recursive:true});const sqlite=new DatabaseSync(memory?':memory:':join(root,'library.sqlite'));
 const DB={prepare(sql){let args=[];const query={bind(...values){args=values;return query;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){sqlite.prepare(sql).run(...args);return {success:true};}};return query;},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const BUCKET={async put(key,body){await mkdir(join(root,'media'),{recursive:true});const data=await new Response(body).arrayBuffer();await writeFile(join(root,key.replaceAll('/','_')),new Uint8Array(data));},async get(key,options){try{let bytes=await readFile(join(root,key.replaceAll('/','_')));if(options?.range)bytes=bytes.subarray(options.range.offset,options.range.offset+options.range.length);return {body:bytes};}catch{return null;}}};
 const multipart=(key,uploadId)=>({key,uploadId,async uploadPart(partNumber,bytes){await writeFile(join(root,'part_'+uploadId+'_'+partNumber),new Uint8Array(bytes));return {partNumber,etag:'local-'+partNumber};},async complete(parts){const bytes=await Promise.all(parts.map(part=>readFile(join(root,'part_'+uploadId+'_'+part.partNumber))));await BUCKET.put(key,Buffer.concat(bytes));return {key};}});
 BUCKET.createMultipartUpload=async key=>multipart(key,crypto.randomUUID());BUCKET.resumeMultipartUpload=multipart;
 return {DB,BUCKET,sqlite,ADMIN_EMAIL:'owner@audio.test'};
}
