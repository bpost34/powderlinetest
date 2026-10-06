const fs=require('fs');const OUT=process.argv[2];const LEN=+process.argv[3]||0;
(async()=>{
  const list=await (await fetch('http://localhost:9333/json/list')).json();const pg=list.find(t=>t.type==='page');
  const ws=new WebSocket(pg.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
  let id=0;const pend={};const logs=[];ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend[m.id]){pend[m.id](m);delete pend[m.id];}
    if(m.method==='Runtime.exceptionThrown')logs.push('EXCEPTION: '+(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text));};
  const send=(method,params={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}));});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true});return r.result.result?.value??JSON.stringify(r.result.exceptionDetails||r.result).slice(0,400);};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  await send('Runtime.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Page.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:8765/?'+Date.now()});await wait(3000);
  await ev(`localStorage.setItem('powderline.flick','auto');Flick.load();Game.selectLevel('mountain');Game.setLength('mountain',${LEN});Game.start();Game.lives=99`);
  await ev(`(()=>{window.R={hit:0,miss:0,crash:0,pumps:0};const om=Game.msg.bind(Game);Game.msg=(t,ms)=>{if(t==='GATE MISSED')R.miss++;om(t,ms)};const os=Game.showTrick.bind(Game);Game.showTrick=(n,p)=>{if(n==='GATE')R.hit++;os(n,p)};R.why=[];const oc=Game.onCrash.bind(Game);Game.onCrash=(w)=>{R.crash++;const P=Game.P;R.why.push([w||'',Math.round(P.pos.z),P._lastHit||'land',(P.speed*3.6).toFixed(0),'x-cx',(P.pos.x-centerX(P.pos.z)).toFixed(1),'air',P.airborne,'tgt',Autopilot._tx!=null?(Autopilot._tx-centerX(P.pos.z)).toFixed(1):'?'].join(':'));oc(w)};const oh=Game.hit.bind(Game);Game.hit=(o,r)=>{Game.P._lastHit=(o.sc!=null?(r>0.7*o.sc?'rock':'tree'):'?')+'@'+(o.x-centerX(o.z)).toFixed(1)+' y'+(Game.P.pos.y-o.y).toFixed(1);oh(o,r);Game.P._lastHit=0};})()`);
  for(let i=0;i<420;i++){await wait(1000);if(await ev("Game.state")!=='play')break;}
  console.log(JSON.stringify(JSON.parse(await ev("JSON.stringify(R)"))),'state',await ev('Game.state'),'runT',await ev('Game.runT.toFixed(1)'),'top',await ev('(Game.topSpeed*3.6).toFixed(0)'),'bonus',await ev('Game.timeBonus'),'|',await ev("document.getElementById('sTime').textContent+' / '+document.getElementById('sTimeSub').textContent"));
  const s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(OUT+'.png',Buffer.from(s.result.data,'base64'));
  console.log(logs.join('\n'));process.exit(0);
})();
