const fs=require('fs'),vm=require('vm');let __s=12345;const SM=Object.create(Math);SM.random=()=>{__s=(__s*1103515245+12345)%2147483648;return __s/2147483648};const ctx={console,Math:SM,Float32Array,Uint32Array,Uint8Array,Map};vm.createContext(ctx);
let s='';for(const f of ['math','world','meshes','outfit','levels','fx','player'])s+=fs.readFileSync(process.argv[2]+'/js/'+f+'.js','utf8')+'\n';
s+=`var Audio={ollie(){},land(){},crash(){},trick(){}};var Cam={shake:0};var GL={time:0};var crashes=0,grinds=[];
var Game={onPump(){},onCrash(){crashes++},recover(){},onGrind(t,a){grinds.push(t.toFixed(2)+'s@'+(a*57).toFixed(0)+'deg')}};
function ride(levelId, controller, secs){
  Level.cur=Level.defs[levelId];crashes=0;grinds.length=0;
  const P=new Player(),fx=new Particles();P.reset(centerX(Level.cur.spawnZ),Level.cur.spawnZ,Level.cur.spawnSpeed);P.invuln=0;
  const dt=1/60;let launches=0,maxAbove=0,airT=0,was=false,clean=0,landings=0,maxSp=0,state={side:1};
  for(let i=0;i<secs*60;i++){const inp=Object.assign({steer:0,brake:false,tuck:false,jump:false,grab:null},controller(P,state,i*dt));
    const air0=P.airborne;P.step(dt,inp,fx);fx.update(dt);
    if(!air0&&P.airborne){launches++;}
    if(P.airborne){airT+=dt;maxAbove=Math.max(maxAbove,P.pos.y-RIDE_H-heightAt(Math.sign(P.pos.x)*(PIPE.B+PIPE.R),P.pos.z));}
    if(air0&&!P.airborne&&!P.grind){landings++;if(P.landedClean)clean++;}
    maxSp=Math.max(maxSp,P.speed);
    if(P.pos.z>(Level.cur.finishZ||1e9))break;}
  return {z:+P.pos.z.toFixed(0),launches,landings,clean,crashes,airT:+airT.toFixed(1),maxAboveLip:+maxAbove.toFixed(2),maxSpeed:+maxSp.toFixed(1),grinds:grinds.slice()};
}
// pipe: aim diagonally at one wall, switch target wall after each air / when crossing the bottom
const pipeCtl=(P,st)=>{ if(P.airborne)return {};
  if(Math.sign(P.pos.x)===st.side && Math.abs(P.pos.x)>5 && P.vel.x*st.side<0) st.side=-st.side;
  const want=st.side*1.05; return {steer:clamp(angDelta(want,P.yaw)*2.2,-1,1)}; };
console.log('pipe ',JSON.stringify(ride('pipe',pipeCtl,60)));
// spin 180 in the air (hold steer while airborne) for clean forward landings
const pipeSpin=(P,st)=>{ if(P.airborne)return {steer:st.side};
  if(Math.sign(P.pos.x)===st.side && Math.abs(P.pos.x)>5 && P.vel.x*st.side<0) st.side=-st.side;
  return {steer:clamp(angDelta(st.side*1.05,P.yaw)*2.2,-1,1)}; };
console.log('pipe+spin',JSON.stringify(ride('pipe',pipeSpin,60)));
// park: ride straight down the middle (hits the centre tabletops, the centre rails, the mini-pipe)
console.log('park ',JSON.stringify(ride('park',(P)=>({steer:clamp((P.yaw-Math.atan2(-P.pos.x,20))*2,-1,1)}),120)));
console.log('mountain ',JSON.stringify(ride('mountain',(P)=>({steer:clamp((P.yaw-Math.atan2(centerX(P.pos.z+25)-P.pos.x,25))*2.5,-1,1)}),30)));
`;vm.runInContext(s,ctx);
