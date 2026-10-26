import {requireAdmin,fail} from './auth.mjs';
export const PART_SIZE=6*1024*1024;
const json=value=>Response.json(value,{headers:{'Cache-Control':'no-store'}});
async function bytesOf(request,size){
 const data=new Uint8Array(size),reader=request.body?.getReader();if(!reader)fail('Файл пустой.');let offset=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;if(offset+value.byteLength>size){await reader.cancel();fail('Неверный размер части файла.');}data.set(value,offset);offset+=value.byteLength;}}finally{reader.releaseLock();}
 if(offset!==size)fail('Часть файла передана не полностью.');return data;
}
export async function uploadRoute(request,env,user){
 const path=new URL(request.url).pathname,method=request.method;
 if(path==='/api/uploads'&&method==='POST'){
  const value=await request.json(),kind=String(value.kind),mime=String(value.mime||'application/octet-stream').split(';')[0],filename=String(value.filename||kind).slice(0,200),size=Number(value.size);
  if(!['audio','lyrics','cover','thumbnail','profile','avatar','playlist'].includes(kind))fail('Неверный вид файла.');if(kind!=='playlist')requireAdmin(user);
  const maximum=kind==='audio'?2*1024**3:kind==='lyrics'?5*1024**2:256*1024**2;
  if(!Number.isSafeInteger(size)||size<=0||size>maximum)fail(kind==='audio'?'Аудио должно быть меньше 2 ГБ.':'Выбранный файл слишком большой.',413);
  if(kind==='avatar'&&!mime.startsWith('image/'))fail('Для аватара выбери изображение.');if(!['audio','lyrics'].includes(kind)&&!/^image\/(jpeg|png|webp|gif|avif)$|^video\/(mp4|webm|quicktime)$/.test(mime))fail('Выбери фото, GIF, MP4 или WebM.');
  const id=crypto.randomUUID(),key='media/'+id,multipart=await env.BUCKET.createMultipartUpload(key,{httpMetadata:{contentType:mime}});
  const data={kind,mime,filename,size,key,uploadId:multipart.uploadId,parts:[]};await env.DB.prepare('INSERT INTO uploads(id,owner_id,data,expires) VALUES(?,?,?,?)').bind(id,user.id,JSON.stringify(data),Date.now()+86400000).run();return json({id,partSize:PART_SIZE});
 }
 const match=/^\/api\/uploads\/([^/]+)\/(?:parts\/(\d+)|(complete))$/.exec(path);if(!match)return null;
 const row=await env.DB.prepare('SELECT * FROM uploads WHERE id=? AND owner_id=? AND expires>?').bind(match[1],user.id,Date.now()).first();if(!row)fail('Загрузка истекла. Выбери файл заново.',404);
 const data=JSON.parse(row.data),upload=env.BUCKET.resumeMultipartUpload(data.key,data.uploadId),count=Math.ceil(data.size/PART_SIZE);
 if(match[2]&&method==='PUT'){
  const number=Number(match[2]);if(number<1||number>count)fail('Неверная часть файла.');
  const size=Math.min(PART_SIZE,data.size-(number-1)*PART_SIZE),bytes=await bytesOf(request,size),part=await upload.uploadPart(number,bytes);
  data.parts=data.parts.filter(p=>p.partNumber!==number);data.parts.push({partNumber:part.partNumber,etag:part.etag});await env.DB.prepare('UPDATE uploads SET data=? WHERE id=? AND owner_id=?').bind(JSON.stringify(data),row.id,user.id).run();return json({ok:true});
 }
 if(match[3]&&method==='POST'){
  const parts=data.parts.sort((a,b)=>a.partNumber-b.partNumber);if(parts.length!==count||parts.some((part,index)=>part.partNumber!==index+1))fail('Не все части файла загружены. Повтори загрузку.');await upload.complete(parts);
  await env.DB.batch([env.DB.prepare('INSERT INTO media(id,owner_id,kind,mime,filename,size,storage_key,created) VALUES(?,?,?,?,?,?,?,?)').bind(row.id,user.id,data.kind,data.mime,data.filename,data.size,data.key,Date.now()),env.DB.prepare('DELETE FROM uploads WHERE id=? AND owner_id=?').bind(row.id,user.id)]);return json({id:row.id,url:'/api/media/'+row.id});
 }
 fail('Страница не найдена.',404);
}
