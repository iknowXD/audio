import test from 'node:test';
import assert from 'node:assert/strict';
import {wordVisualState} from '../src/word-motion.mjs';

test('word onset stays immediate at 30 seconds and late in a long track',()=>{
  for(const start of [1,30,60,180,3600]) {
    const word={time:start,end:start+4};
    assert.equal(wordVisualState(word,start-.01).opacity,0);
    assert.equal(wordVisualState(word,start).progress,0);
    const onset=wordVisualState(word,start+.05);
    assert.equal(onset.opacity,1);
    assert.ok(Math.abs(onset.progress-.0125)<1e-9);
    assert.ok(onset.lift>0);
    assert.equal(wordVisualState(word,start+4).progress,1);
  }
});
test('short words use the same gentle rise as long words',()=>{
  const short=wordVisualState({time:30,end:30.1},30.1);
  const long=wordVisualState({time:30,end:34},30.1);
  assert.equal(short.lift,long.lift);
  assert.ok(short.lift<.07);
  assert.equal(wordVisualState({time:30,end:34},30.7).lift,1.08);
});
test('rewinding resets colour and motion without a pending animation',()=>{
  const word={time:60,end:62};
  wordVisualState(word,61);
  assert.deepEqual(wordVisualState(word,59),{progress:0,opacity:0,lift:0});
});
