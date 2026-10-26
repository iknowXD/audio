const clamp=n=>Math.max(0,Math.min(1,n));
export class BeatEnvelope{
 constructor(){this.reset();}
 reset(){this.average=0;this.loudness=0;this.trackPeak=0;this.fast=0;this.kick=0;this.age=0;this.cooldown=0;}
 read(spectrum,sampleRate,fftSize,dt){
  dt=Math.min(.1,Math.max(.001,dt));this.age+=dt;this.cooldown=Math.max(0,this.cooldown-dt);
  const lo=Math.max(1,Math.ceil(30*fftSize/sampleRate)),hi=Math.min(spectrum.length-1,Math.ceil(180*fftSize/sampleRate));
  let lowPower=0,totalPower=0;
  for(let i=1;i<spectrum.length;i++){
    const power=Number.isFinite(spectrum[i])?10**(spectrum[i]/10):0;
    totalPower+=power;if(i>=lo&&i<=hi)lowPower+=power;
  }
  const bass=Math.sqrt(lowPower),total=Math.sqrt(totalPower);
  // Keep the song's recent loudness as a reference instead of boosting every
  // quiet passage to full scale. The absolute floor also rejects tiny sounds.
  this.trackPeak=Math.max(total,this.trackPeak*Math.exp(-dt/20));
  const threshold=Math.max(.01,this.average*1.8,this.loudness*.4,this.trackPeak*.12);
  const prominent=lowPower>totalPower*.16;
  let hit=0;
  if(this.age>.35&&this.cooldown===0&&prominent&&bass>threshold&&bass>this.fast*1.3){
    hit=clamp((bass-threshold)/Math.max(.015,threshold*1.5));
    if(hit>.08)this.cooldown=.24;else hit=0;
  }
  this.kick=Math.max(this.kick*Math.exp(-dt/.28),hit);
  this.average+=(bass-this.average)*(1-Math.exp(-dt/1.5));
  this.loudness+=(total-this.loudness)*(1-Math.exp(-dt/2.5));
  this.fast+=(bass-this.fast)*(1-Math.exp(-dt/.06));
  return {kick:this.kick,level:this.kick};
 }
}
