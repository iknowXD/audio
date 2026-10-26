import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import ffmpeg from 'ffmpeg-static';
mkdirSync('artifacts/test-files', { recursive: true });
const base = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=24:sample_rate=44100'];
for (const [ext, codec] of [['wav','pcm_s16le'],['mp3','libmp3lame'],['flac','flac'],['m4a','alac'],['aiff','pcm_s16be'],['wma','wmav2'],['ogg','libvorbis'],['aac','aac']]) {
  execFileSync(ffmpeg, [...base, '-c:a', codec, '-metadata', 'title=Ночной свет', '-metadata', 'artist=Проверка плеера', `artifacts/test-files/test.${ext}`]);
}
writeFileSync('artifacts/test-files/test.lrc', '[ti:Ночной свет]\n[ar:Проверка плеера]\n[00:00.00]Город засыпает\n[00:03.00]Тише едут поезда\n[00:06.00]В окнах остаётся свет\n[00:09.00]Музыка ведёт меня\n[00:12.00]Где-то далеко рассвет\n[00:15.00]Каждый звук — как новый шаг\n[00:18.00]Этот ритм останется\n[00:21.00]Всё звучит на своих местах');
writeFileSync('artifacts/test-files/invalid.lrc', 'Обычный текст без временных меток');
writeFileSync('artifacts/test-files/broken.mp3', 'not an audio file');
console.log('Created audio and lyric fixtures in artifacts/test-files');
