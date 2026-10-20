import { spawn } from 'node:child_process'
const children=[]
for(const args of [['server/index.mjs'],['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort']]) {
  const child=spawn(process.execPath,args,{stdio:'inherit',windowsHide:true});children.push(child)
  child.on('exit',code=>{if(!stopping){stop();process.exitCode=code??1}})
}
let stopping=false
function stop(){if(stopping)return;stopping=true;for(const child of children)child.kill()}
process.on('SIGINT',stop);process.on('SIGTERM',stop);process.on('exit',stop)
