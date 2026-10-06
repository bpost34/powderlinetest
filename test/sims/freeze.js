const fs=require('fs'),vm=require('vm');const ctx={console,Math,Float32Array,Uint32Array,Uint8Array,Map};vm.createContext(ctx);
let s='';for(const f of ['math','world','meshes','outfit','levels','fx','player'])s+=fs.readFileSync(process.argv[2]+'/js/'+f+'.js','utf8')+'\n';
s+=`var Audio={ollie(){},land(){},crash(){},trick(){}};var Cam={shake:0};var GL={time:0};
var Game={onPump(){},onCrash(){},recover(){},onGrind(){},onPress(){},onStomp(){},onFlickTooLow(){},onFlickTooLate(){},onSwitch(){},onPlan(){},onPlanTiming(){}};
const I=(o)=>Object.assign({steer:0,brake:0,tuck:0,jump:false,grab:null,flipFwd:0,flipBack:0},o);
Level.cur=Level.defs.pipe;Level.cur.setLength(0);
const D={x:0,y:1},R={x:1,y:0};
for(const [label,v,fl] of [['360',7,[R]],['1080 + backflip',9,[R,R,R,D]],['triple cork 1440',11,[R,R,R,R,D,D,D]]]){
  const P=new Player(),fx=new Particles();const lip=PIPE.B+PIPE.R;P.reset(0,150,12);
  for(const f of fl)P.step(1/60,I({flick:f}),fx);for(let t=0;t<0.5;t+=1/60)P.step(1/60,I({}),fx);
  P.pos.x=lip-0.4;P.yaw=Math.PI/2;P.updateBasis();P.vel.x=v;P.vel.z=10;P.pos.y=heightAt(P.pos.x,P.pos.z)+0.3;pipeLipLaunch(P,0,PIPE.B,PIPE.R,1);
  const prof=[];let t=0,lastS=P.spin,lastF=P.flip;while(P.airborne&&t<6){P.step(1/60,I({}),fx);t+=1/60;
    if(P.airborne){prof.push([t,Math.abs(P.spin-lastS)*60,Math.abs(P.flip-lastF)*60]);lastS=P.spin;lastF=P.flip;}}
  const pick=(f)=>{const p=prof[Math.min(prof.length-1,Math.floor(prof.length*f))];return Math.round(p[1]*57.3)+'/'+Math.round(p[2]*57.3);};
  console.log(label.padEnd(18),'air',t.toFixed(2)+'s  spin/flip °/s at 10%:',pick(0.1),' 50%:',pick(0.5),' 90%:',pick(0.9),' last frame:',pick(0.999),P.crashTimer>0?'CRASH':'clean');}
`;vm.runInContext(s,ctx);
