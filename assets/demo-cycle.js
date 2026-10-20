// A single owner of the rig: a visible, coordinated 9-second demonstration.
const keys=['slew','boom','stick','bucket'];
const frames=[
 {time:0,pose:{slew:0,boom:0,stick:0,bucket:0}},
 {time:1.7,pose:{slew:0,boom:-9,stick:5,bucket:9}},
 {time:3.7,pose:{slew:-12,boom:-9,stick:9,bucket:20}},
 {time:5.3,pose:{slew:-12,boom:-5,stick:6,bucket:6}},
 {time:8,pose:{slew:0,boom:0,stick:0,bucket:0}},
 {time:9,pose:{slew:0,boom:0,stick:0,bucket:0}}
];
const mix=(a,b,t)=>{const e=t*t*(3-2*t);return Object.fromEntries(keys.map(k=>[k,a[k]+(b[k]-a[k])*e]));};
export function createDemoCycle(rig){
 let active=false,time=0,entry=null,last=null;
 function start(){
  const current=rig.getPose();
  if(!last||keys.some(k=>Math.abs(current[k]-last[k])>1e-7)){
   time=0;entry={from:current,duration:Math.max(1,Math.abs(current.slew)/30),time:0};last={...current};
   if(keys.every(k=>Math.abs(current[k])<1e-7))entry=null;
  }
  active=true;
 }
 function stop(){active=false;}
 function update(delta){
  if(!Number.isFinite(delta)||delta<0)throw new RangeError('Invalid delta');
  if(!active||!delta)return {ok:true,changed:false};
  let pose;
  if(entry){entry.time+=delta;const t=Math.min(entry.time/entry.duration,1);pose=mix(entry.from,frames[0].pose,t);if(t===1){time=entry.time-entry.duration;entry=null;}}
  else{time=(time+delta)%9;const i=frames.findIndex((f,j)=>j<frames.length-1&&time>=f.time&&time<frames[j+1].time);const a=frames[i],b=frames[i+1];pose=mix(a.pose,b.pose,(time-a.time)/(b.time-a.time));}
  try{const result=rig.setPose(pose);if(!result?.ok){stop();return {ok:false,changed:false};}last={...pose};return {...result,changed:true};}
  catch(error){stop();return {ok:false,changed:false,reason:error.message};}
 }
 return {start,stop,update,get active(){return active;}};
}
