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
  await ev("localStorage.setItem('powderline.flick','auto');Flick.load();Game.selectLevel('pipe');Game.setLength('pipe',0);Game.start();Game.lives=99");
  // on every approach (on the snow, climbing the wall) plan: 1080 + backflip; once over 60% of the pipe: triple cork 1440
  await ev(`(()=>{window.R=[];const ost=Game.showTrick.bind(Game);Game.showTrick=(n,p)=>{R.push(Math.round(Game.P.pos.z/PIPE.LEN*100)+'%: '+n);ost(n,p)};const om=Game.msg.bind(Game);Game.msg=(t,ms)=>{R.push('   ['+t+']');om(t,ms)};
    let planned=false,was=false;const f=()=>{const P=Game.P;const lip=PIPE.B+PIPE.R;
      if(!P.airborne&&!planned&&Math.abs(P.pos.x)>lip-3.2&&P.vel.x*Math.sign(P.pos.x)>0){planned=true;
        const big=P.pos.z>PIPE.LEN*0.6;const seq=big?[[1,0],[1,0],[1,0],[1,0],[0,1],[0,1],[0,1]]:[[1,0],[1,0],[1,0],[0,1]];
        seq.forEach((d,i)=>setTimeout(()=>{Flick.pending={x:d[0],y:d[1]}},i*30));}
      if(was&&!P.airborne)planned=false;was=P.airborne;requestAnimationFrame(f)};f();})()`);
  await ev(`(()=>{window.M={};window.GG={};window.shots=[];let lastAir=false;const g=()=>{const P=Game.P,lm=document.getElementById('launchMeter');
    const k=lm.classList.contains('on')?(lm.classList.contains('go')?'go':lm.classList.contains('late')?'late':'ready'):'off';M[k]=(M[k]||0)+1;
    if(P.airborne&&P.grab)GG[P.grab]=(GG[P.grab]||0)+1; if(P.airborne)GG.airFrames=(GG.airFrames||0)+1;requestAnimationFrame(g)};g();})()`);
  let shotGo=0,shotGrab=0;
  for(let i=0;i<40;i++){ for(let j=0;j<10;j++){await wait(100);
      if(!shotGo&&await ev("document.getElementById('launchMeter').classList.contains('go')")){shotGo=1;await shot('meter');}
      if(!shotGrab&&await ev("!!(Game.P.airborne&&Game.P.grab&&Game.P.airTime>0.5)")){shotGrab=1;await shot('grab');}}
    console.log(i,await ev("[Game.state,Math.round(Game.P.pos.z),Game.P.speed.toFixed(1),Game.P.crashed,Game.P.airborne,String(Game.launchT)].join()"));if(await ev("Game.state")!=="play")break;}
  console.log('meter',await ev("JSON.stringify(M)"),'grabs',await ev("JSON.stringify(GG)"));
  for(let i=0;i<0;i++){await wait(1000);console.log(i,await ev("[Game.state,Math.round(Game.P.pos.z),Game.P.speed.toFixed(1),Game.P.crashed,Game.P.airborne,String(Game.launchT)].join()"));if(await ev("Game.state")!=="play")break;}
  await shot('planhud');
  console.log(JSON.parse(await ev("JSON.stringify(R)")).join('\n'));
  console.log('state',await ev('Game.state'),'crash count',await ev('Game.lives'));
  process.exit(0);
})();
