import {createTimeline} from './lyric-timeline.mjs';
import './style.css';
import {MusicService} from './music-service.js';
import {mediaSource,isVideo} from './artwork.js';
import {collectionById} from './library-db.mjs';
import {mediaBlob} from './cloud-library.js';
import {albumKey} from './library-model.mjs';
import {MusicLibrary} from './music-library.js';
import {BeatEnvelope} from './beat-envelope.mjs';
import './library.css';
import { parseLrc, decodeLyrics } from './lrc.mjs';
import { parseTtml } from './timed-lyrics.mjs';
import { appendWords, paintWords } from './lyric-render.js';
import { PlaybackClock, playbackStart, activePlaybackLine } from './timing.mjs';
import './lyric-motion.css';
import './service.css';
import './accounts.css';

const $ = id => document.getElementById(id);
const audio = $('audio');
let currentFile, audioURL, coverURL, lyrics = [], lyricNodes = [], selected = -2;
let busy = false, usingFallback = false, importing = Promise.resolve();
let toastTimer, scrollUntil = 0, nextVolume = .8;
let context, analyser, frequencies, frame = 0, beatAt=performance.now();
const beats=new BeatEnvelope();
let library,libraryReady;
let motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let metadata = {},coverMedia;
const lyricClock=new PlaybackClock();
let clockBlocked=false,scrollMotion;
let timeline=createTimeline([]),activeIndices=[],activeKey="";
audio.volume = .8;

function toast(message, persistent = false) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
  if (!persistent) toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}
function setBusy(value) { busy = value; $('play').disabled = value || !currentFile; $('audio-busy').hidden = !value; }
function timeLabel(time) { if (!Number.isFinite(time)) return '0:00'; const n = Math.max(0, Math.floor(time)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; }
function paintRange(node) { node.style.setProperty('--value', `${((node.value - node.min) / (node.max - node.min)) * 100}%`); }

function clearLyrics() {
  lyricClock.reset();scrollMotion=undefined;
  activeIndices=[];activeKey="";timeline=createTimeline([]);
  lyrics = []; lyricNodes = []; selected = -2; scrollUntil = 0;
  $('lyrics-lines').replaceChildren(); $('lyrics-viewport').hidden = true; $('lyrics-empty').hidden = false; 
}
function clearCover() {
  coverMedia?.release();coverMedia=undefined;coverURL = undefined;
  $('cover-video').pause();$('cover-video').hidden=true;$('cover-video').removeAttribute('src');
  $('cover-image').hidden = true; $('cover-image').removeAttribute('src'); $('cover-placeholder').toggleAttribute('hidden', false);
  document.documentElement.style.setProperty('--color-one', '40,40,44');
  document.documentElement.style.setProperty('--color-two', '22,22,26');
  document.documentElement.style.setProperty('--color-three', '49,47,47');
}
function showTitle() {
  $('track-title').textContent = metadata.title || currentFile?.name.replace(/\.[^.]+$/, '') || 'Без названия';
  $('track-artist').textContent = metadata.artist || 'Неизвестный исполнитель';
  document.title = currentFile ? `${$('track-title').textContent} · Audio` : 'Audio · Твоя музыка';
  if ('mediaSession' in navigator && currentFile) {
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: $('track-title').textContent, artist: metadata.artist || '', artwork: coverURL&&coverMedia?.node.tagName!=='VIDEO' ? [{ src: coverURL }] : [] }); } catch {}
  }
}
async function setCover(blob) {
  clearCover();
  try{coverMedia=await mediaSource(blob);}catch(error){toast(error.message);return;}
  coverURL=coverMedia.url;const img=coverMedia.node,id=isVideo(blob)?'cover-video':'cover-image';
  img.id=id;img.hidden=false;img.alt='Обложка альбома';$(id).replaceWith(img);
  if(isVideo(blob)){img.loop=true;img.muted=true;img.playsInline=true;if(document.body.classList.contains('immersive'))void img.play().catch(()=>{});}
  $('cover-placeholder').toggleAttribute('hidden',true);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, 48, 48);
  const data = ctx.getImageData(0, 0, 48, 48).data;
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const rgb = [data[i], data[i + 1], data[i + 2]];
    const light = (Math.max(...rgb) + Math.min(...rgb)) / 2;
    if (light < 15 || light > 242) continue;
    const key = rgb.map(c => c >> 5).join(',');
    const bucket = buckets.get(key) || { sum: [0, 0, 0], count: 0, score: 0 };
    rgb.forEach((c, j) => { bucket.sum[j] += c; }); bucket.count++;
    bucket.score += 1 + (Math.max(...rgb) - Math.min(...rgb)) / 150;
    buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()].sort((a, b) => b.score - a.score).map(b => b.sum.map(c => Math.round(c / b.count)));
  const palette = [];
  for (const color of ranked) { if (palette.every(c => Math.hypot(...c.map((v, j) => v - color[j])) > 70)) palette.push(color); if (palette.length === 3) break; }
  if (!palette.length) palette.push([60, 60, 65]);
  while (palette.length < 3) palette.push(palette[0].map(c => Math.round(c * .65)));
  ['one', 'two', 'three'].forEach((name, i) => {
    // Keep contrast for white lyrics even when the artwork is very bright.
    const brightness = Math.max(...palette[i]); const factor = Math.min(.75, 135 / Math.max(1, brightness));
    document.documentElement.style.setProperty(`--color-${name}`, palette[i].map(c => Math.round(c * factor)).join(','));
  });
  showTitle();
}

