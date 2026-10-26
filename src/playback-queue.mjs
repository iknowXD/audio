export class PlaybackQueue{
  constructor(random=Math.random){this.random=random;this.ids=[];this.order=[];this.current=null;this.shuffle=false;this.repeat='off';}
  setTracks(ids){this.ids=[...ids];this.rebuild();}
  rebuild(){this.order=[...this.ids];if(this.shuffle){for(let i=this.order.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[this.order[i],this.order[j]]=[this.order[j],this.order[i]];}if(this.current&&this.order.includes(this.current))this.order=[this.current,...this.order.filter(id=>id!==this.current)];}}
  select(id){if(this.ids.includes(id))this.current=id;}
  toggleShuffle(){this.shuffle=!this.shuffle;this.rebuild();}
  step(direction=1,automatic=false){
    if(!this.order.length)return null;
    if(automatic&&this.repeat==='one'&&this.current)return this.current;
    let i=this.order.indexOf(this.current);if(i<0)return this.order[0];
    i+=direction;
    if(i>=this.order.length){if(automatic&&this.repeat==='off')return null;return this.order[0];}
    return this.order[(i+this.order.length)%this.order.length];
  }
}
export const fileStem=name=>name.normalize('NFC').replace(/\.[^.]+$/,'').trim().toLocaleLowerCase();
export const isAudio=file=>file.type.startsWith('audio/')||/\.(mp3|flac|m4a|mp4|alac|aac|wav|wave|aiff?|ogg|oga|opus|wma|ape|wv|caf|ac3|mka|webm|dsf|dff|aifc|amr|mp2|m4b)$/i.test(file.name);
export function pairedFile(track,files,trackCount){return files.find(f=>fileStem(f.name)===fileStem(track.name))??(trackCount===1&&files.length===1?files[0]:undefined);}
