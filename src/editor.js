import {sessionReady,account} from './cloud-library.js';
await sessionReady;
if(!account.user?.isAdmin){location.replace('/');throw new Error('Редактор доступен только администратору.');}
import {createTimeline} from './lyric-timeline.mjs';
import {draftLines,markLine,finishLine,materializeLines} from './line-draft.mjs';
import './editor.css';
import { parseLrc, decodeLyrics } from './lrc.mjs';
import { projectFromLrc, tokenize, validateProject, exportTtml, parseTtml, clamp } from './timed-lyrics.mjs';
import { appendWords, paintWords } from './lyric-render.js';
import { formatTime, parseTime, lineRange, retimeLine, exportLrc, PlaybackClock, playbackStart, activePlaybackLine } from './timing.mjs';
import './lyric-motion.css';

const $ = id => document.getElementById(id), audio = $('editor-audio');
const STORAGE = 'audio-ttml-editor-v1';
let project = {version:1,title:'',artist:'',language:'ru',audioName:'',duration:null,lines:[]};
let lineIndex = 0, wordIndex = 0, cursor = 0, recording = false, holding = false, preview = false;
let audioFile, audioURL, loading = false, fallbackUsed = false, history = [], future = [], importQueue = Promise.resolve();
let toastTimer, lastPreviewLine = -1, resumePosition = 0;
const snapshot = () => JSON.stringify({project,lineIndex,wordIndex,cursor});
const line = () => project.lines[lineIndex];
const word = () => line()?.words[wordIndex];
const precise = formatTime;
const stamp = t => formatTime(t).slice(0,-4);
const previewClock=new PlaybackClock();
let previewTimeline=createTimeline([]),previewIndices=[];
function tell(text, persistent=false) { clearTimeout(toastTimer); $('editor-toast').textContent=text; $('editor-toast').hidden=false; if (!persistent) toastTimer=setTimeout(()=>$('editor-toast').hidden=true,5500); }
function confirmAction(text) {
  return new Promise(resolve => {
    const dialog=$('confirm-dialog'); $('dialog-text').textContent=text;
    const finish = value => { dialog.close(); $('dialog-ok').onclick=null; $('dialog-cancel').onclick=null; dialog.oncancel=null; resolve(value); };
    $('dialog-ok').onclick=()=>finish(true); $('dialog-cancel').onclick=()=>finish(false); dialog.oncancel=event=>{event.preventDefault();finish(false);}; dialog.showModal();
  });
}
function persist() {
  if(audioFile)resumePosition=audio.currentTime;
  try { localStorage.setItem(STORAGE, JSON.stringify({project,lineIndex,wordIndex,cursor,position:resumePosition,speed:$('speed').value,mode:$('record-mode').value})); $('save-status').textContent='✓ Сохранено в этом браузере'; }
  catch { $('save-status').textContent='Автосохранение недоступно — скачай JSON'; }
}
function changed() { persist(); render(); }
function commit(fn) { history.push(snapshot()); if(history.length>200)history.shift(); future=[];fn();changed(); }
function restoreSnapshot(text) { const value=JSON.parse(text);project=value.project;lineIndex=value.lineIndex;wordIndex=value.wordIndex;cursor=value.cursor;changed(); }
function undo() { if(!history.length)return;if(recording)stop();future.push(snapshot());restoreSnapshot(history.pop()); }
function redo() { if(!future.length)return;if(recording)stop();history.push(snapshot());restoreSnapshot(future.pop()); }
function stop(pause=true) {
  if(holding) markUp();
  recording=false;holding=false;if(pause)audio.pause();persist();render();
}
function selectLine(index) { stop();lineIndex=index;wordIndex=0;cursor=0;lastPreviewLine=-1;if(audioFile)audio.currentTime=Math.max(0,project.lines[index].time-1);persist();render(); }
function download(name, content, type) { const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000); }
function safeName() { return (project.title || audioFile?.name.replace(/\.[^.]+$/,'') || 'lyrics').replace(/[\\/:*?"<>|]/g,'_'); }
function renderList() {
  const fragment=document.createDocumentFragment();
  project.lines.forEach((item,i)=>{
    const button=document.createElement('button');button.className='line-choice';button.classList.toggle('selected',i===lineIndex);
    const count=item.words.filter(w=>Number.isFinite(w.time)&&Number.isFinite(w.end)&&!w.estimated).length;
    button.classList.toggle('complete',count===item.words.length);button.setAttribute('aria-label',`Строка ${i+1}: ${item.text}`);button.setAttribute('aria-current',String(i===lineIndex));
    const time=document.createElement('span');time.className='line-time';time.textContent=precise(playbackStart(item));time.title=`Начало пения: ${precise(playbackStart(item))}. Метка строки: ${precise(item.time)}`;
    const title=document.createElement('span');title.className='line-name';title.textContent=item.text;
    const status=document.createElement('span');status.className='line-status';status.textContent=`${count} / ${item.words.length} слов${count===item.words.length?' ✓':''}`;
    button.append(time,title,status);button.onclick=()=>selectLine(i);fragment.append(button);
  });
  $('line-list').replaceChildren(fragment);$('line-count').textContent=project.lines.length;
}
function renderStage() {
  const current=line();$('record-stage').classList.toggle('recording',recording);$('record-stage').classList.toggle('preview-stage',preview);
  $('stage-words').replaceChildren();
  $('stage-label').textContent=preview?'ПРОСМОТР СИНХРОНИЗАЦИИ':recording?'● ИДЁТ РАЗМЕТКА':`СТРОКА ${lineIndex+1} ИЗ ${project.lines.length}`;
  $('word-count').textContent=current?`${current.words.filter(w=>w.time!==null).length} / ${current.words.length} слов`:'';
  if(current) {
    if(preview) {for(const i of previewIndices){const row=document.createElement('div');row.className='preview-lyric-row';row.dataset.index=i;if(project.lines[i].words.some(w=>Number.isFinite(w.time)))appendWords(row,project.lines[i].words);else row.textContent=project.lines[i].text;$('stage-words').append(row);}}
    else current.words.forEach((w,i)=>{
      const button=document.createElement('button');button.className='editor-word';button.textContent=w.text.trim();button.setAttribute('aria-label',`Слово ${i+1}: ${w.text.trim()}`);
      button.classList.toggle('selected',!recording&&i===wordIndex);button.classList.toggle('next-word',recording&&i===cursor&&!holding);button.classList.toggle('held',recording&&i===cursor&&holding);button.classList.toggle('finished',Number.isFinite(w.time));
      button.onclick=()=>{if(recording)return;wordIndex=i;cursor=i;persist();render();};$('stage-words').append(button);
    });
  }
  const mode=$('record-mode').value;
  $('record-hint').textContent=preview?'Слушай и проверяй. Время слов можно исправить в «Разметке».':recording?(audio.paused?'Пауза. Нажми P или пуск, чтобы продолжить запись.':cursor>=current.words.length?'Нажми пробел ещё раз на конце последнего слова.':mode==='hold'?'Зажми пробел на слове и отпусти, когда оно закончится.':`Следующее: «${current.words[cursor].text.trim()}». Пробел — начало слова.`):audioFile?'Нажми «Разметить строку». Музыка начнётся за секунду до неё.':'Добавь аудиофайл, чтобы начать. Если проект восстановлен — выбери ту же песню.';
  $('start-record').hidden=preview||recording;$('mark-word').hidden=preview||!recording;$('stop-record').hidden=preview||!recording;
  $('mark-word').textContent=cursor>=(current?.words.length||0)?'Пробел · Конец строки':mode==='hold'?'Удерживай · Слово звучит':'Пробел · Следующее слово';
  $('start-record').disabled=!audioFile||!current||loading;
}
function renderInspector() {
  const current=line(),w=word();
  const range=current?lineRange(project,lineIndex):{};
  $('line-start').value=precise(range.start);$('line-end').value=precise(range.end);$('line-speed').value='1';
  $('line-playback-start').textContent=current?`Начало пения: ${precise(playbackStart(current))}. Метка строки может быть раньше.`:'';
  $('line-duration').textContent=current?`Длительность: ${(range.end-range.start).toFixed(3)} с`:'';
  $('apply-line-timing').disabled=!current||recording;$('apply-line-speed').disabled=!current||recording;
  $('selected-word-label').textContent=w?`Слово ${wordIndex+1}: ${w.text.trim()}`:'Выбери слово для правки';
  $('word-start').value=precise(w?.time);$('word-end').value=precise(w?.end);
  $('word-state').textContent=w?.estimated?'Конец приблизительный':w?.time==null?'Ещё не размечено':'Можно поправить';
  $('line-text').value=current?.text||'';
  $('text-variant').replaceChildren();
  (current?.alternatives||[]).forEach(text=>{const option=document.createElement('option');option.textContent=text;option.value=text;$('text-variant').append(option);});
  $('variant-label').hidden=(current?.alternatives?.length||0)<2;
  $('apply-timing').disabled=!w||recording;$('record-from-word').disabled=!w||!audioFile||recording;
  $('confirm-line').disabled=!current||recording;
}
function render() {
  previewTimeline=createTimeline(project.lines,project.duration??Infinity);
  const hasData=project.lines.length>0||!!audioFile;
  $('editor-intro').hidden=hasData;$('editor-workspace').hidden=!hasData;
  $('editor-song').textContent=project.title||audioFile?.name.replace(/\.[^.]+$/,'')||'Добавь аудио для разметки';
  $('editor-file').textContent=audioFile?.name||(project.audioName?`Выбери аудио: ${project.audioName}`:'Текст и отметки сохраняются автоматически');
  document.body.classList.toggle('preview-mode',preview);
  $('mode-edit').classList.toggle('chosen',!preview);$('mode-preview').classList.toggle('chosen',preview);$('mode-edit').setAttribute('aria-pressed',String(!preview));$('mode-preview').setAttribute('aria-pressed',String(preview));
  $('undo').disabled=!history.length;$('redo').disabled=!future.length;
  $('record-mode').disabled=recording;
  const words=project.lines.flatMap(l=>l.words),count=words.filter(w=>Number.isFinite(w.time)&&Number.isFinite(w.end)&&!w.estimated).length;
  $('completion').textContent=`Размечено ${count} из ${words.length} слов`;
  $('completion-hint').textContent=words.some(w=>w.estimated)?'Есть приблизительные концы — проверь и подтверди':'Отметки сохраняются в этом браузере';
  renderList();renderStage();renderInspector();
}
async function play() {
  if(!audioFile||loading)return;
  try{await audio.play();}catch{tell('Нажми пуск на панели аудио, чтобы включить музыку.');}
}
async function startRecord(from=0) {
  if(!line()||!audioFile||loading)return;
  const current=line();
  if(current.words.slice(from).some(w=>w.time!==null)&&!await confirmAction(`Заменить отметки со слова ${from+1} до конца строки «${current.text}»? Другие строки сохранятся.`))return;
  commit(()=>{current.words.slice(from).forEach(w=>{w.time=null;w.end=null;w.estimated=false;});cursor=from;wordIndex=from;});
  recording=true;holding=false;preview=false;
  audio.currentTime=Math.max(0,(from>0?(current.words[from-1].end??current.time):current.time)-1);
  render();$('record-stage').focus();await play();
}
function markDown() {
  if(!recording||audio.paused||holding||!line())return;
  const current=line(),now=audio.currentTime;
  if(cursor>=current.words.length) {
    const last=current.words.at(-1);
    if(now<=last.time+.001){tell('Конец должен быть позже начала слова.');return;}
    commit(()=>{last.end=now;current.end=now;last.estimated=false;});stop();tell('Строка размечена. Проверь концы слов и подтверди их.');return;
  }
  const previous=current.words[cursor-1];
  if(previous&&now<=previous.time+.001){tell('Следующее слово должно начинаться позже предыдущего.');return;}
  if(previous&&Number.isFinite(previous.end)&&previous.end>now){tell('Начало пересекается с предыдущим словом. Исправь время.');return;}
  commit(()=>{
    const w=current.words[cursor];w.time=now;wordIndex=cursor;
    if($('record-mode').value==='tap') {if(previous&&previous.end===null){previous.end=now;previous.estimated=true;}cursor++;}
    else holding=true;
  });
  $('record-stage').focus();
}
function markUp() {
  if(!holding||!line())return;
  const w=line().words[cursor],now=audio.currentTime;
  holding=false;
  if(now<=w.time+.001){w.time=null;tell('Слишком короткое нажатие. Повтори слово.');persist();render();return;}
  // Start and end belong to a single undo transaction in hold mode.
  w.end=now;w.estimated=false;wordIndex=cursor;cursor++;
  if(cursor>=line().words.length){line().end=now;recording=false;audio.pause();tell('Строка размечена. Можно прослушать результат.');}
  changed();
}
async function setSource(blob) {
  if(audioURL)URL.revokeObjectURL(audioURL);audioURL=URL.createObjectURL(blob);
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>finish(new Error('Не удалось открыть аудио напрямую.')),12000);
    const ok=()=>finish(),fail=()=>finish(new Error('Браузеру нужен дополнительный декодер.'));
    function finish(error){clearTimeout(timeout);audio.removeEventListener('canplay',ok);audio.removeEventListener('error',fail);error?reject(error):resolve();}
    audio.addEventListener('canplay',ok);audio.addEventListener('error',fail);audio.src=audioURL;audio.load();
  });
  audio.playbackRate=Number($('speed').value);audio.preservesPitch=true;
}
async function loadAudio(file) {
  stop();loading=true;render();tell('Открываю аудио…',true);fallbackUsed=false;
  try {
    try{await setSource(file);}catch{fallbackUsed=true;const {decodeAudio}=await import('./decoder.js');await setSource(await decodeAudio(file,t=>tell(t,true)));}
    audioFile=file;project.audioName=file.name;project.duration=audio.duration;
    audio.currentTime=clamp(resumePosition,0,audio.duration);
    tell('Песня готова. Выбери строку и начни разметку.');persist();
  }catch(error){audioFile=undefined;tell(error.message||'Не удалось открыть аудио.');}
  finally{loading=false;render();}
}
async function loadLyrics(file) {
  if(file.size>5*1024*1024)throw new Error('Текст должен быть меньше 5 МБ.');
  const text=decodeLyrics(await file.arrayBuffer());
  const parsed=/\.(ttml|xml)$/i.test(file.name)?parseTtml(text):parseLrc(text);
  const next=projectFromLrc(parsed);
  if(!next.lines.length)throw new Error('В файле нет строк с временными метками.');
  if(/\.(ttml|xml)$/i.test(file.name))next.lines.forEach((l,i)=>{l.words=parsed.lines.filter(l=>l.text.trim())[i].words.map(w=>({...w,estimated:false}));if(!l.words.length)l.words=tokenize(l.text);});
  if(project.lines.length&&!await confirmAction('Заменить текущий текст и его отметки? Сначала можно скачать проект JSON.'))return;
  stop();commit(()=>{project={...next,audioName:audioFile?.name||'',duration:audioFile?audio.duration:null};lineIndex=wordIndex=cursor=0;});
  tell('Текст добавлен. Выбери строку и нажми «Разметить строку».');
}
async function loadJson(file) {
  if(file.size>10*1024*1024)throw new Error('Проект должен быть меньше 10 МБ.');
  const data=JSON.parse(await file.text());const next=data.project;
  const errors=validateProject(next,false);if(errors.length)throw new Error(errors.slice(0,3).join('\n'));
  if(project.lines.length&&!await confirmAction('Открыть другой проект вместо текущего? Сначала можно скачать свой JSON.'))return;
  stop();commit(()=>{project=next;lineIndex=clamp(data.lineIndex||0,0,project.lines.length-1);wordIndex=0;cursor=0;});
  if(audioFile?.name!==project.audioName){audioFile=undefined;audio.removeAttribute('src');audio.load();}
  else if(audioFile)project.duration=audio.duration;
  $('speed').value=['0.5','0.65','0.75','0.9','1'].includes(data.speed)?data.speed:'1';audio.playbackRate=Number($('speed').value);
  $('record-mode').value=data.mode==='hold'?'hold':'tap';
  if(Number.isFinite(data.position)){resumePosition=data.position;if(audioFile)audio.currentTime=clamp(resumePosition,0,audio.duration);}
  persist();render();tell(audioFile?'Проект открыт.':'Проект открыт. Теперь выбери аудиофайл — отметки уже восстановлены.');
}
async function importFiles(files) {
  const items=[...files];
  const json=items.find(f=>/\.json$/i.test(f.name));
  const track=items.find(f=>f.type.startsWith('audio/')||/\.(mp3|flac|m4a|alac|aac|wav|aiff?|ogg|opus|wma|ape|wv|caf|mp4|webm|mka|dsf|dff|amr)$/i.test(f.name));
  const lyrics=items.find(f=>/\.(lrc|ttml|xml)$/i.test(f.name));
  if(!track&&!lyrics&&!json)throw new Error('Добавь аудио, LRC, TTML или проект JSON.');
  if(json)await loadJson(json);if(track)await loadAudio(track);if(lyrics)await loadLyrics(lyrics);
}
function enqueue(files){const items=[...files];importQueue=importQueue.then(()=>importFiles(items)).catch(error=>tell(error.message||'Не удалось открыть файл.'));}
async function applyText() {
  if(!line()||recording)return;
  const text=$('line-text').value.trim();if(!text){tell('В строке должен быть текст.');return;}
  if(line().words.some(w=>w.time!==null)&&!await confirmAction('Изменение текста сбросит отметки только этой строки. Продолжить?'))return;
  commit(()=>{line().text=text;line().words=tokenize(text);wordIndex=cursor=0;});
}
$('import-all').onclick=()=>$('editor-files').click();$('import-audio').onclick=()=>$('editor-audio-input').click();$('import-lyrics').onclick=()=>$('editor-lyrics-input').click();$('load-project').onclick=()=>$('editor-project-input').click();
['editor-files','editor-audio-input','editor-lyrics-input','editor-project-input'].forEach(id=>$(id).onchange=e=>{enqueue(e.target.files);e.target.value='';});
$('save-project').onclick=()=>download(`${safeName()}.audio-project.json`,JSON.stringify({kind:'audio-ttml-project',project,lineIndex,position:audioFile?audio.currentTime:resumePosition,speed:$('speed').value,mode:$('record-mode').value},null,2),'application/json');
$('export-ttml').onclick=()=>{if(recording){tell('Сначала заверши запись.');return;}try{download(`${safeName()}.ttml`,exportTtml(project),'application/ttml+xml');tell('TTML готов. Открой его вместе с песней в плеере.');}catch(error){tell(error.message,true);}};
$('undo').onclick=undo;$('redo').onclick=redo;
$('start-record').onclick=()=>void startRecord();$('record-from-word').onclick=()=>void startRecord(wordIndex);$('stop-record').onclick=()=>stop();
$('mark-word').addEventListener('pointerdown',e=>{e.preventDefault();e.target.setPointerCapture(e.pointerId);markDown();});
$('mark-word').addEventListener('pointerup',e=>{e.preventDefault();markUp();});
$('mark-word').addEventListener('pointercancel',()=>{if(holding){holding=false;line().words[cursor].time=null;persist();render();}});
$('mark-word').addEventListener('click',e=>{if(e.detail===0)markDown();});
$('mode-edit').onclick=()=>{stop();preview=false;render();};$('mode-preview').onclick=()=>{stop();preview=true;lastPreviewLine=-1;render();};
$('listen-line').onclick=()=>{if(!line()||!audioFile)return;stop();audio.currentTime=Math.max(0,(line().words[0]?.time??line().time)-1);void play();};
$('speed').onchange=()=>{audio.playbackRate=Number($('speed').value);audio.preservesPitch=true;persist();};
$('record-mode').onchange=()=>{persist();render();};
$('apply-timing').onclick=()=>{
  if(!word()||recording)return;
  const start=$('word-start').value,end=$('word-end').value;if(start===''||end===''){tell('Укажи начало и конец слова.');return;}
  const s=parseTime(start),e=parseTime(end),previous=line().words[wordIndex-1],next=line().words[wordIndex+1];
  if(!Number.isFinite(s)||!Number.isFinite(e)){tell('Введи время как в плеере: 01:23.450 — минуты:секунды.миллисекунды.');return;}
  if(s<0||e<=s||Number.isFinite(project.duration)&&e>project.duration||Number.isFinite(previous?.end)&&s<previous.end-.001||Number.isFinite(next?.time)&&e>next.time+.001||Number.isFinite(line().end)&&e>line().end+.001){tell('Проверь времена: конец позже начала, слова не пересекаются и находятся внутри строки и песни.');return;}
  commit(()=>{Object.assign(word(),{time:s,end:e,estimated:false});});
};
function applyLine(start,end){
  if(!line()||recording)return;
  try{const replacement=retimeLine(project,lineIndex,start,end);commit(()=>{project.lines[lineIndex]=replacement;});previewClock.reset();tell('Время всей строки изменено. Отметки слов перенесены вместе с ней.');}
  catch(error){tell(error.message);}
}
$('apply-line-timing').onclick=()=>applyLine(parseTime($('line-start').value),parseTime($('line-end').value));
$('apply-line-speed').onclick=()=>{if(!line())return;const range=lineRange(project,lineIndex),speed=Number($('line-speed').value);applyLine(range.start,range.start+(range.end-range.start)/speed);};
for(const prefix of ['word','line'])for(const edge of ['start','end'])$(`${prefix}-${edge}-now`).onclick=()=>{if(audioFile)$(`${prefix}-${edge}`).value=formatTime(audio.currentTime);else tell('Сначала добавь аудио.');};
$('export-lrc').onclick=()=>{if(recording){tell('Сначала заверши запись.');return;}try{download(`${safeName()}.lrc`,exportLrc(project),'text/plain;charset=utf-8');tell('LRC сохранён с исправленным временем строк.');}catch(error){tell(error.message);}};
$('confirm-line').onclick=()=>{
  if(!line()||recording)return;
  const candidate=structuredClone(project);candidate.lines[lineIndex].words.forEach(w=>w.estimated=false);
  const local=validateProject({...candidate,lines:[candidate.lines[lineIndex]]});
  if(local.length){tell('Сначала поставь корректные начало и конец каждого слова этой строки.');return;}
  commit(()=>line().words.forEach(w=>w.estimated=false));tell('Концы слов этой строки подтверждены.');
};
$('apply-text').onclick=()=>void applyText();$('text-variant').onchange=e=>{$('line-text').value=e.target.value;};
document.addEventListener('keydown',e=>{
  const editing=e.target.closest('input,textarea,select,[contenteditable=true]');
  if(!editing&&(e.metaKey||e.ctrlKey)&&e.code==='KeyZ'){e.preventDefault();e.shiftKey?redo():undo();return;}
  if(editing||e.metaKey||e.ctrlKey||e.altKey)return;
  if(e.code==='Escape'&&recording){e.preventDefault();stop();return;}
  if($('confirm-dialog').open)return;
  if(e.code==='KeyP'){e.preventDefault();audio.paused?void play():audio.pause();return;}
  if(e.target.closest('button,a'))return;
  if(e.code==='Space'&&recording){e.preventDefault();if(!e.repeat)markDown();}
});
document.addEventListener('keyup',e=>{if(e.code==='Space'&&holding){e.preventDefault();markUp();}});
window.addEventListener('blur',()=>{if(recording){if(holding){holding=false;const w=line().words[cursor];w.time=null;w.end=null;}stop();tell('Запись приостановлена при смене окна. Отметки сохранены.');}});
audio.addEventListener('pause',()=>{if(recording){if(holding)markUp();persist();render();}});
audio.addEventListener('ended',()=>{if(recording){if(holding)markUp();stop();tell('Песня закончилась. Проверь последнюю отметку.');}});
audio.addEventListener('error',()=>{if(!loading&&audioFile)tell('Не удалось воспроизвести аудио. Выбери его заново.');});
audio.addEventListener('play',()=>{
  if(recording)renderStage();
  // Some codecs expose metadata before the browser discovers they need decoding.
  if(audio.error&&!fallbackUsed)tell('Попробуй открыть аудио заново для подготовки декодером.');
});
let lastSaved=0;
function tick(now) {
  requestAnimationFrame(tick);
  $('editor-position').textContent=formatTime(audioFile?audio.currentTime:resumePosition)||'00:00.000';
  if(!project.lines.length)return;
  if(audioFile&&!audio.paused&&now-lastSaved>10000){lastSaved=now;persist();}
  if(!recording&&audioFile&&!audio.paused&&$('loop-line').checked){const end=line()?.words.at(-1)?.end??project.lines[lineIndex+1]?.time??audio.duration;if(audio.currentTime>=end)audio.currentTime=Math.max(0,(line().words[0]?.time??line().time)-1);}
  if(preview&&audioFile){
    const indices=previewTimeline(audio.currentTime),key=indices.join(',');
    if(key!==lastPreviewLine){lastPreviewLine=key;previewIndices=indices;if(indices.length)lineIndex=indices.at(-1);wordIndex=0;render();}
    const nowTime=previewClock.read(audio.currentTime,now,{running:!audio.paused&&audio.readyState>=3,seeking:audio.seeking,rate:audio.playbackRate});
    for(const row of $('stage-words').children){const l=project.lines[Number(row.dataset.index)];if(l)paintWords(row,l.words,nowTime,l.end);}

  }

}
let dragDepth=0;document.addEventListener('dragenter',e=>{if([...e.dataTransfer.types].includes('Files')){e.preventDefault();dragDepth++;$('editor-drop').hidden=false;}});
document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('dragleave',e=>{e.preventDefault();if(--dragDepth<=0){dragDepth=0;$('editor-drop').hidden=true;}});
document.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('editor-drop').hidden=true;enqueue(e.dataTransfer.files);});
window.addEventListener('pagehide',persist);
try {
  const saved=JSON.parse(localStorage.getItem(STORAGE)||'null');
  if(saved&&!validateProject(saved.project,false).length){project=saved.project;lineIndex=clamp(saved.lineIndex||0,0,project.lines.length-1);wordIndex=clamp(saved.wordIndex||0,0,line()?.words.length-1);cursor=wordIndex;$('speed').value=['0.5','0.65','0.75','0.9','1'].includes(saved.speed)?saved.speed:'1';$('record-mode').value=saved.mode==='hold'?'hold':'tap';if(Number.isFinite(saved.position))resumePosition=saved.position;$('save-status').textContent='Проект восстановлен · добавь аудио';}
}catch{$('save-status').textContent='Локальное сохранение недоступно';}
render();requestAnimationFrame(tick);

