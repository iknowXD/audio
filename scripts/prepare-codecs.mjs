import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
const dir = new URL('../public/codecs/', import.meta.url);
await mkdir(dir, { recursive: true });
const base = new URL('../node_modules/@ffmpeg/core/dist/esm/', import.meta.url);
await copyFile(new URL('ffmpeg-core.js', base), new URL('ffmpeg-core.js', dir));
const wasm = await readFile(new URL('ffmpeg-core.wasm', base));
const size = 8 * 1024 * 1024;
const chunks = [];
for (let offset = 0, i = 0; offset < wasm.length; offset += size, i++) {
  const name = `core-${i}.bin`;
  await writeFile(new URL(name, dir), wasm.subarray(offset, offset + size));
  chunks.push(name);
}
await writeFile(new URL('manifest.json', dir), JSON.stringify({ chunks }));
