const fs=require('fs'),vm=require('vm');let __s=12345;const SM=Object.create(Math);SM.random=()=>{__s=(__s*1103515245+12345)%2147483648;return __s/2147483648};const ctx={console,Math:SM,Float32Array,Uint32Array,Uint8Array,Map};vm.createContext(ctx);
let s='';for(const f of ['math','world','meshes','outfit','levels','fx','player'])s+=fs.readFileSync(process.argv[2]+'/js/'+f+'.js','utf8')+'\n';
s+=`var Audio={ollie(){},land(){},crash(){},trick(){}};var Cam={shake:0};var GL={time:0};var Game={onPump(){},onCrash(){},recover(){},onGrind(){}};
const I=(o)=>Object.assign({steer:0,brake:false,tuck:false,jump:false,grab:null,flipFwd:false,flipBack:false},o);
function run(lv,tuck,secs,ollie){Level.cur=Level.defs[lv];if(World.reset)World.reset();const P=new Player(),fx=new Particles();
 P.reset(centerX(Level.cur.spawnZ||10),Level.cur.spawnZ||10,Level.cur.spawnSpeed||10);const dt=1/60;let launches=[],cur=null;
 for(let i=0;i<secs*60;i++){const a=P.airborne;
   // steer toward centre line so we stay on the run and hit features
   let cx=centerX(P.pos.z+8);if(Level.cur.id!=="park"){const sg=Math.floor((P.pos.z+20)/SEG);for(const q of [sg,sg+1]){const k=featureAt(q);if(k&&k.z>P.pos.z-5){cx=k.x;break;}}}const want=Math.atan2(cx-P.pos.x,8);let d=want-P.yaw;d=Math.atan2(Math.sin(d),Math.cos(d));
   let J=false;if(ollie&&!P.airborne){const sg=Math.floor((P.pos.z+20)/SEG);for(const q of [sg-1,sg,sg+1]){const k=featureAt(q);if(k&&k.kind==='kicker'&&P.pos.z>k.z-1.5&&P.pos.z<k.z+0.5&&!k._j){k._j=1;J=true;}}}
   P.step(dt,I({tuck:tuck||ollie,jump:J,charge:0.6,steer:Math.max(-1,Math.min(1,-d*3))}),fx);
   if(!a&&P.airborne){cur={z:P.pos.z|0,vy:P.vel.y,sp:P.speed,maxH:0,t:0};launches.push(cur);}
   if(P.airborne&&cur){cur.t+=dt;cur.maxH=Math.max(cur.maxH,P.pos.y-heightAt(P.pos.x,P.pos.z));}
   if(P.crashTimer>0&&cur&&!cur.crash)cur.crash=1;}
 const big=launches.filter(l=>l.maxH>0.35);
 return {lv,z:P.pos.z|0,sp:+P.speed.toFixed(1),tuck,n:launches.length,over35cm:big.length,top:big.sort((a,b)=>b.maxH-a.maxH).slice(0,4).map(l=>({z:l.z,sp:+l.sp.toFixed(1),vy:+l.vy.toFixed(2),h:+l.maxH.toFixed(2),t:+l.t.toFixed(2),c:l.crash||0}))};}
for(const lv of ['mountain','zen','park'])for(const t of [false,true])console.log(JSON.stringify(run(lv,t,90)));
_featCache.clear();console.log('OLLIE AT KICKER PEAKS',JSON.stringify(run('mountain',false,90,true)));
`;vm.runInContext(s,ctx);
