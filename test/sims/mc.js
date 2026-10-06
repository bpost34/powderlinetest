const fs=require('fs'),vm=require('vm');const ctx={console,Math,Float32Array,Uint32Array,Uint8Array,Map};vm.createContext(ctx);
let s='';for(const f of ['math','world','meshes','outfit','levels','fx','player'])s+=fs.readFileSync(process.argv[2]+'/js/'+f+'.js','utf8')+'\n';
s+=`var Audio={ollie(){},land(){},crash(){},trick(){}};var Cam={shake:0};var GL={time:0};
var Game={onPump(){},onCrash(){},recover(){},onGrind(){},onPress(){},onStomp(){},onFlickTooLow(){},onFlickTooLate(){},onSwitch(){},onPlan(){},onPlanTiming(){}};
const I=(o)=>Object.assign({steer:0,brake:0,tuck:0,jump:false,grab:null,flipFwd:0,flipBack:0},o);
Level.cur=Level.defs.pipe;Level.cur.setLength(0);
const U={x:0,y:-1},D={x:0,y:1},R={x:1,y:0};
function once(vOut,flicks,lead){const P=new Player(),fx=new Particles();const lip=PIPE.B+PIPE.R;P.reset(0,150,12);P.invuln=0;
  for(const f of flicks)P.step(1/60,I({flick:f}),fx);
  for(let t=0;t<lead;t+=1/60)P.step(1/60,I({}),fx);
  P.pos.x=lip-0.4;P.yaw=Math.PI/2;P.updateBasis();P.vel.x=vOut;P.vel.z=10;P.pos.y=heightAt(P.pos.x,P.pos.z)+0.3;pipeLipLaunch(P,0,PIPE.B,PIPE.R,1);
  let t=0;while(P.airborne&&t<6){P.step(1/60,I({}),fx);t+=1/60;}return P.crashTimer<=0;}
function rate(label,vOut,flicks,lead,n=150){let ok=0;for(let i=0;i<n;i++)if(once(vOut,flicks,lead))ok++;console.log(label.padEnd(44),Math.round(ok/n*100)+'% land');}
rate('360, small air, perfect',6,[R],0.5);
rate('1080, mid air (5.6 m), perfect',8,[R,R,R],0.5);
rate('1080 + backflip, mid air, perfect',8,[R,R,R,D],0.5);
rate('1080 + backflip, mid air, rushed',8,[R,R,R,D],0.05);
rate('double backflip, mid air, perfect',8,[D,D],0.5);
rate('triple cork 1440 @7.6 m, perfect',11,[R,R,R,R,D,D,D],0.5);
rate('triple cork 1440 @7.6 m, rushed',11,[R,R,R,R,D,D,D],0.05);
rate('triple cork 1440 @7.6 m, hesitant',11,[R,R,R,R,D,D,D],1.3);
rate('1080 + backflip @7.6 m, perfect',11,[R,R,R,D],0.5);
`;vm.runInContext(s,ctx);
