const fs=require('fs'),vm=require('vm');const ctx={console,Math,Float32Array,Uint32Array,Uint8Array,Map};vm.createContext(ctx);
let s='';for(const f of ['math','world','meshes','outfit','levels','fx','player'])s+=fs.readFileSync(process.argv[2]+'/js/'+f+'.js','utf8')+'\n';
s+=`var Audio={ollie(){},land(){},crash(){},trick(){}};var Cam={shake:0};var GL={time:0};let R=[];
var Game={onPump(){},onCrash(){},recover(){},onGrind(){},onPress(type,t,clean){R.push({t,clean})},onStomp(){},onFlickTooLow(){},onFlickTooLate(){},onSwitch(){},onPlan(){},onPlanTiming(){}};
const I=(o)=>Object.assign({steer:0,brake:0,tuck:0,jump:false,grab:null,flipFwd:0,flipBack:0},o);
Level.cur=Level.defs.mountain;Level.cur.setLength(0);
function trial(ctrl,drift,seed){let x=seed;Math.random=()=>{x=(x*16807)%2147483647;return x/2147483647};
  const P=new Player(),fx=new Particles();P.reset(centerX(300),300,10);P.invuln=1e9;R=[];
  const hist=[];let t=0,yaw0=null;
  while(t<10){const p=P.press;const v=p?(p.type==='tail'?-p.bal:p.bal):0;hist.push(v);
    const seen=hist[Math.max(0,hist.length-1-12)];               // 0.2 s reaction delay
    let stick=ctrl?clamp(-seen*1.6,-1,1):0;                        // + = push up
    const up=Math.max(0,stick),dn=Math.max(0,-stick);
    const a=(up+dn>0)?clamp((up+dn-0.28)/0.47,0,1):0;               // same dead zone / ramp as Input
    P.step(1/60,I({butter:true,steer:drift,flipFwd:up>0?a:0,flipBack:dn>0?a:0}),fx);
    if(P.press){yaw0=Math.max(yaw0||0,Math.abs(P.press.spin));}
    t+=1/60;if(R.length)break;}
  const side=hist[hist.length-1]>0?'up':'down';
  return {t:R.length?R[0].t:10,side,spin:(yaw0||0)*57.3};}
function rep(label,ctrl,drift){let ts=[],up=0,spin=0;for(let i=1;i<=40;i++){const r=trial(ctrl,drift,i*7919);ts.push(r.t);if(r.side==='up')up++;spin+=r.spin;}
  ts.sort((a,b)=>a-b);console.log(label.padEnd(36),'median hold',ts[20].toFixed(1)+'s','  held 10s:',ts.filter(t=>t>=10).length+'/40','  slips up/down:',up+'/'+(40-up),'  avg spin',(spin/40|0)+'°');}
rep('no stick',false,0);rep('reactive player (0.2s delay)',true,0);rep('reactive + 25% sideways drift',true,0.25);rep('deliberate butter spin (stick 0.8 side)',false,0.8);`;
vm.runInContext(s,ctx);
