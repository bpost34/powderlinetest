const fs=require('fs'),vm=require('vm');const ctx={console,Math,Float32Array,Uint32Array,Uint8Array,Map};vm.createContext(ctx);
let s='';for(const f of ['math','world','meshes','outfit','levels','fx','player'])s+=fs.readFileSync(process.argv[2]+'/js/'+f+'.js','utf8')+'\n';
s+=`var Audio={ollie(){},land(){},crash(){},trick(){}};var Cam={shake:0};var GL={time:0};
var Game={onPump(){},onCrash(){},recover(){},onGrind(){},onPress(){},onStomp(){},onFlickTooLow(){},onFlickTooLate(){},onSwitch(){},onPlan(){},onPlanTiming(){}};
const I=(o)=>Object.assign({steer:0,brake:0,tuck:0,jump:false,grab:null,flipFwd:0,flipBack:0},o);
Level.cur=Level.defs.mountain;Level.cur.setLength(2);World.reset&&World.reset();
function run(label,pump,tuck,T=120){const P=new Player(),fx=new Particles();P.reset(centerX(60),60,8);P.invuln=1e9;let mx=0,t=0,sum=0,n=0,pumps=0;Game.onPump=()=>pumps++;
  for(;t<T;t+=1/60){const cx=centerX(P.pos.z+15);const want=Math.atan2(cx-P.pos.x,15);const steer=clamp(-(want-P.yaw)*2.5,-1,1);
    P.step(1/60,I({steer,tuck,pump:pump&&((t*60|0)%6===0)}),fx);if(t>10){mx=Math.max(mx,P.speed);sum+=P.speed;n++;}}
  console.log(label.padEnd(26),'max',(mx*3.6).toFixed(0),'km/h  avg',(sum/n*3.6).toFixed(0),'km/h  z',P.pos.z.toFixed(0),'pumps',pumps);}
run('cruise',false,0);run('tuck',false,1);run('pump spam',true,0);run('tuck + pump spam',true,1);`;
vm.runInContext(s,ctx);
