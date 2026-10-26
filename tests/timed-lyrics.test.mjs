import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { parseLrc } from '../src/lrc.mjs';
import { tokenize, projectFromLrc, validateProject, exportTtml, wordProgress, clockTime } from '../src/timed-lyrics.mjs';
const fixture = () => ({version:1,title:'Свет & тень <live>',artist:'Автор',language:'ru',duration:12,lines:[{time:1,text:'Свет & тень',words:[{text:'Свет & ',time:1,end:2,estimated:false},{text:'тень',time:2.5,end:4,estimated:false}]}]});
test('word mask follows audio clock, freezes in gaps and reverses after seek',()=>{
  const w={time:2,end:4};
  assert.deepEqual([0,2,3,4,9,2.5].map(t=>wordProgress(w,t)),[0,0,.5,1,1,.25]);
  assert.equal(wordProgress({time:null,end:null},3),0);
  assert.equal(wordProgress({time:3,end:3},3),0);
});
test('tokenization keeps punctuation, Unicode and spacing without invented timing',()=>{
  const text='Свет,  тень!'; const words=tokenize(text);
  assert.equal(words.map(w=>w.text).join(''),text);
  assert.equal(words[0].time,null);assert.equal(words[0].end,null);
});
test('LRC translations are alternatives rather than consecutive words',()=>{
  const p=projectFromLrc(parseLrc('[00:02]Hello world\n[00:02]Привет мир\n[00:05]Next'));
  assert.equal(p.lines[0].text,'Hello world');assert.equal(p.lines[0].alternatives.length,2);
  assert.equal(p.lines[0].words.length,2);assert.ok(validateProject(p).length);
});
test('export rejects unfinished and estimated words rather than fabricating timestamps',()=>{
  const p=fixture();p.lines[0].words[0].end=null;
  assert.throws(()=>exportTtml(p),/начало и конец/);
  p.lines[0].words[0].end=2;p.lines[0].words[0].estimated=true;
  assert.throws(()=>exportTtml(p),/приблизительный/);
});
test('validation catches overlaps, invalid duration, nonfinite and out-of-song timestamps',()=>{
  const p=fixture();assert.deepEqual(validateProject(p),[]);
  p.lines[0].words[1].time=1.5;assert.ok(validateProject(p).length);
  p.lines[0].words[1].time=2.5;p.lines[0].words[1].end=13;assert.ok(validateProject(p).length);
  p.lines[0].words[1].end=NaN;assert.ok(validateProject(p).length);
});
test('TTML is valid XML, preserves whitespace and contains millisecond word ranges',()=>{
  const xml=exportTtml(fixture());
  const output=execFileSync('python3',['-c',`import sys,json,xml.etree.ElementTree as ET\nr=ET.fromstring(sys.stdin.read());ns={'t':'http://www.w3.org/ns/ttml','m':'http://www.w3.org/ns/ttml#metadata'};words=r.findall('.//t:span',ns);print(json.dumps({'title':r.find('.//m:title',ns).text,'words':[w.text for w in words],'begin':words[0].attrib['begin'],'end':words[1].attrib['end']}))`],{input:xml,encoding:'utf8'});
  assert.deepEqual(JSON.parse(output),{title:'Свет & тень <live>',words:['Свет & ','тень'],begin:'00:00:01.000',end:'00:00:04.000'});
});
test('clock formatting carries milliseconds across minute boundaries',()=>{
  assert.equal(clockTime(59.9999),'00:01:00.000');assert.equal(clockTime(3661.125),'01:01:01.125');
});
test('partial JSON project retains explicit gaps without losing zero timestamps',()=>{
  const p=fixture();p.lines[0].words[0].time=0;const roundtrip=JSON.parse(JSON.stringify(p));
  assert.deepEqual(validateProject(roundtrip,false),[]);assert.equal(roundtrip.lines[0].words[1].time,2.5);
});
