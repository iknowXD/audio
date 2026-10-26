export const isVideo=blob=>blob?.type?.startsWith('video/');
export async function mediaSource(blob){
 const url=URL.createObjectURL(blob),node=isVideo(blob)?document.createElement('video'):new Image();
 try{
  if(isVideo(blob)){node.muted=true;node.playsInline=true;node.preload='auto';await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Видео не поддерживается браузером. Попробуй MP4 (H.264) или WebM.')),12000);node.onloadeddata=()=>{clearTimeout(timeout);resolve();};node.onerror=()=>{clearTimeout(timeout);reject(new Error('Не удалось открыть видеообложку.'));};node.src=url;});}
  else{node.src=url;await node.decode();}
  return {node,url,release(){if(isVideo(blob)){node.pause();node.removeAttribute('src');node.load();}URL.revokeObjectURL(url);}};
 }catch(error){if(isVideo(blob)){node.removeAttribute('src');node.load();}URL.revokeObjectURL(url);throw isVideo(blob)?error:new Error('Не удалось открыть изображение. Попробуй JPG, PNG, WebP или GIF.');}
}
export async function thumbnail(blob,size=240){
 if(!blob)return null;const source=await mediaSource(blob);
 try{const {node}=source,w=node.videoWidth||node.naturalWidth,h=node.videoHeight||node.naturalHeight,side=Math.min(w,h);const canvas=document.createElement('canvas');canvas.width=canvas.height=Math.min(size,side);canvas.getContext('2d').drawImage(node,(w-side)/2,(h-side)/2,side,side,0,0,canvas.width,canvas.height);return await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.85));}finally{source.release();}
}