async function loadLrc(file) {
  if (file.size > 5 * 1024 * 1024) { toast('Этот текст слишком большой. Выбери файл до 5 МБ.'); return; }
  const text = decodeLyrics(await file.arrayBuffer());
  const parsed = /\.(ttml|xml)$/i.test(file.name) ? parseTtml(text) : parseLrc(text);
  if (!parsed.lines.length) { toast('В LRC нет временных меток. Нужны строки вида [00:12.50]Текст песни.'); return; }
  clearLyrics(); lyrics = parsed.lines;timeline=createTimeline(lyrics);
  lyricNodes = lyrics.map((line, index) => {
    const node = document.createElement('button'); node.className = 'lyric-line';
    node.setAttribute('aria-label', `${timeLabel(playbackStart(line))} — ${line.text || 'Инструментальный фрагмент'}`);
    if (!line.text) { node.textContent = '•••'; node.classList.add('blank'); }
    else if (line.words.length) appendWords(node, line.words);
    else node.textContent = line.text;
    node.addEventListener('click', () => {
      if (!currentFile || busy) return;
      audio.currentTime = Math.max(0, Math.min(audio.duration || Infinity, playbackStart(line)));
      scrollUntil = 0; updateLyrics(true); if (audio.paused) void play();
    });
    return node;
  });
  $('lyrics-lines').replaceChildren(...lyricNodes);
  $('lyrics-empty').hidden = true; $('lyrics-viewport').hidden = false; 
  showTitle(); updateLyrics(true);

}

