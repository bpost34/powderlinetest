const fs=require('fs');
(async()=>{
  const list=await (await fetch('http://localhost:9333/json/list')).json();const pg=list.find(t=>t.type==='page');
  const ws=new WebSocket(pg.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
  let id=0;const pend={};ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend[m.id]){pend[m.id](m);delete pend[m.id];}};
  const send=(method,params={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}));});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true});return r.result.result?.value??JSON.stringify(r.result.exceptionDetails||r.result).slice(0,400);};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  await send('Runtime.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Page.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:8765/?'+Date.now()});await wait(3000);
  await ev("localStorage.setItem('powderline.flick','auto');Flick.load();Game.selectLevel('pipe');Game.setLength('pipe',1);Game.start();Game.lives=99;Game.P.invuln=1e9");
  await ev(`(()=>{window.S=[];let cur=[];let now=0;const lip=PIPE.B+PIPE.R;const f=()=>{const P=Game.P;now=performance.now()/1000;
    if(!P.airborne){const out=Math.sign(P.pos.x)||1,vOut=P.vel.x*out; if(vOut>1)cur.push([now,Game.launchT,Math.abs(P.pos.x),vOut,P.speed,P.pos.y-heightAt(0,P.pos.z)]); else cur=[];}
    else if(cur.length){S.push(cur.map(c=>[+(now-c[0]).toFixed(2),+(c[1]??-1).toFixed(2),+c[2].toFixed(2),+c[3].toFixed(2),+c[4].toFixed(2)]));cur=[];}
    requestAnimationFrame(f)};f();})()`);
  await wait(40000);
  const S=JSON.parse(await ev("JSON.stringify(S)"));
  for(const run of S.slice(0,12)){const pick=[0,Math.floor(run.length/3),Math.floor(run.length*2/3),run.length-3].map(i=>run[Math.max(0,i)]);console.log(pick.map(p=>`act ${p[0]} pred ${p[1]} |x| ${p[2]} vOut ${p[3]} sp ${p[4]}`).join(' | '));}
  process.exit(0);
})();
