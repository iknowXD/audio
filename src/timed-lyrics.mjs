export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export function wordProgress(word, time) {
  if (!Number.isFinite(word.time) || !Number.isFinite(word.end) || word.end <= word.time) return 0;
  return clamp((time - word.time) / (word.end - word.time), 0, 1);
}
export function tokenize(text) { return (text.match(/\S+\s*/gu) || []).map(text => ({ text, time: null, end: null, estimated: false })); }
export function projectFromLrc(parsed) {
  return {
    version: 1, title: parsed.meta.ti || '', artist: parsed.meta.ar || '', language: 'ru', audioName: '', duration: null,
    lines: parsed.lines.map((line,index) => {
      const alternatives = line.text.split('\n');
      const next=parsed.lines[index+1];
      return { time: line.time, end:line.end??(next&&!next.text.trim()?next.time:undefined), text: alternatives[0], alternatives, words: tokenize(alternatives[0]) };
    }).filter(line=>line.text.trim())
  };
}
export function validateProject(project, requireComplete = true) {
  const errors = [];
  if (!project || project.version !== 1 || !Array.isArray(project.lines) || project.lines.length > 10000) return ['Это не проект редактора Audio.'];
  if (['title','artist','language'].some(key => typeof project[key] !== 'string') || project.duration !== null && (!Number.isFinite(project.duration) || project.duration <= 0)) errors.push('Неверные метаданные проекта.');
  if (!project.lines.length) errors.push('Добавь текст песни.');
  let lastLine = -1;
  for (const [i, line] of project.lines.entries()) {
    if (!line || !Number.isFinite(line.time) || line.time < 0 || line.time < lastLine || typeof line.text !== 'string' || !Array.isArray(line.words) || line.words.length > 2000 || line.alternatives && (!Array.isArray(line.alternatives) || line.alternatives.some(t=>typeof t!=='string'))) { errors.push(`Строка ${i + 1}: неверные данные.`); continue; }
    lastLine = line.time;
    if(line.end!==undefined&&line.end!==null&&(!Number.isFinite(line.end)||line.end<=line.time||Number.isFinite(project.duration)&&line.end>project.duration+.01))errors.push(`Строка ${i+1}: проверь её конец.`);
    let lastEnd = -1;
    if (!line.words.length) errors.push(`Строка ${i + 1}: нет слов.`);
    for (const [j, word] of line.words.entries()) {
      const label = `Строка ${i + 1}, слово ${j + 1}`;
      if (!word || typeof word.text !== 'string' || !word.text.trim()) { errors.push(`${label}: пустой текст.`); continue; }
      if (word.time === null || word.end === null) { if (requireComplete) errors.push(`${label}: поставь начало и конец.`); continue; }
      if (!Number.isFinite(word.time) || !Number.isFinite(word.end) || word.time < 0 || word.end - word.time < .001 || word.time < lastEnd - .001) errors.push(`${label}: проверь порядок и длительность.`);
      if (Number.isFinite(project.duration) && word.end > project.duration + .01) errors.push(`${label}: конец за пределами песни.`);
      if (requireComplete && word.estimated) errors.push(`${label}: подтверди приблизительный конец.`);
      lastEnd = word.end;
    }

  }
  return errors;
}
const escapeXml = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
export function clockTime(time) {
  const ms = Math.round(time * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2,'0')}:${String(Math.floor(ms / 60000) % 60).padStart(2,'0')}:${String(Math.floor(ms / 1000) % 60).padStart(2,'0')}.${String(ms % 1000).padStart(3,'0')}`;
}
export function exportTtml(project) {
  const errors = validateProject(project);
  if (errors.length) throw new Error(errors.slice(0, 4).join('\n'));
  const paragraphs = project.lines.map(line => {
    const words = line.words.map(w => `<span begin="${clockTime(w.time)}" end="${clockTime(w.end)}">${escapeXml(w.text)}</span>`).join('');
    return `      <p begin="${clockTime(line.time)}" end="${clockTime(line.end??line.words.at(-1).end)}">${words}</p>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xml:lang="${escapeXml(project.language || 'ru')}" xml:space="preserve">\n  <head><metadata><ttm:title>${escapeXml(project.title)}</ttm:title><ttm:desc>${escapeXml(project.artist)}</ttm:desc></metadata></head>\n  <body><div>\n${paragraphs}\n  </div></body>\n</tt>\n`;
}
function readTime(value, parent = 0) {
  if (!value) return undefined;
  const parts = value.match(/^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/);
  if (parts) return Number(parts[1] || 0) * 3600 + Number(parts[2]) * 60 + Number(parts[3]);
  const offset = value.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);
  if (offset) return parent + Number(offset[1]) * ({ms:.001,s:1,m:60,h:3600}[offset[2]]);
  throw new Error(`Неподдерживаемое время TTML: ${value}. Нужны часы:минуты:секунды или секунды с суффиксом s.`);
}
export function parseTtml(source) {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('TTML с внешними сущностями не поддерживается.');
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || doc.documentElement.localName !== 'tt') throw new Error('Не удалось прочитать XML в TTML.');
  const all = [...doc.getElementsByTagName('*')];
  if (all.some(n => n.getAttribute('timeContainer') === 'seq')) throw new Error('Последовательные контейнеры TTML пока не поддерживаются.');
  const timings = new Map();
  for (const node of all) {
    const parent = timings.get(node.parentNode) || {time:0,end:Infinity};
    const time = readTime(node.getAttribute('begin'), parent.time) ?? parent.time;
    const end = readTime(node.getAttribute('end'), parent.time) ?? (node.hasAttribute('dur') ? time + readTime(node.getAttribute('dur'), 0) : parent.end);
    timings.set(node, {time, end});
  }
  const lines = all.filter(n => n.localName === 'p').map(p => {
    const timing = timings.get(p);
    const spans = [...p.getElementsByTagName('*')].filter(n => n.localName === 'span' && n.hasAttribute('begin') && ![...n.getElementsByTagName('*')].some(c => c.localName === 'span' && c.hasAttribute('begin')));
    const words = spans.map(span => ({ ...timings.get(span), text: span.textContent }));
    // Preserve whitespace between adjacent timed spans, e.g. Apple's word delivery.
    for (let i=0;i<spans.length-1;i++) {
      let sibling = spans[i].nextSibling, spaces = '';
      while (sibling && sibling !== spans[i+1] && sibling.nodeType === 3) { spaces += sibling.textContent; sibling = sibling.nextSibling; }
      if (spaces && !/\s$/.test(words[i].text)) words[i].text += spaces;
    }
    if (words.some(w => !Number.isFinite(w.time) || !Number.isFinite(w.end) || w.end <= w.time || w.time < 0)) throw new Error('У слов TTML должны быть корректные начало и конец.');
    return {time: p.hasAttribute('begin') ? timing.time : words[0]?.time??timing.time, end: Number.isFinite(timing.end) ? timing.end : words.at(-1)?.end, text: words.length ? words.map(w=>w.text).join('') : p.textContent.trim(), words};
  }).sort((a,b)=>a.time-b.time);
  if (!lines.length || lines.some(l => !Number.isFinite(l.time) || l.time < 0)) throw new Error('В TTML нет строк с корректным временем.');
  return {lines, meta:{ti:all.find(n=>n.localName==='title')?.textContent || '', ar:all.find(n=>n.localName==='desc')?.textContent || ''}};
}