function updateLyrics(force = false) {
  if (!lyrics.length) return;
  const now = lyricClock.read(audio.currentTime,performance.now(),{running:!audio.paused&&!audio.ended&&!clockBlocked&&audio.readyState>=3,seeking:audio.seeking,rate:audio.playbackRate});
  const indices=timeline(now),key=indices.join(',');
  if(key!==activeKey){
    const previous=activeIndices;activeIndices=indices;activeKey=key;
    for(const i of previous){lyricNodes[i].classList.remove('active');lyricNodes[i].removeAttribute('aria-current');}
    selected=indices[0]??activePlaybackLine(lyrics,now);
    lyricNodes.forEach((node,i)=>node.classList.toggle('past',playbackStart(lyrics[i])<now&&!indices.includes(i)));
    for(const i of indices){lyricNodes[i].classList.add('active');lyricNodes[i].setAttribute('aria-current','true');}
    force=true;
  }
  if(force&&performance.now()>scrollUntil)centerLine();
  for(const i of indices)if(lyrics[i].words.length)paintWords(lyricNodes[i],lyrics[i].words,now,lyrics[i].end??lyrics[i+1]?.time??audio.duration);

}
function centerLine() {
  const viewport = $('lyrics-viewport'), node = lyricNodes[Math.max(0, selected)];
  if(!node)return;
  const top=Math.max(0,Math.min(viewport.scrollHeight-viewport.clientHeight,node.offsetTop-viewport.clientHeight*.4+node.offsetHeight/2));
  if(!motion){viewport.scrollTop=top;scrollMotion=undefined;return;}
  if(scrollMotion&&Math.abs(scrollMotion.to-top)<1)return;
  scrollMotion={from:viewport.scrollTop,to:top,start:performance.now()};
}
async function sourceReady(blob) {
  if (audioURL?.startsWith('blob:')) URL.revokeObjectURL(audioURL);
  audioURL = typeof blob==='string'?blob:URL.createObjectURL(blob);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('Браузер не смог открыть этот формат.')), 12000);
    const success = () => finish();
    const fail = () => finish(new Error('Формат не поддерживается напрямую.'));
    function finish(error) { clearTimeout(timeout); audio.removeEventListener('canplay', success); audio.removeEventListener('error', fail); error ? reject(error) : resolve(); }
    audio.addEventListener('canplay', success); audio.addEventListener('error', fail); audio.src = audioURL; audio.load();
  });
}
async function fallback() {
  usingFallback = true;
  if(!(currentFile instanceof Blob)){const blob=await mediaBlob(audioURL);currentFile=new File([blob],currentFile.name,{type:blob.type});}
  const { decodeAudio } = await import('./decoder.js');
  const converted = await decodeAudio(currentFile, message => toast(message, true));
  await sourceReady(converted);
}
async function applySong(track,assets,changes={cover:true,lyrics:true}){
  metadata={title:track.title,artist:track.artist};showTitle();
  if(changes.cover){const cover=track.coverCustom?assets.cover:(await collectionById(albumKey(track)))?.media||assets.cover;if(cover)await setCover(await mediaBlob(cover));else clearCover();}
  if(changes.lyrics){clearLyrics();if(assets.lyrics)await loadLrc(new File([assets.lyrics],track.lyricsName,{type:assets.lyrics.type}));}
  showTitle();
}
async function loadSavedSong(track,assets,{autoplay}){
  audio.pause();currentFile=typeof assets.audio==='string'?{name:track.filename}:new File([assets.audio],track.filename,{type:assets.audio.type});usingFallback=false;beats.reset();
  clearLyrics();clearCover();metadata={title:track.title,artist:track.artist};showTitle();setBusy(true);
  $('empty').hidden=true;$('player').hidden=false;document.body.classList.add('has-track');$('motion-toggle').hidden=false;
  $('seek').value=0;paintRange($('seek'));$('elapsed').textContent='0:00';$('remaining').textContent='−0:00';
  try{
    try{await sourceReady(typeof assets.audio==='string'?assets.audio:currentFile);}catch{await fallback();}
    await applySong(track,assets);setBusy(false);if(autoplay)await play();
  }catch(error){setBusy(false);$('play').disabled=true;throw error;}
}
async function play() {
  if (!currentFile || busy) return;
  try {
    if (!context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        context = new AudioContextClass(); analyser = context.createAnalyser(); analyser.fftSize = 2048;analyser.smoothingTimeConstant=.05;
        frequencies = new Float32Array(analyser.frequencyBinCount);
        context.createMediaElementSource(audio).connect(analyser); analyser.connect(context.destination);
      }
    }
    if (context?.state === 'suspended') await context.resume();
    await audio.play();
  } catch (error) {
    if (error.name === 'NotAllowedError') { toast('Песня готова. Нажми ▶, чтобы включить звук.'); return; }
    if (!usingFallback) {
      setBusy(true);
      try { await fallback(); setBusy(false); $('toast').hidden = true; await audio.play(); }
      catch { setBusy(false); toast('Не удалось воспроизвести файл. Попробуй другое аудио.'); }
    } else toast('Не удалось воспроизвести файл. Попробуй другое аудио.');
  }
}
function togglePlay() { if (!currentFile || busy) return; audio.paused ? void play() : audio.pause(); }

