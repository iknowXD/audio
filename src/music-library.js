import {account,sessionReady} from './cloud-library.js';
import {thumbnail} from './artwork.js';
import {parseBlob} from 'music-metadata';
import {allTracks,trackAssets,saveTrack} from './library-db.mjs';
import {PlaybackQueue,isAudio,pairedFile} from './playback-queue.mjs';
import {parseLrc,decodeLyrics} from './lrc.mjs';
import {parseTtml} from './timed-lyrics.mjs';

const $=id=>document.getElementById(id);
function settings(){try{return JSON.parse(localStorage.getItem('audio-library-settings:'+(account.user?.id||'guest'))||'{}');}catch{return {};}}
async function validateLyrics(file){if(!file)return;if(file.size>5*1024*1024)throw new Error('Файл текста должен быть меньше 5 МБ.');const text=decodeLyrics(await file.arrayBuffer());const parsed=/\.(ttml|xml)$/i.test(file.name)?parseTtml(text):parseLrc(text);if(!parsed.lines.length)throw new Error('В файле текста нет временных меток.');}
export class MusicLibrary{
 constructor({onSelect,onUpdate,notify}){
  this.onSelect=onSelect;this.onUpdate=onUpdate;this.notify=(text,persistent)=>{$('library-message').textContent=$('library-dialog').open?text:'';notify(text,persistent);};this.queue=new PlaybackQueue();this.tracks=[];this.urls=[];this.chain=Promise.resolve();
  const saved=settings();this.queue.shuffle=!!saved.shuffle;this.queue.repeat=['off','all','one'].includes(saved.repeat)?saved.repeat:'off';
  $('library-toggle').onclick=()=>this.open();$('library-close').onclick=()=>$('library-dialog').close();
  $('library-dialog').onclick=e=>{if(e.target===$('library-dialog')&&e.offsetX>=$('library-dialog').clientWidth)$('library-dialog').close();};
  $('library-add').onclick=()=>$('file-input').click();
  $('song-edit-cancel').onclick=()=>$('song-edit').close();$('song-edit-form').onsubmit=e=>{e.preventDefault();void this.saveEdit();};
  $('previous').onclick=()=>this.move(-1);$('next').onclick=()=>this.move(1);
  $('shuffle').onclick=()=>{this.queue.toggleShuffle();this.saveSettings();this.controls();};
  $('repeat').onclick=()=>{this.queue.repeat={off:'all',all:'one',one:'off'}[this.queue.repeat];this.saveSettings();this.controls();};
  this.controls();
 }
 async init(){
  try{await sessionReady;const saved=settings();this.queue.shuffle=!!saved.shuffle;this.queue.repeat=['off','all','one'].includes(saved.repeat)?saved.repeat:'off';this.tracks=await allTracks();this.queue.setTracks(this.tracks.map(t=>t.id));this.render();void this.migrateTags();const last=settings().current;if(this.tracks.some(t=>t.id===last))await this.activate(last,false);}
  catch(error){this.notify('Библиотека недоступна: '+error.message,true);}
 }
 saveSettings(){try{localStorage.setItem('audio-library-settings:'+(account.user?.id||'guest'),JSON.stringify({current:this.queue.current,shuffle:this.queue.shuffle,repeat:this.queue.repeat}));}catch{}}
 open(){$('library-dialog').showModal();}
 controls(){
  $('repeat').disabled=!this.tracks.length;$('previous').disabled=$('next').disabled=this.tracks.length<2;$('shuffle').disabled=this.tracks.length<2;
  $('shuffle').setAttribute('aria-pressed',String(this.queue.shuffle));$('repeat').setAttribute('aria-pressed',String(this.queue.repeat!=='off'));
  $('repeat').setAttribute('aria-label',`Повтор: ${{off:'выключен',all:'вся библиотека',one:'одна песня'}[this.queue.repeat]}`);
  $('repeat-one').hidden=this.queue.repeat!=='one';document.dispatchEvent(new Event('queuechange'));
 }
 render(){
  for(const url of this.urls)URL.revokeObjectURL(url);this.urls=[];
  const list=$('library-list');list.replaceChildren();$('library-count').textContent=String(this.tracks.length);$('library-empty').hidden=!!this.tracks.length;
  for(const track of document.body.classList.contains('service-mode')?[]:this.tracks){
   const row=document.createElement('div');row.className='library-row';row.dataset.id=track.id;
   const play=document.createElement('button');play.className='library-song';play.setAttribute('aria-label',`Слушать ${track.title}`);play.setAttribute('aria-pressed',String(track.id===this.queue.current));
   const art=document.createElement('span');art.className='library-art';
   if(track.thumbnail){const img=document.createElement('img');const url=URL.createObjectURL(track.thumbnail);this.urls.push(url);img.src=url;img.alt='';art.append(img);}else art.textContent='♫';
   const info=document.createElement('span');info.className='library-info';const title=document.createElement('strong');title.textContent=track.title;const artist=document.createElement('span');artist.textContent=track.artist||'Неизвестный исполнитель';const status=document.createElement('small');status.textContent=track.lyricsName?'Текст привязан':'Без текста';info.append(title,artist,status);play.append(art,info);play.onclick=()=>void this.activate(track.id,true);
   const menu=document.createElement('button');menu.className='song-menu';menu.textContent='•••';menu.setAttribute('aria-label',`Настройки песни ${track.title}`);menu.onclick=()=>this.edit(track.id);
   row.append(play,menu);list.append(row);
  }
  this.controls();document.dispatchEvent(new Event('librarychange'));
 }
 setPlaying(playing){for(const row of $('library-list').children)row.classList.toggle('is-playing',playing&&row.dataset.id===this.queue.current);}
 activate(id,autoplay=true,context){
  this.chain=this.chain.then(async()=>{if(context){this.queue.shuffle=context.shuffle;this.queue.current=null;this.queue.setTracks(context.ids);}if(typeof id==='function')id=id();id??=context?this.queue.order[0]:null;const track=this.tracks.find(t=>t.id===id);if(!track)return;const assets=await trackAssets(id);if(!assets?.audio)throw new Error('Аудиофайл не найден в библиотеке.');if(!this.queue.ids.includes(id))this.queue.setTracks(this.tracks.map(t=>t.id));this.queue.select(id);this.saveSettings();this.controls();for(const row of $('library-list').children)row.querySelector('.library-song').setAttribute('aria-pressed',String(row.dataset.id===id));document.dispatchEvent(new CustomEvent('trackchange',{detail:track}));await this.onSelect(track,assets,{autoplay});if(autoplay)void this.patchTrack(id,{playCount:(track.playCount||0)+1,lastPlayed:Date.now()}).catch(error=>this.notify(error.message,true));if(autoplay&&matchMedia('(max-width:800px)').matches)$('library-dialog').close();}).catch(error=>this.notify(error.message||'Не удалось включить песню.',true));return this.chain;
 }
 move(direction=1,automatic=false){return this.activate(()=>this.queue.step(direction,automatic),true);}
 async importFiles(files){
  if(!account.user?.isAdmin)throw new Error('Только администратор может добавлять песни на сайт.');
  const definiteAudio=files.some(f=>f.type.startsWith('audio/')||/\.(mp3|flac|m4a|wav|alac|aac|ogg)$/i.test(f.name));
  const covers=files.filter(f=>f.type.startsWith('image/')||(definiteAudio&&f.type.startsWith('video/'))||/\.(png|jpe?g|gif|webp|avif)$/i.test(f.name)),tracks=files.filter(f=>isAudio(f)&&!covers.includes(f)),texts=files.filter(f=>/\.(lrc|ttml|xml)$/i.test(f.name));
  if(!tracks.length&&!texts.length&&!covers.length)throw new Error('Добавь аудио, LRC / TTML или обложку.');
  if(!tracks.length){
   if(!this.queue.current)throw new Error('Сначала добавь песню вместе с её текстом.');
   const existing=this.tracks.find(t=>t.id===this.queue.current),track={...existing},assets=await trackAssets(track.id);
   if(texts[0]){await validateLyrics(texts[0]);assets.lyrics=texts[0];track.lyricsName=texts[0].name;}
   if(covers[0]){assets.cover=covers[0];track.coverCustom=true;track.thumbnail=await thumbnail(covers[0]);}
   await saveTrack(track,assets);this.tracks[this.tracks.indexOf(existing)]=track;this.render();await this.refreshCurrent(track,assets,{lyrics:!!texts[0],cover:!!covers[0]});return;
  }
  let first,unmatched=0;
  for(const [index,file] of tracks.entries()){
   const lyrics=pairedFile(file,texts,tracks.length),chosenCover=pairedFile(file,covers,tracks.length);await validateLyrics(lyrics);
   let common={},duration;try{const parsed=await parseBlob(file,{duration:true,skipPostHeaders:true});common=parsed.common;duration=parsed.format.duration;}catch{}
   const pic=common.picture?.find(p=>/front/i.test(p.type||''))??common.picture?.[0];const cover=chosenCover??(pic?new Blob([pic.data],{type:pic.format}):null);
   const track={id:crypto.randomUUID(),filename:file.name,title:common.title||file.name.replace(/\.[^.]+$/,''),artist:common.artist||'',album:common.album||'',albumArtist:common.albumartist||'',year:common.year||'',genre:common.genre?.[0]||'',trackNo:common.track?.no||0,discNo:common.disk?.no||1,duration,metadataVersion:2,added:Date.now()+index,lyricsName:lyrics?.name||'',thumbnail:await thumbnail(cover),coverCustom:!!chosenCover};
   await saveTrack(track,{audio:file,lyrics:lyrics||null,cover});this.tracks.push(track);first??=track.id;if(!lyrics&&texts.length)unmatched++;
   this.queue.setTracks(this.tracks.map(t=>t.id));this.render();
  }
  // Best effort: browsers decide whether to grant durable storage.
  navigator.storage?.persist?.().catch(()=>{});
  await this.activate(first,true);
  this.notify(unmatched?'Песни сохранены. Для файлов без пары добавь текст через •••.':`Сохранено песен: ${tracks.length}`);
 }
 patchTrack(id,patch){this.writes=(this.writes||Promise.resolve()).catch(()=>{}).then(async()=>{const index=this.tracks.findIndex(t=>t.id===id);if(index<0)return;const track={...this.tracks[index],...patch};await saveTrack(track);this.tracks[index]=track;this.render();return track;});return this.writes;}
 playTracks(ids,{shuffle=false,start}={}){if(!ids.length)return;return this.activate(start,true,{ids,shuffle});}
 async migrateTags(){
  for(const old of [...this.tracks])if(old.metadataVersion!==2){try{const assets=await trackAssets(old.id);if(!assets?.audio)continue;const {common,format}=await parseBlob(assets.audio,{duration:true,skipPostHeaders:true});const index=this.tracks.findIndex(t=>t.id===old.id),current=this.tracks[index];if(current.metadataVersion===2)continue;const track={...current,album:current.album||common.album||'',albumArtist:current.albumArtist||common.albumartist||'',year:current.year||common.year||'',genre:current.genre||common.genre?.[0]||'',trackNo:current.trackNo||common.track?.no||0,discNo:current.discNo||common.disk?.no||1,duration:format.duration,metadataVersion:2};await saveTrack(track);this.tracks[index]=track;this.render();}catch{}}
 }
 async refreshCurrent(track,assets,changes){this.chain=this.chain.then(async()=>{if(this.queue.current===track.id)await this.onUpdate(track,assets,changes);}).catch(error=>this.notify(error.message,true));return this.chain;}
 async edit(id){
  if(!account.user?.isAdmin)return;
  const track=this.tracks.find(t=>t.id===id);if(!track)return;this.editing=id;$('song-published').checked=!!track.published;for(const [field,key] of Object.entries({album:'album','album-artist':'albumArtist',year:'year',genre:'genre',number:'trackNo'}))$('song-'+field).value=track[key]||'';$('song-edit-error').hidden=true;$('song-title').value=track.title;$('song-artist').value=track.artist;$('song-cover').value='';$('song-lyrics').value='';$('song-lyrics-name').textContent=track.lyricsName||'Текст пока не добавлен';$('song-edit').showModal();
 }
 async saveEdit(){
  const button=$('song-save');button.disabled=true;
  try{
   const existing=this.tracks.find(t=>t.id===this.editing);if(!existing)return;
   const track={...existing,title:$('song-title').value.trim()||existing.title,artist:$('song-artist').value.trim(),published:$('song-published').checked};for(const [field,key] of Object.entries({album:'album','album-artist':'albumArtist',year:'year',genre:'genre',number:'trackNo'}))track[key]=field==='number'?Number($('song-'+field).value)||0:$('song-'+field).value.trim();track.metadataVersion=2;const assets=await trackAssets(track.id);
   const lyrics=$('song-lyrics').files[0],cover=$('song-cover').files[0];
   if(lyrics){await validateLyrics(lyrics);assets.lyrics=lyrics;track.lyricsName=lyrics.name;}
   if(cover){track.coverCustom=true;track.thumbnail=await thumbnail(cover);assets.cover=cover;}
   await saveTrack(track,assets);this.tracks[this.tracks.indexOf(existing)]=track;this.render();await this.refreshCurrent(track,assets,{lyrics:!!lyrics,cover:!!cover});$('song-edit').close();document.dispatchEvent(new CustomEvent('trackchange',{detail:this.tracks.find(t=>t.id===this.queue.current)}));this.notify('Изменения сохранены');
  }catch(error){const message=error.name==='QuotaExceededError'?'В браузере не хватает места для сохранения файлов.':error.message;$('song-edit-error').textContent=message;$('song-edit-error').hidden=false;this.notify(message,true);}finally{button.disabled=false;}
 }
}
