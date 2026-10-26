import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLrc, activeLine, decodeLyrics } from '../src/lrc.mjs';

test('LRC: sorts timestamps, supports repeated lines and precision', () => {
  const { lines, meta } = parseLrc('[ar:Исполнитель]\n[00:05.50][00:20.250]Припев\n[00:01:25]Начало\n[00:10]');
  assert.equal(meta.ar, 'Исполнитель');
  assert.deepEqual(lines.map(l => l.time), [1.25, 5.5, 10, 20.25]);
  assert.equal(lines[2].text, '');
  assert.equal(lines[3].text, 'Припев');
});
test('positive LRC offset advances lyrics; offset can occur at end', () => {
  const { lines } = parseLrc('[00:01.50]Слова\n[offset:500]');
  assert.equal(lines[0].time, 1);
  assert.equal(parseLrc('[offset:-500]\n[00:01.50]Слова').lines[0].time, 2);
});
test('enhanced LRC exposes word timing and safe plain text', () => {
  const { lines } = parseLrc('[00:01.00]<00:01.00>Тихий <00:02.00>свет');
  assert.equal(lines[0].text, 'Тихий свет');
  assert.deepEqual(lines[0].words.map(w => w.time), [1, 2]);
  assert.equal(parseLrc('[00:01.00]<script>alert(1)</script>').lines[0].text, '<script>alert(1)</script>');
});
test('translations at the same timestamp stay visible together', () => {
  assert.equal(parseLrc('[00:01.00]Hello\n[00:01.00]Привет').lines[0].text, 'Hello\nПривет');
});
test('active line is correct before start, at boundary, after end and on backward seek', () => {
  const { lines } = parseLrc('[00:02]Первая\n[00:04]Вторая\n[00:06]Третья');
  assert.deepEqual([0, 2, 3.99, 4, 100, 2].map(t => activeLine(lines, t)), [-1, 0, 0, 1, 2, 0]);
  assert.equal(activeLine([], 5), -1);
});
test('UTF-8, UTF-16 and legacy Cyrillic lyrics', () => {
  assert.equal(decodeLyrics(new TextEncoder().encode('Привет').buffer), 'Привет');
  assert.equal(decodeLyrics(Uint8Array.from([255, 254, 31, 4, 64, 4]).buffer), 'Пр');
  assert.equal(decodeLyrics(Uint8Array.from([207, 240, 232, 226, 229, 242]).buffer), 'Привет');
});
