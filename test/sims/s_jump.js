const fs=require('fs'),vm=require('vm');let __s=12345;const SM=Object.create(Math);SM.random=()=>{__s=(__s*1103515245+12345)%2147483648;return __s/2147483648};const ctx={console,Math:SM,Float32Array,Uint32Array,Uint8Array,Map};vm.createContext(ctx);
let s='';for(const f of ['math','world','meshes','outfit','levels','fx','player'])s+=fs.readFileSync(process.argv[2]+'/js/'+f+'.js','utf8')+'\n';
s+=`var Audio={ollie(){},land(){},crash(){},trick(){}};var Cam={shake:0};var GL={time:0};var Game={onPump(){},onCrash(){},recover(){},onGrind(){}};
const I=(o)=>Object.assign({steer:0,brake:false,tuck:false,jump:false,grab:null,flipFwd:false,flipBack:false},o);
function ollie(charge){Level.cur=Level.defs.park;const P=new Player(),fx=new Particles();P.reset(0,4,10);const dt=1/60;
  for(let i=0;i<30;i++)P.step(dt,I({}),fx);const y0=P.pos.y;P.step(dt,I({jump:true,charge}),fx);let maxH=0,t=0;
  while(P.airborne&&t<4){P.step(dt,I({}),fx);t+=dt;maxH=Math.max(maxH,P.pos.y-heightAt(P.pos.x,P.pos.z));}return {air:+t.toFixed(2),height:+maxH.toFixed(2)};}
console.log('tap (0.05s)  ',JSON.stringify(ollie(0.05)));
console.log('held 0.3s    ',JSON.stringify(ollie(0.3)));
console.log('held 0.6s+   ',JSON.stringify(ollie(0.9)));
// tabletop lip at z=100+7=107 (park): ride in, release N ms AFTER the crest launch
function lip(releaseDelay){Level.cur=Level.defs.park;const P=new Player(),fx=new Particles();P.reset(0,80,13);const dt=1/60;let launchedAt=-1,t=0,air=0,flips=0,released=false;
  for(let i=0;i<400;i++){t+=dt;let inp=I({tuck:true});
    if(P.airborne&&launchedAt<0)launchedAt=t;
    if(releaseDelay!==null&&launchedAt>=0&&!released&&t-launchedAt>=releaseDelay){inp=I({jump:true,charge:0.6});released=true;}
    const a=P.airborne;P.step(dt,inp,fx);if(P.airborne)air+=dt;if(a&&!P.airborne&&launchedAt>=0)break;}
  return {airTime:+air.toFixed(2)};}
console.log('lip, no jump          ',JSON.stringify(lip(null)));
console.log('lip, release +0.10s   ',JSON.stringify(lip(0.10)));
console.log('lip, release +0.22s   ',JSON.stringify(lip(0.22)));
console.log('lip, release +0.40s   ',JSON.stringify(lip(0.40)),'(outside grace window)');
// hold Space (tuck only, no W) through an air: must not flip
{Level.cur=Level.defs.park;const P=new Player(),fx=new Particles();P.reset(0,4,10);const dt=1/60;for(let i=0;i<30;i++)P.step(dt,I({}),fx);
 P.step(dt,I({jump:true,charge:0.6}),fx);let mf=0;for(let i=0;i<120&&P.airborne;i++){P.step(dt,I({tuck:true}),fx);mf=Math.max(mf,Math.abs(P.flip));}console.log('holding Space in air -> max flip',mf.toFixed(2),'rad');
 P.reset(0,4,10);for(let i=0;i<30;i++)P.step(dt,I({}),fx);P.step(dt,I({jump:true,charge:0.6}),fx);for(let i=0;i<4;i++)P.step(dt,I({}),fx);mf=0;for(let i=0;i<60&&P.airborne;i++){P.step(dt,I({tuck:true,flipFwd:true}),fx);mf=Math.max(mf,Math.abs(P.flip));}console.log('W in air -> flip',mf.toFixed(2),'rad (front flip works)');}
`;vm.runInContext(s,ctx);
