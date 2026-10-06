const fs=require('fs'),vm=require('vm');const ctx={console,Math,Float32Array,Uint32Array,Uint8Array,Map};vm.createContext(ctx);
let s='';for(const f of ['math','world','meshes','outfit','levels','fx','player'])s+=fs.readFileSync(process.argv[2]+'/js/'+f+'.js','utf8')+'\n';
s+=`var Audio={ollie(){},land(){},crash(){},trick(){}};var Cam={shake:0};var GL={time:0};
var Game={onPump(){},onCrash(){},recover(){},onGrind(){},onPress(){},onStomp(){},onFlickTooLow(){},onFlickTooLate(){},onSwitch(){},onPlan(){},onPlanTiming(){}};
const I=(o)=>Object.assign({steer:0,brake:0,tuck:0,jump:false,grab:null,flipFwd:0,flipBack:0},o);
Level.cur=Level.defs.pipe;Level.cur.setLength(1);
function go(label,carve,drift,back){const P=new Player(),fx=new Particles();P.reset(0,150,12);P.invuln=1e9;
  for(let t=0;t<0.6;t+=1/60)P.step(1/60,I({steer:carve}),fx);
  P.step(1/60,I({steer:carve,jump:true,charge:0.6}),fx);
  P.step(1/60,I({}),fx);let t=0,f=0,sp=0;while(P.airborne&&t<4){f=P.flip;sp=P.spin;P.step(1/60,I(t<0.75?{steer:drift,flipBack:back}:{}),fx);t+=1/60;}
  console.log(label.padEnd(44),'flip',(f*57.3|0)+'°','spin',(sp*57.3|0)+'°','air',t.toFixed(2));}
go('carve 0.8 into ollie, then straight back',0.8,0,1);
go('no carve, back + 20% sideways drift',0,0.2,1);
go('no carve, back + 45% sideways drift',0,0.45,1);
go('deliberate diagonal (0.8 side, 0.8 back)',0,0.8,0.8);
go('pure spin, no flip input',0,1,0);`;
vm.runInContext(s,ctx);
