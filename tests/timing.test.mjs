import test from 'node:test';
import assert from 'node:assert/strict';
import {formatTime,parseTime,lineRange,retimeLine,exportLrc,PlaybackClock,playbackStart,activePlaybackLine} from '../src/timing.mjs';
import {projectFromLrc,exportTtml} from '../src/timed-lyrics.mjs';
import {parseLrc} from '../src/lrc.mjs';
test('editor and player use minute clock including comma decimals and hour input',()=>{
  assert.equal(formatTime(83.45),'01:23.450');assert.equal(parseTime('01:23.450'),83.45);
  assert.equal(parseTime('01:23,450'),83.45);assert.equal(parseTime('01:02:03.250'),3723.25);
  assert.ok(Number.isNaN(parseTime('83.45')));assert.ok(Number.isNaN(parseTime('01:72.000')));
  assert.equal(formatTime(59.9999),'01:00.000');assert.equal(parseTime(formatTime(0)),0);
});
test('LRC line can be shifted and shortened without invented word timing',()=>{
  const p=projectFromLrc(parseLrc('[00:02]Тихий свет\n[00:10]Новая строка'));p.duration=20;
  assert.deepEqual(lineRange(p,0),{start:2,end:10});
  const changed=retimeLine(p,0,3,7);assert.equal(changed.time,3);assert.equal(changed.end,7);
  assert.equal(changed.words[0].time,null);assert.equal(p.lines[0].time,2);assert.equal(p.lines[1].time,10);
});
test('changing line tempo scales both word endpoints and preserves internal gaps',()=>{
  const p={duration:20,lines:[{time:2,end:10,words:[{text:'a ',time:2,end:4},{text:'b',time:6,end:10}]}]};
  const changed=retimeLine(p,0,2,6);
  assert.deepEqual(changed.words.map(w=>[w.time,w.end]),[[2,3],[4,6]]);
  assert.throws(()=>retimeLine(p,0,0,30),/конец песни/);
});
test('LRC export preserves explicit line end as an instrumental gap',()=>{
  const p=projectFromLrc(parseLrc('[00:02]Тихий свет\n[00:10]Новая строка'));p.duration=20;p.lines[0]=retimeLine(p,0,3,7);
  const round=projectFromLrc(parseLrc(exportLrc(p)));
  assert.equal(round.lines[0].time,3);assert.equal(round.lines[0].end,7);assert.equal(round.lines[1].time,10);
});
test('TTML export keeps line start before the first word instead of delaying the line',()=>{
  const p={version:1,title:'',artist:'',language:'ru',duration:20,lines:[{time:2,end:8,text:'Свет',words:[{text:'Свет',time:2.8,end:7,estimated:false}]}]};
  const xml=exportTtml(p);assert.match(xml,/<p begin="00:00:02.000" end="00:00:08.000">/);assert.match(xml,/<span begin="00:00:02.800"/);
});
test('repeated enhanced LRC timestamps shift repeated words with the line',()=>{
  const {lines}=parseLrc('[00:02][00:12]<00:02.50>Свет <00:03.00>здесь');
  assert.deepEqual(lines.map(l=>l.words.map(w=>w.time)),[[2.5,3],[12.5,13]]);
});
test('clock smooths coarse samples without cumulative drift or paused movement',()=>{
  const c=new PlaybackClock();assert.equal(c.read(2,0),2);assert.equal(c.read(2,20),2.02);
  assert.equal(c.read(2,1000),2.08);assert.equal(c.read(2,50000),2.08);
  assert.equal(c.read(2.1,50010),2.1);assert.equal(c.read(2.1,50030),2.12);
  assert.equal(c.read(2.1,50100,{running:false}),2.1);assert.equal(c.read(2.1,70000,{running:false}),2.1);
});
test('clock reanchors on backwards seeking, rate changes and buffering',()=>{
  const c=new PlaybackClock();c.read(5,0);c.read(5,50);
  assert.equal(c.read(1,100,{seeking:true}),1);assert.equal(c.read(1,120,{rate:.5}),1);
  assert.equal(c.read(1,160,{rate:.5}),1.02);assert.equal(c.read(1,300,{running:false,rate:.5}),1);
  c.reset();assert.equal(c.read(12,1000),12);
});
test('karaoke follows word onset while preserving an earlier paragraph marker',()=>{
  const lines=[
    {time:39.36,end:44.414,words:[{time:39.771,end:40.226}]},
    {time:186.41,end:197.438,words:[{time:189.375,end:190}]}
  ];
  assert.equal(playbackStart(lines[0]),39.771);
  assert.equal(activePlaybackLine(lines,39.5),-1);
  assert.equal(activePlaybackLine(lines,39.771),0);
  assert.equal(activePlaybackLine(lines,187),0);
  assert.equal(activePlaybackLine(lines,189.375),1);
  assert.equal(activePlaybackLine(lines,40),0);
  assert.equal(lines[1].time,186.41);
});
test('plain LRC and unrecorded editor words keep their line timing',()=>{
  const lines=[{time:2,words:[]},{time:10,words:[{time:null,end:null}]}];
  assert.equal(playbackStart(lines[1]),10);
  assert.equal(activePlaybackLine(lines,9.99),0);
  assert.equal(activePlaybackLine(lines,10),1);
});
test('word order selection handles paragraph markers in a different order',()=>{
  const lines=[{time:2,words:[{time:8}]},{time:3,words:[{time:5}]}];
  assert.equal(activePlaybackLine(lines,6),1);
  assert.equal(activePlaybackLine(lines,9),0);
});
