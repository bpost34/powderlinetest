const fs=require('fs'),vm=require('vm');
function run(dir){let __s=12345;const SM=Object.create(Math);SM.random=()=>{__s=(__s*1103515245+12345)%2147483648;return __s/2147483648};const ctx={console,Math:SM,Float32Array,Uint32Array,Uint8Array,Map};vm.createContext(ctx);
let s='';for(const f of ['math','world','meshes','outfit','levels','fx','player'])s+=fs.readFileSync(dir+'/js/'+f+'.js','utf8')+'\n';
s+=`var Audio={ollie(){},land(){},crash(){},trick(){}};var Cam={shake:0};var GL={time:0};var grinds=[];var Game={onPump(){},onCrash(){},recover(){},onGrind(t){grinds.push(t)}};
Level.cur=Level.defs.park;const row=[];
for(const off of [0,0.3,0.5,0.7,0.9,1.1]){ for(const jumpAt of [156.5,159]) {
  const P=new Player(),fx=new Particles();P.reset(off,150,10);P.invuln=2;const dt=1/60;let jumped=false,caught=false,speedIn=0,speedGrind=0;
  for(let i=0;i<240;i++){const j=!jumped&&P.pos.z>jumpAt;if(j){jumped=true;speedIn=P.speed;}
    P.step(dt,{steer:0,brake:false,tuck:false,jump:j,grab:null},fx);if(P.grind&&!caught){caught=true;speedGrind=P.grind.s;}}
  row.push('offset '+off+'m jump@'+jumpAt+': '+(caught?'GRIND (in '+speedIn.toFixed(1)+' -> rail '+speedGrind.toFixed(1)+')':'missed'));}}
console.log(row.join('\\n'));`;vm.runInContext(s,ctx);}
console.log('--- OLD');run(process.argv[2]);console.log('--- NEW');run(process.argv[3]);
