import { clamp } from './timed-lyrics.mjs';

// A paragraph can be displayed before the vocal begins. For karaoke, activate
// it at the first timed word without rewriting either timestamp in the file.
export function playbackStart(line) {
  return line.words?.find(word=>Number.isFinite(word.time))?.time ?? line.time;
}
export function activePlaybackLine(lines,time) {
  let selected=-1,latest=-Infinity;
  lines.forEach((line,index)=>{
    const start=playbackStart(line);
    if(start<=time&&start>=latest){selected=index;latest=start;}
  });
  return selected;
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '';
  const ms=Math.max(0,Math.round(seconds*1000));
  return `${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;
}
export function parseTime(text) {
  const match=String(text).trim().replace(',', '.').match(/^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d{1,3})?)$/);
  if (!match || Number(match[3])>=60 || match[1] && Number(match[2])>=60) return NaN;
  return Number(match[1]||0)*3600+Number(match[2])*60+Number(match[3]);
}
export function lineRange(project,index) {
  const line=project.lines[index], first=line.words?.[0]?.time;
  const start=Number.isFinite(first)?Math.min(line.time,first):line.time;
  const end=Number.isFinite(line.end)?line.end:Number.isFinite(line.words?.at(-1)?.end)?line.words.at(-1).end:project.lines[index+1]?.time??(project.duration>start?project.duration:start+5);
  return {start,end};
}
export function retimeLine(project,index,start,end) {
  const old=lineRange(project,index), current=project.lines[index];
  if (!Number.isFinite(start)||!Number.isFinite(end)||start<0||end-start<.01) throw new Error('Конец строки должен быть позже начала. Формат времени: 01:23.450.');
  if (Number.isFinite(project.duration)&&end>project.duration+.001) throw new Error('Строка выходит за конец песни.');

  const factor=(end-start)/(old.end-old.start);
  const move=value=>Number.isFinite(value)?Math.round((start+(value-old.start)*factor)*1000)/1000:null;
  return {...current,time:start,end,words:current.words.map(w=>({...w,time:move(w.time),end:move(w.end)}))};
}
export function exportLrc(project) {
  if (!project.lines.length) throw new Error('Сначала добавь текст песни.');
  const lines=[`[ti:${(project.title||'').replace(/[\]\r\n]/g,'')}]`,`[ar:${(project.artist||'').replace(/[\]\r\n]/g,'')}]`];
  project.lines.forEach((line,i)=>{
    if(!Number.isFinite(line.time)||line.time<0)throw new Error('У строки нет корректного начала.');
    lines.push(`[${formatTime(line.time)}]${line.text.replace(/\r?\n/g,' ')}`);
    if(Number.isFinite(line.end)&&line.end>line.time&&(!project.lines[i+1]||line.end<project.lines[i+1].time-.001))lines.push(`[${formatTime(line.end)}]`);
  });
  return lines.join('\n')+'\n';
}

// Interpolate only the small gaps between media samples. Re-anchor on every
// discontinuity; never run a separate timer that can accumulate drift.
export class PlaybackClock {
  reset(){this.sample=undefined;this.last=undefined;}
  read(time,now,{running=true,rate=1,seeking=false}={}) {
    if(!Number.isFinite(time))return 0;
    if(!running||seeking||this.sample===undefined||rate!==this.rate||Math.abs(time-this.sample)>.25){this.sample=time;this.at=now;this.last=time;this.rate=rate;return time;}
    if(time!==this.sample){this.sample=time;this.at=now;}
    const predicted=time+clamp((now-this.at)/1000*rate,0,.08);
    this.last=clamp(Math.max(this.last??time,predicted),time,time+.08);
    return this.last;
  }
}
