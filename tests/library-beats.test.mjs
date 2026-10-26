import test from 'node:test';import assert from 'node:assert/strict';
import {PlaybackQueue,pairedFile} from '../src/playback-queue.mjs';
import {BeatEnvelope} from '../src/beat-envelope.mjs';
test('queue: previous/next, repeat one on natural end, repeat all and stop',()=>{const q=new PlaybackQueue();q.setTracks(['a','b','c']);q.select('b');assert.equal(q.step(), 'c');assert.equal(q.step(-1),'a');q.select('c');assert.equal(q.step(1,true),null);q.repeat='all';assert.equal(q.step(1,true),'a');q.repeat='one';assert.equal(q.step(1,true),'c');assert.equal(q.step(1,false),'a');});
test('shuffle visits each song once and previous follows that order',()=>{const q=new PlaybackQueue(()=>.3);q.setTracks(['a','b','c','d']);q.select('b');q.toggleShuffle();const order=[q.current];for(let i=0;i<3;i++){q.select(q.step());order.push(q.current);}assert.equal(new Set(order).size,4);assert.equal(q.step(-1),order[2]);assert.equal(q.step(1,true),null);q.toggleShuffle();assert.deepEqual(q.order,['a','b','c','d']);});
test('file pairing never attaches another songs lyrics arbitrarily in a batch',()=>{const files=[{name:'Second.TTML'},{name:'First.lrc'}];assert.equal(pairedFile({name:'FIRST.mp3'},files,2),files[1]);assert.equal(pairedFile({name:'Other.mp3'},files,2),undefined);assert.equal(pairedFile({name:'Other.mp3'},files.slice(0,1),1),files[0]);});
test('bass attack uses 30–180 Hz at both sample rates and decays in silence',()=>{for(const rate of [44100,48000]){const beat=new BeatEnvelope(),spectrum=new Float32Array(1024).fill(-Infinity);for(let i=0;i<60;i++)assert.equal(beat.read(spectrum,rate,2048,1/60).kick,0);spectrum[Math.round(60*2048/rate)]=-18;assert.ok(beat.read(spectrum,rate,2048,1/60).kick>.9);spectrum.fill(-Infinity);let state;for(let i=0;i<90;i++)state=beat.read(spectrum,rate,2048,1/60);assert.ok(state.kick<.01);assert.ok(state.level<.01);spectrum[Math.round(1000*2048/rate)]=-3;assert.ok(beat.read(spectrum,rate,2048,1/60).kick<.01);}});
test('quiet bass and broadband rustle never normalize themselves into a beat',()=>{
 for(const kind of ['bass','rustle']){const beat=new BeatEnvelope(),s=new Float32Array(1024).fill(-Infinity);for(let frame=0;frame<600;frame++){s.fill(kind==='rustle'?-65:-Infinity);if(frame%30<3)s[3]=-55;assert.equal(beat.read(s,48000,2048,1/60).kick,0);}}
});
test('a small increase over the established bass stays still; a strong accent reacts',()=>{
 const b=new BeatEnvelope(),s=new Float32Array(1024).fill(-Infinity);s[3]=-35;
 for(let i=0;i<300;i++)b.read(s,48000,2048,1/60);
 s[3]=-32;assert.ok(b.read(s,48000,2048,1/60).kick<.01);
 s[3]=-20;assert.ok(b.read(s,48000,2048,1/60).kick>.5);
});
test('a quieter section is still compared to the loud part of the song',()=>{
 const b=new BeatEnvelope(),s=new Float32Array(1024).fill(-Infinity);s[3]=-6;
 for(let i=0;i<120;i++)b.read(s,48000,2048,1/60);
 s.fill(-Infinity);for(let i=0;i<180;i++)b.read(s,48000,2048,1/60);
 s[3]=-35;assert.ok(b.read(s,48000,2048,1/60).kick<.01);
});
