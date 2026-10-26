let connection;
export function openLibrary(){
  return connection??=new Promise((resolve,reject)=>{
    const request=indexedDB.open('audio-library',2);
    request.onupgradeneeded=()=>{for(const store of ['tracks','assets','collections'])if(!request.result.objectStoreNames.contains(store))request.result.createObjectStore(store,{keyPath:'id'});};
    request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();connection=undefined;};resolve(db);};
    request.onerror=()=>{connection=undefined;reject(request.error);};
  });
}
export async function allTracks(){const db=await openLibrary();return new Promise((resolve,reject)=>{const r=db.transaction('tracks').objectStore('tracks').getAll();r.onsuccess=()=>resolve(r.result.sort((a,b)=>a.added-b.added));r.onerror=()=>reject(r.error);});}
export async function trackAssets(id){const db=await openLibrary();return new Promise((resolve,reject)=>{const r=db.transaction('assets').objectStore('assets').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function saveTrack(track,assets){const db=await openLibrary();return new Promise((resolve,reject)=>{const tx=db.transaction(['tracks','assets'],'readwrite');tx.objectStore('tracks').put(track);if(assets)tx.objectStore('assets').put({...assets,id:track.id});tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('Не удалось сохранить песню.'));tx.onerror=()=>{};});}
export async function allCollections(){const db=await openLibrary();return new Promise((resolve,reject)=>{const r=db.transaction('collections').objectStore('collections').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function collectionById(id){const db=await openLibrary();return new Promise((resolve,reject)=>{const r=db.transaction('collections').objectStore('collections').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
// Group edits commit together, so an interrupted save cannot split an album.
export async function saveCollection(collection,tracks=[],related=[]){const db=await openLibrary();return new Promise((resolve,reject)=>{const tx=db.transaction(['collections','tracks'],'readwrite');for(const item of [collection,...related])tx.objectStore('collections').put(item);for(const track of tracks)tx.objectStore('tracks').put(track);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('Не удалось сохранить изменения.'));tx.onerror=()=>{};});}