function queueFiles(files){
 const retained=[...files];importing=importing.then(async()=>{await libraryReady;await library.importFiles(retained);}).catch(error=>library.notify(error.name==='QuotaExceededError'?'В браузере не хватает места для сохранения песен.':error.message||'Не удалось добавить файлы.',true));
}
$('drop-button').onclick=()=>library.open();
$('file-input').onchange=e=>{queueFiles(e.target.files);e.target.value='';};
$('play').addEventListener('click', togglePlay);
$('seek').addEventListener('input', event => { if (Number.isFinite(audio.duration)) { audio.currentTime = Number(event.target.value); scrollUntil = 0; updateLyrics(true); } paintRange(event.target); });
$('volume').addEventListener('input', event => { audio.volume = Number(event.target.value); audio.muted = false; paintRange(event.target); });
$('mute').addEventListener('click', () => { if (audio.muted || audio.volume === 0) { audio.muted = false; audio.volume = nextVolume || .8; } else { nextVolume = audio.volume; audio.muted = true; } });
audio.addEventListener('volumechange', () => { $('volume').value = audio.muted ? 0 : audio.volume; paintRange($('volume')); $('mute').setAttribute('aria-label', audio.muted || audio.volume === 0 ? 'Включить звук' : 'Выключить звук'); $('mute').style.opacity = audio.muted || audio.volume === 0 ? '.4' : '1'; });
['play', 'pause', 'ended'].forEach(type => audio.addEventListener(type, () => {
  const paused = audio.paused;library?.setPlaying(!paused); $('play-icon').toggleAttribute('hidden', !paused); $('pause-icon').toggleAttribute('hidden', paused);
  $('play').setAttribute('aria-label', paused ? 'Воспроизвести' : 'Пауза');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = paused ? 'paused' : 'playing';
}));
audio.addEventListener('durationchange', () => { $('seek').max = Number.isFinite(audio.duration) ? audio.duration : 100; });
audio.addEventListener('error', () => { if (!busy && currentFile) toast('Воспроизведение остановилось: не удалось прочитать аудио. Попробуй открыть файл ещё раз.'); });
function tick() {
  requestAnimationFrame(tick);
  if (!currentFile) return;
  updateLyrics();
  if(scrollMotion){const t=Math.min(1,(performance.now()-scrollMotion.start)/320);$('lyrics-viewport').scrollTop=scrollMotion.from+(scrollMotion.to-scrollMotion.from)*(1-Math.pow(1-t,3));if(t===1)scrollMotion=undefined;}
  if (frame++ % 3 === 0) {
    $('elapsed').textContent = timeLabel(audio.currentTime); $('remaining').textContent = `−${timeLabel(audio.duration - audio.currentTime)}`;
    if (document.activeElement !== $('seek')) { $('seek').value = audio.currentTime; paintRange($('seek')); }
  }
  const beatNow=performance.now(),dt=(beatNow-beatAt)/1000;beatAt=beatNow;
  if(motion&&document.body.classList.contains('immersive')){
    if(analyser&&!audio.paused)analyser.getFloatFrequencyData(frequencies);
    else frequencies?.fill(-Infinity);
    const state=beats.read(frequencies||[],context?.sampleRate||48000,analyser?.fftSize||2048,dt);
    document.documentElement.style.setProperty('--pulse',state.kick.toFixed(3));
    document.documentElement.style.setProperty('--bass',state.level.toFixed(3));
  }

}
requestAnimationFrame(tick);
let scrollTimer;
function manualScroll() { scrollMotion=undefined;scrollUntil = performance.now() + 3500; clearTimeout(scrollTimer); scrollTimer = setTimeout(() => { scrollUntil = 0; centerLine(); }, 3600); }
$('lyrics-viewport').addEventListener('wheel', manualScroll, { passive: true });
$('lyrics-viewport').addEventListener('touchmove', manualScroll, { passive: true });
window.addEventListener('resize', () => updateLyrics(true));
function updateMotion() { document.body.classList.toggle('motion-off', !motion); $('motion-toggle').setAttribute('aria-pressed', String(motion)); $('motion-status').textContent = motion ? 'вкл.' : 'выкл.'; if (!motion){document.documentElement.style.setProperty('--pulse',0);document.documentElement.style.setProperty('--bass',0);beats.reset();} }
$('motion-toggle').addEventListener('click', () => { motion = !motion; updateMotion(); }); updateMotion();
$('fullscreen').addEventListener('click', async () => { try { document.fullscreenElement ? await document.exitFullscreen() : await document.documentElement.requestFullscreen(); } catch { toast('Полный экран недоступен в этом окне. Открой сайт в отдельной вкладке.'); } });
document.addEventListener('fullscreenchange', () => { $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Выйти из полного экрана' : 'На весь экран'); });
document.addEventListener('keydown', event => {
  if(document.querySelector('dialog[open]'))return;
  if (['INPUT', 'TEXTAREA', 'BUTTON', 'A','SELECT'].includes(event.target.tagName) || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
  if (currentFile && !busy && (event.code === 'ArrowLeft' || event.code === 'ArrowRight')) { event.preventDefault(); audio.currentTime = Math.max(0, Math.min(audio.duration || Infinity, audio.currentTime + (event.code === 'ArrowLeft' ? -5 : 5))); scrollUntil = 0; updateLyrics(true); }
});
let dragDepth = 0;
document.addEventListener('dragenter', event => { if (![...event.dataTransfer.types].includes('Files')) return; event.preventDefault(); dragDepth++; $('drop-overlay').hidden = false; });
document.addEventListener('dragover', event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; });
document.addEventListener('dragleave', event => { event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop-overlay').hidden = true; });
document.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; $('drop-overlay').hidden = true; queueFiles(event.dataTransfer.files); });
window.addEventListener('blur', () => { dragDepth = 0; $('drop-overlay').hidden = true; });
for(const event of ['seeking','seeked','pause','ratechange','loadedmetadata'])audio.addEventListener(event,()=>{lyricClock.reset();updateLyrics(true);});
audio.addEventListener('waiting',()=>{clockBlocked=true;lyricClock.reset();updateLyrics();});
audio.addEventListener('playing',()=>{clockBlocked=false;lyricClock.reset();updateLyrics(true);});
audio.addEventListener('timeupdate',()=>updateLyrics());
document.addEventListener('visibilitychange',()=>{lyricClock.reset();updateLyrics(true);});
if ('mediaSession' in navigator) {
  for (const [action, handler] of Object.entries({ play: () => void play(), pause: () => audio.pause(), seekbackward: () => { audio.currentTime = Math.max(0, audio.currentTime - 5); }, seekforward: () => { audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); }, seekto: details => { audio.currentTime = details.seekTime; } })) { try { navigator.mediaSession.setActionHandler(action, handler); } catch {} }
}

library=new MusicLibrary({onSelect:loadSavedSong,onUpdate:applySong,notify:toast});
const service=new MusicService(library);
libraryReady=library.init();
void service.init(libraryReady);
audio.addEventListener('ended',()=>library.move(1,true));
if('mediaSession' in navigator)for(const [action,direction] of [['previoustrack',-1],['nexttrack',1]])try{navigator.mediaSession.setActionHandler(action,()=>library.move(direction));}catch{}
