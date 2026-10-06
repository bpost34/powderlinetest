const fs=require('fs');
async function main(){
  const list=await (await fetch('http://localhost:9333/json/list')).json();
  const pg=list.find(t=>t.type==='page');
  const ws=new WebSocket(pg.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
  let id=0;const pend={};const logs=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend[m.id]){pend[m.id](m);delete pend[m.id];}
    if(m.method==='Runtime.consoleAPICalled')logs.push('console.'+m.params.type+': '+m.params.args.map(a=>a.value??a.description).join(' '));
    if(m.method==='Runtime.exceptionThrown')logs.push('EXCEPTION: '+JSON.stringify(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text));
    if(m.method==='Log.entryAdded')logs.push('log.'+m.params.entry.level+': '+m.params.entry.text);};
  const send=(method,params={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}));});
  await send('Runtime.enable');await send('Log.enable');await send('Page.enable');
  await send('Page.navigate',{url:'http://localhost:8000/?'+Date.now()});
  await new Promise(r=>setTimeout(r,5000));
  const expr=fs.readFileSync(process.argv[2],'utf8');
  const res=await send('Runtime.evaluate',{expression:expr,returnByValue:true});
  console.log(JSON.stringify(res.result.result?.value??res.result,null,1));
  await new Promise(r=>setTimeout(r,1500));
  console.log('--- console/log ('+logs.length+')');const seen={};for(const l of logs){seen[l]=(seen[l]||0)+1;}for(const k in seen)console.log(seen[k]+'x',k.slice(0,400));
  ws.close();
}
main();
