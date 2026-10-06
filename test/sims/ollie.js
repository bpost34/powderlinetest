const fs=require('fs'),vm=require('vm');const ctx={console,Math,Float32Array,Uint32Array,Uint8Array,Map};vm.createContext(ctx);
let s='';for(const f of ['math','world','meshes','outfit','levels','fx','player'])s+=fs.readFileSync(process.argv[2]+'/js/'+f+'.js','utf8')+'\n';
s+=`var Audio={ollie(){},land(){},crash(){},trick(){}};var Cam={shake:0};var GL={time:0};
var Game={onPump(){},onCrash(){},recover(){},onGrind(){},onPress(){},onStomp(){},onFlickTooLow(){},onFlickTooLate(){},onSwitch(){},onPlan(){},onPlanTiming(){}};
const I=(o)=>Object.assign({steer:0,brake:0,tuck:0,jump:false,grab:null,flipFwd:0,flipBack:0},o);
Level.cur=Level.defs.mountain;Level.cur.setLength(0);
function go(label,charge,pumpFirst,v0=12){const P=new Player(),fx=new Particles();P.reset(centerX(140),140,v0);P.invuln=1e9;
  for(let t=0;t<0.5;t+=1/60)P.step(1/60,I({}),fx);
  if(pumpFirst){P.load=1.3;P.step(1/60,I({pump:true}),fx);P.step(1/60,I({}),fx);}
  P.step(1/60,I({jump:true,charge}),fx);
  if(!P.airborne){console.log(label,'NO OLLIE');return;}
  const y0=P.pos.y;let rise=0,agl=0,t=0;while(P.airborne&&t<5){P.step(1/60,I({}),fx);t+=1/60;rise=Math.max(rise,P.pos.y-y0);agl=Math.max(agl,P.pos.y-RIDE_H-heightAt(P.pos.x,P.pos.z));}
  console.log(label.padEnd(30),'rise',rise.toFixed(2),'m  above snow',agl.toFixed(2),'m  air',t.toFixed(2),'s');}
go('tap (0.03 s)',0.03);go('hold 0.3 s',0.3);go('hold 0.6 s (max)',0.6);go('hold 2 s',2);go('tap @ 6 m/s',0.03,false,6);go('max @ 6 m/s',0.6,false,6);
// releasing during a pump cooldown (used to be swallowed)
{const P=new Player(),fx=new Particles();P.reset(centerX(140),140,12);P.invuln=1e9;for(let t=0;t<0.5;t+=1/60)P.step(1/60,I({}),fx);P.pumpCooldown=0.3;P.step(1/60,I({jump:true,charge:0.2}),fx);console.log('release during pump cooldown -> airborne:',P.airborne);}`;
vm.runInContext(s,ctx);
