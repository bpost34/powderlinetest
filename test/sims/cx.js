const fs=require('fs'),vm=require('vm');const ctx={console,Math,Float32Array,Uint32Array,Uint8Array,Map};vm.createContext(ctx);
let s='';for(const f of ['math','world','meshes','outfit','levels','fx','player'])s+=fs.readFileSync(process.argv[2]+'/js/'+f+'.js','utf8')+'\n';
s+=`Level.cur=Level.defs.mountain;Level.cur.setLength(2);let o=[];let worst=0,wz=0;
for(let z=0;z<5000;z+=10){const a=Math.atan2(centerX(z+10)-centerX(z),10)*57.3;if(Math.abs(a)>Math.abs(worst)){worst=a;wz=z;} if(z>=4600&&z<=4800)o.push(z+':'+centerX(z).toFixed(1)+'('+a.toFixed(0)+'°)');}
console.log(o.join(' '));console.log('steepest bend',worst.toFixed(0),'at',wz);
for(const L of [0,1]){Level.cur.setLength(L);worst=0;for(let z=0;z<Level.cur.finishZ;z+=10){const a=Math.atan2(centerX(z+10)-centerX(z),10)*57.3;if(Math.abs(a)>Math.abs(worst)){worst=a;wz=z;}}console.log('len',L,'steepest',worst.toFixed(0),'at',wz);}`;
vm.runInContext(s,ctx);
