import {playbackStart} from './timing.mjs';
export function createTimeline(lines,duration=Infinity){
  const entries=lines.map((line,index)=>({index,start:playbackStart(line),end:line.end??(line.words?.length&&Number.isFinite(line.words.at(-1).end)?line.words.at(-1).end:lines[index+1]?.time??duration)})).sort((a,b)=>a.start-b.start);
  let max=-Infinity;
  for(const entry of entries){max=Math.max(max,entry.end);entry.maxEnd=max;}
  return time=>{
    let low=0,high=entries.length;
    while(low<high){const mid=(low+high)>>>1;if(entries[mid].start<=time)low=mid+1;else high=mid;}
    const active=[];
    for(let i=low-1;i>=0&&entries[i].maxEnd>time;i--)if(entries[i].end>time)active.push(entries[i].index);
    return active.sort((a,b)=>a-b);
  };
}
