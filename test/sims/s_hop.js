const fs=require('fs'),vm=require('vm');
function run(dir){let __s=12345;const SM=Object.create(Math);SM.random=()=>{__s=(__s*1103515245+12345)%2147483648;return __s/2147483648};const ctx={console,Math:SM,Float32Array,Uint32Array,Uint8Array,Map};vm.createContext(ctx);
let s='';for(const f of ['math','world','meshes','outfit','levels','fx','player'])s+=fs.readFileSync(dir+'/js/'+f+'.js','utf8')+'\n';
s+=`var Audio={ollie(){},land(){},crash(){},trick(){}};var Cam={shake:0};var GL={time:0};var crashes=0;var Game={onPump(){},onCrash(){crashes++},recover(){},onGrind(){}};
const out=[];
for(const [lv,z0,steerYaw] of [['mountain',0,0],['park',4,0]]){Level.cur=Level.defs[lv];
 for(const offset of [0,0.5,0.9]){   // board yaw offset at take-off (sloppy hops)
  const P=new Player(),fx=new Particles();P.reset(centerX(z0),z0,12);P.invuln=0;const dt=1/60;crashes=0;
  for(let i=0;i<90;i++)P.step(dt,{steer:0,brake:false,tuck:false,jump:false,grab:null},fx);
  P.step(dt,{steer:0,brake:false,tuck:false,jump:true,grab:null},fx);
  const v0=P.speed; P.yaw+=offset;               // rider twisted the board in the air
  let landed=false;for(let i=0;i<200;i++){const a=P.airborne;P.step(dt,{steer:0,brake:false,tuck:false,jump:false,grab:null},fx);if(a&&!P.airborne){landed=true;break;}}
  out.push(lv+' yawOff '+offset+': speed '+v0.toFixed(1)+' -> '+P.speed.toFixed(1)+' ('+Math.round(100*P.speed/v0)+'%) crash='+crashes);
 }}
console.log(out.join('\\n'));`;vm.runInContext(s,ctx);}
console.log('--- OLD');run(process.argv[2]);console.log('--- NEW');run(process.argv[3]);
