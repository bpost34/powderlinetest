const fs=require('fs'),vm=require('vm');let __s=12345;const SM=Object.create(Math);SM.random=()=>{__s=(__s*1103515245+12345)%2147483648;return __s/2147483648};const ctx={console,Math:SM,Float32Array,Uint32Array,Uint8Array,Map};vm.createContext(ctx);
let s='';for(const f of ['math','world','meshes','outfit','levels','fx','player'])s+=fs.readFileSync(process.argv[2]+'/js/'+f+'.js','utf8')+'\n';
s+=`var Audio={ollie(){},land(){},crash(){},trick(){}};var Cam={shake:0};var GL={time:0};var Game={onPump(){},onCrash(){},recover(){},onGrind(){}};
const I=(o)=>Object.assign({steer:0,brake:0,tuck:0,jump:false,grab:null,flipFwd:0,flipBack:0},o);
function ground(tuck,brake){Level.cur=Level.defs.mountain;const P=new Player(),fx=new Particles();P.reset(centerX(40),40,14);for(let i=0;i<240;i++)P.step(1/60,I({tuck,brake}),fx);return +P.speed.toFixed(1);}
console.log('speed after 4s  neutral',ground(0,0),' half tuck',ground(0.5,0),' full tuck',ground(1,0),' half brake',ground(0,0.5),' full brake',ground(0,1));
function air(f,b){Level.cur=Level.defs.park;const P=new Player(),fx=new Particles();P.reset(0,4,10);for(let i=0;i<30;i++)P.step(1/60,I({}),fx);P.step(1/60,I({jump:true,charge:0.6}),fx);for(let i=0;i<4;i++)P.step(1/60,I({}),fx);
 for(let i=0;i<40&&P.airborne;i++)P.step(1/60,I({tuck:f,flipFwd:f,brake:b,flipBack:b}),fx);return +P.flip.toFixed(2);}
console.log('flip after 0.67s  stick fwd 0.5:',air(0.5,0),' fwd 1:',air(1,0),' back 0.5:',air(0,0.5),' back 1:',air(0,1),' (boolean W):',air(true,false));
`;vm.runInContext(s,ctx);
