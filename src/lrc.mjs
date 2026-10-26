export function parseLrc(source) {
  const meta = {};
  const rows = [];
  let offset = 0;
  for (const raw of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const tag = raw.match(/^\[(ar|ti|al|by|offset):([^\]]*)\]/i);
    if (tag) { meta[tag[1].toLowerCase()] = tag[2].trim(); if (tag[1].toLowerCase() === 'offset') offset = (Number(tag[2]) || 0) / 1000; }
    const stamps = [...raw.matchAll(/\[(\d+):(\d{2}(?:[.:]\d+)?)\]/g)];
    if (!stamps.length) continue;
    const content = raw.slice(stamps.at(-1).index + stamps.at(-1)[0].length).trim();
    const wordTags = [...content.matchAll(/<(\d+):(\d{2}(?:[.:]\d+)?)>([^<]*)/g)];
    const words = wordTags.map(m => ({ time: Number(m[1]) * 60 + Number(m[2].replace(':', '.')), text: m[3] }));
    const text = content.replace(/<\d+:\d{2}(?:[.:]\d+)?>/g, '').trim();
    const first=Number(stamps[0][1])*60+Number(stamps[0][2].replace(':','.'));
    for (const stamp of stamps) {
      const time=Number(stamp[1])*60+Number(stamp[2].replace(':','.'));
      rows.push({time,text,words:words.map(w=>({...w,time:w.time+time-first}))});
    }
  }
  rows.forEach(row => { row.time = Math.max(0, row.time - offset); row.words.forEach(w => { w.time = Math.max(0, w.time - offset); }); });
  rows.sort((a, b) => a.time - b.time);
  // Translations with the same timestamp remain together and seek as one line.
  const lines = [];
  for (const row of rows) {
    const prev = lines.at(-1);
    if (prev && Math.abs(prev.time - row.time) < 0.001) { prev.text += '\n' + row.text; prev.words = []; }
    else lines.push(row);
  }
  return { lines, meta };
}

export function activeLine(lines, time) {
  let low = 0, high = lines.length - 1, result = -1;
  while (low <= high) { const mid = (low + high) >>> 1; if (lines[mid].time <= time) { result = mid; low = mid + 1; } else high = mid - 1; }
  return result;
}

export function decodeLyrics(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('windows-1251').decode(bytes); }
}
