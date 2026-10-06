const fs=require('fs');const OUT=process.argv[2];
(async()=>{
  const list=await (await fetch('http://localhost:9333/json/list')).json();const pg=list.find(t=>t.type==='page');
  const ws=new WebSocket(pg.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
  let id=0;const pend={};let logs=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend[m.id]){pend[m.id](m);delete pend[m.id];}
    if(m.method==='Runtime.consoleAPICalled')logs.push('console.'+m.params.type+': '+m.params.args.map(a=>a.value??a.description).join(' '));
    if(m.method==='Runtime.exceptionThrown')logs.push('EXCEPTION: '+(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text));
    if(m.method==='Log.entryAdded')logs.push('log.'+m.params.entry.level+': '+m.params.entry.text);};
  const send=(method,params={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}));});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true});return r.result.result?.value??JSON.stringify(r.result.exceptionDetails||r.result).slice(0,400);};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const key=async(type,code,k)=>send('Input.dispatchKeyEvent',{type,code,key:k,windowsVirtualKeyCode:0});
  const shot=async n=>{const s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(OUT+'_'+n+'.png',Buffer.from(s.result.data,'base64'));};
  await send('Runtime.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Page.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:8765/?'+Date.now()});await wait(3000);
  const len=+(process.env.LEN||0);
  await ev(`localStorage.setItem('powderline.flick','auto');Flick.load();Game.selectLevel('pipe');Game.setLength('pipe',${len});Game.start();Game.lives=99`);
  await ev(`(()=>{window.A=[];let was=false,y0=0,mx=0,z0=0,t=0;const f=()=>{const P=Game.P;
    if(P.airborne&&!was){y0=P.pos.y;mx=0;z0=P.pos.z;}
    if(P.airborne){mx=Math.max(mx,P.pos.y-y0);}
    if(was&&!P.airborne)A.push({pct:Math.round(z0/PIPE.LEN*100),h:+mx.toFixed(1),air:+P.lastAir.toFixed(2),kmh:Math.round(P.speed*3.6),crash:P.crashTimer>0});
    was=P.airborne;requestAnimationFrame(f)};f();
    const os=Game.P.step.bind(Game.P);Game.P.step=function(dt,i,fx){const a=this.airborne;os(dt,i,fx);if(a&&!this.airborne)this.lastAir=this._at;if(this.airborne)this._at=this.airTime;};})()`);
  for(let i=0;i<60;i++){await wait(1000);if(await ev("Game.state")!=='play'||await ev("Game.P.pos.z>PIPE.LEN"))break;}
  console.log('pipe length',await ev('PIPE.LEN'));
  for(const a of JSON.parse(await ev("JSON.stringify(A)")))console.log(JSON.stringify(a));
  process.exit(0);
})();
