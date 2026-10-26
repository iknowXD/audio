import { wordVisualState } from './word-motion.mjs';
const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
export function appendWords(node, words) {
  for (const word of words) {
    const span = document.createElement('span'); span.className = 'lyric-word';span.setAttribute('aria-label',word.text);
    const base=document.createElement('span');base.className='word-base';base.setAttribute('aria-hidden','true');
    const fill = document.createElement('span'); fill.className = 'word-fill'; fill.setAttribute('aria-hidden','true');
    const letters=segmenter?[...segmenter.segment(word.text)].map(s=>s.segment):Array.from(word.text);
    letters.forEach((letter,i)=>{const glyph=document.createElement('span');glyph.className='lyric-glyph';glyph.textContent=letter;glyph.style.setProperty('--glyph-phase',(i/Math.max(1,letters.length-1)*.08).toFixed(3));base.append(glyph);fill.append(glyph.cloneNode(true));});
    span.append(base,fill); node.append(span);
  }
}
export function paintWords(node, words, now, fallbackEnd) {
  [...node.children].forEach((span,i) => {
    const word = words[i];
    const end = word.end ?? words[i+1]?.time ?? fallbackEnd ?? word.time + 1;
    const {progress,opacity,lift} = wordVisualState(word,now,end);
    const key=`${progress.toFixed(4)}:${opacity.toFixed(4)}:${lift.toFixed(4)}`;if(span.paintKey===key)return;span.paintKey=key;
    span.style.setProperty('--word-progress',`${(progress*100).toFixed(2)}%`);
    span.style.setProperty('--word-opacity',opacity.toFixed(4));
    span.style.setProperty('--word-lift',lift.toFixed(4));
    span.classList.toggle('word-live', progress > 0 && progress < 1);
  });
}
