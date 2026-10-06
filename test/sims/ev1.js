(async()=>{const list=await (await fetch('http://localhost:9333/json/list')).json();const pg=list.find(t=>t.type==='page');
const ws=new WebSocket(pg.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const pend={};ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend[m.id]){pend[m.id](m);delete pend[m.id];}};
const send=(method,params={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}));});
const r=await send('Runtime.evaluate',{expression:process.argv[2],returnByValue:true});console.log(JSON.stringify(r.result.result.value??r.result));process.exit(0);})();
