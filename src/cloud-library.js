export const account={user:null,csrf:null,googleReady:false,githubReady:false};
let cache={tracks:[],collections:[]};const knownBlobs=new WeakMap();
export async function request(path,{method='GET',body,headers={}}={}){
 const response=await fetch(path,{method,credentials:'same-origin',headers:{...(body&&!(body instanceof Blob)?{'Content-Type':'application/json'}:{}),...(account.csrf?{'x-audio-csrf':account.csrf}:{}),...headers},body:body instanceof Blob?body:body?JSON.stringify(body):undefined});
 if(!response.ok){let message='Не удалось связаться с сервером.';try{message=(await response.json()).error||message;}catch{}throw Object.assign(new Error(message),{status:response.status});}return response.status===204?null:response.json();
}
export async function refreshAccount(){try{Object.assign(account,await request('/api/session'));}catch(error){account.error=error.message;}document.body.classList.toggle('is-admin',!!account.user?.isAdmin);return account;}
export const sessionReady=refreshAccount();
export async function refreshLibrary(){await sessionReady;if(!account.user){cache={tracks:[],collections:[]};return cache;}cache=await request('/api/bootstrap');return cache;}
let ready;export const libraryReady=()=>ready??=refreshLibrary();
export async function allTracks(){await libraryReady();return cache.tracks.map(track=>({...track}));}
export async function allCollections(){await libraryReady();return cache.collections.map(collection=>({...collection}));}
export async function collectionById(id){await libraryReady();return cache.collections.find(c=>c.id===id);}
export async function mediaBlob(value){if(!value||value instanceof Blob)return value;const response=await fetch(value,{credentials:'same-origin'});if(!response.ok)throw new Error('Не удалось загрузить файл.');const blob=await response.blob(),id=String(value).split('/').at(-1);knownBlobs.set(blob,id);return blob;}
async function upload(value,kind){
 if(!value)return null;if(typeof value==='string')return value.split('/').at(-1);if(knownBlobs.has(value))return knownBlobs.get(value);
 if(!value.size){if(kind==='audio')throw new Error('Аудиофайл пустой.');return null;}
 const mime=value.type||'application/octet-stream',filename=value.name||kind;let result;
 if(value.size>8*1024*1024){
  const started=await request('/api/uploads',{method:'POST',body:{kind,mime,filename,size:value.size}});
  for(let offset=0,number=1;offset<value.size;offset+=started.partSize,number++){
   const part=value.slice(offset,offset+started.partSize);for(let attempt=0;;attempt++){try{await request('/api/uploads/'+started.id+'/parts/'+number,{method:'PUT',body:part,headers:{'Content-Type':'application/octet-stream'}});break;}catch(error){if(attempt>=2||error.status&&error.status<500)throw error;}}
  }
  result=await request('/api/uploads/'+started.id+'/complete',{method:'POST'});
 }else result=await request('/api/assets?kind='+kind,{method:'POST',body:value,headers:{'Content-Type':mime,'x-audio-filename':encodeURIComponent(filename),'x-audio-size':String(value.size)}});
 knownBlobs.set(value,result.id);return result.id;
}
export async function trackAssets(id){await libraryReady();const track=cache.tracks.find(t=>t.id===id);if(!track)return null;const [cover,lyrics]=await Promise.all([mediaBlob(track.coverId?'/api/media/'+track.coverId:null),mediaBlob(track.lyricsId?'/api/media/'+track.lyricsId:null)]);return {id,audio:'/api/media/'+track.audioId,cover,lyrics};}
export async function saveTrack(track,assets){
 await libraryReady();if(assets){if(!account.user?.isAdmin)throw new Error('Только администратор может загружать и менять песни.');const value={...track,audioId:await upload(assets.audio,'audio'),coverId:await upload(assets.cover,'cover'),lyricsId:await upload(assets.lyrics,'lyrics'),thumbnailId:await upload(track.thumbnail,'thumbnail')};const saved=await request('/api/admin/tracks',{method:'PUT',body:value});Object.assign(track,saved);}
 else {const previous=cache.tracks.find(t=>t.id===track.id),patch={};for(const key of ['favorite','playCount','lastPlayed'])if(track[key]!==previous?.[key])patch[key]=track[key];if(Object.keys(patch).length)await request('/api/library/'+encodeURIComponent(track.id),{method:'PATCH',body:patch});}
 const index=cache.tracks.findIndex(t=>t.id===track.id);if(index<0)cache.tracks.push({...track});else cache.tracks[index]={...track};
}
export async function saveCollection(collection,tracks=[],related=[]){
 await libraryReady();const isPlaylist=collection.kind==='playlist',kind=isPlaylist?'playlist':'profile';const record={...collection,mediaId:await upload(collection.media,kind),thumbnailId:await upload(collection.kind==='artist'?null:collection.thumbnail,kind),avatarId:collection.kind==='artist'?await upload(collection.avatar,'avatar'):null};
 const saved=await request(isPlaylist?'/api/playlists':'/api/admin/profiles',{method:'PUT',body:isPlaylist?record:{collection:record,tracks,related}});Object.assign(collection,saved);const index=cache.collections.findIndex(c=>c.id===collection.id);if(index<0)cache.collections.push({...collection});else cache.collections[index]={...collection};for(const track of tracks){const index=cache.tracks.findIndex(t=>t.id===track.id);if(index>=0)cache.tracks[index]={...cache.tracks[index],...track};}
}
export async function addToLibrary(id){await request('/api/library',{method:'POST',body:{id}});await refreshLibrary();return cache.tracks.map(track=>({...track}));}
export const searchCatalog=(query,offset=0)=>request('/api/catalog?q='+encodeURIComponent(query)+'&offset='+offset);
export async function publishTrack(track){const assets=await trackAssets(track.id);await saveTrack({...track,published:!track.published},assets);await refreshLibrary();return cache.tracks.map(track=>({...track}));}
