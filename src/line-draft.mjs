import {tokenize} from './timed-lyrics.mjs';
export function draftLines(text){return text.split(/\r?\n/).map(t=>t.trim()).filter(Boolean);}
export function markLine(entries,time){
  if(!Number.isFinite(time)||time<0||entries.length&&time<=entries.at(-1).time)throw new Error('Следующая отметка должна быть позже предыдущей.');
  const next=entries.map(e=>({...e}));if(next.length&&next.at(-1).end==null)next.at(-1).end=time;
  next.push({time,end:null});return next;
}
export function finishLine(entries,time){const next=entries.map(e=>({...e}));if(next.length&&next.at(-1).end==null){if(time<=next.at(-1).time)throw new Error('Конец должен быть позже начала.');next.at(-1).end=time;}return next;}
export function materializeLines(texts,entries){if(entries.length!==texts.length||entries.some(e=>e.end==null))throw new Error('Сначала отметь все строки и конец последней.');return texts.map((text,i)=>({...entries[i],text,words:tokenize(text)}));}