// The draft stays separate until every line has been marked, leaving the
// current word project untouched while recording a replacement.
let capture=false,entries=[],captureHistory=[];
const draftKey='audio-line-draft-v1';
try{const d=JSON.parse(localStorage.getItem(draftKey)||'null');if(d){$('plain-lyrics').value=d.text||'';entries=d.entries||[];}}catch{}
function captureStatus(){const texts=draftLines($('plain-lyrics').value);$('line-capture-status').textContent=`${entries.length} / ${texts.length} строк. ${texts[entries.length]?'Следующая: '+texts[entries.length]:'Все начала отмечены — Enter завершает последнюю строку.'}`;try{localStorage.setItem(draftKey,JSON.stringify({text:$('plain-lyrics').value,entries}));}catch{}}
$('create-lrc').onclick=()=>{$('line-maker').hidden=false;captureStatus();};
$('close-maker').onclick=()=>{capture=false;$('plain-lyrics').disabled=false;$('line-maker').hidden=true;};
$('plain-lyrics').oninput=()=>{entries=[];captureHistory=[];captureStatus();};
$('capture-start').onclick=async()=>{
 if(!audioFile){tell('Сначала добавь аудио кнопкой «Открыть аудио» или перетащи песню.');return;}
 if(!draftLines($('plain-lyrics').value).length){tell('Вставь текст песни.');return;}
 stop();preview=false;capture=true;$('plain-lyrics').disabled=true;await play();$('capture-start').blur();captureStatus();
};
function captureMark(gap){
 if(!capture||audio.paused)return;
 try{captureHistory.push(JSON.stringify(entries));if(gap)entries=finishLine(entries,audio.currentTime);else if(entries.length<draftLines($('plain-lyrics').value).length)entries=markLine(entries,audio.currentTime);captureStatus();}catch(error){captureHistory.pop();tell(error.message);}
}
$('capture-next').onclick=()=>captureMark(false);$('capture-gap').onclick=()=>captureMark(true);
$('capture-audio').onclick=()=>audio.paused?void play():audio.pause();
$('capture-undo').onclick=()=>{if(captureHistory.length)entries=JSON.parse(captureHistory.pop());captureStatus();};
$('capture-finish').onclick=async()=>{
 try{
  const lines=materializeLines(draftLines($('plain-lyrics').value),entries);
  if(project.lines.length&&!await confirmAction('Заменить текущую разметку созданными строками? Текущий проект можно сначала скачать в JSON.'))return;
  capture=false;audio.pause();commit(()=>{project={...project,lines};lineIndex=wordIndex=cursor=0;preview=false;});$('line-maker').hidden=true;$('plain-lyrics').disabled=false;tell('LRC готов внутри редактора. Выбери строку и нажми «Разметить строку».');
 }catch(error){tell(error.message);}
};
document.addEventListener('keydown',e=>{
 if(!capture||$('confirm-dialog').open||e.target.closest('input,textarea,select')||e.ctrlKey||e.metaKey||e.altKey)return;
 if(['Space','Enter'].includes(e.code)){e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)captureMark(e.code==='Enter');}
},true);
