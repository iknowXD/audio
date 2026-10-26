import { FFmpeg } from '@ffmpeg/ffmpeg';

let engine;
let ready;
export async function decodeAudio(file, onProgress) {
  if (!engine) engine = new FFmpeg();
  if (!ready) ready = (async () => {
    onProgress('Подготавливаю аудиодвижок…');
    const manifestResponse = await fetch('/codecs/manifest.json', { signal: AbortSignal.timeout(20000) });
    if (!manifestResponse.ok) throw new Error('Не удалось загрузить аудиодвижок. Проверь соединение.');
    const { chunks } = await manifestResponse.json();
    let loaded = 0;
    onProgress('Загружаю аудиодвижок… 0%');
    const parts = await Promise.all(chunks.map(async name => {
      const r = await fetch(`/codecs/${name}`, { signal: AbortSignal.timeout(45000) }); if (!r.ok) throw new Error('Не удалось загрузить аудиодвижок.'); const part = await r.arrayBuffer(); loaded++; onProgress(`Загружаю аудиодвижок… ${Math.round(loaded / chunks.length * 100)}%`); return part;
    }));
    onProgress('Запускаю аудиодвижок…');
    const wasmURL = URL.createObjectURL(new Blob(parts, { type: 'application/wasm' }));
    let timeout;
    try { await Promise.race([engine.load({ coreURL: new URL('/codecs/ffmpeg-core.js', location.origin).href, wasmURL }), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Аудиодвижок не запустился. Попробуй открыть сайт в Chrome или Safari.')), 45000); })]); }
    finally { clearTimeout(timeout); URL.revokeObjectURL(wasmURL); }
  })().catch(error => { engine.terminate(); engine = undefined; ready = undefined; throw error; });
  await ready;
  onProgress('Подготавливаю песню к воспроизведению…');
  const ext = file.name.split('.').at(-1).replace(/[^a-z0-9]/gi, '') || 'audio';
  const input = `input.${ext}`;
  const progress = ({ progress }) => { if (progress > 0 && progress <= 1) onProgress(`Подготавливаю песню… ${Math.round(progress * 100)}%`); };
  engine.on('progress', progress);
  try {
    await engine.writeFile(input, new Uint8Array(await file.arrayBuffer()));
    const code = await engine.exec(['-i', input, '-map', '0:a:0', '-vn', '-c:a', 'pcm_s16le', '-f', 'wav', 'output.wav']);
    if (code !== 0) throw new Error('Не удалось прочитать звук. Возможно, файл повреждён или защищён.');
    const output = await engine.readFile('output.wav');
    return new Blob([output], { type: 'audio/wav' });
  } finally {
    engine.off('progress', progress);
    await engine.deleteFile(input).catch(() => {});
    await engine.deleteFile('output.wav').catch(() => {});
  }
}
