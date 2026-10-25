import test from 'node:test'
import assert from 'node:assert/strict'
import {request as httpRequest} from 'node:http'
import {makeApp} from './index.mjs'
import {Store} from './store.mjs'
import {PROFILE_ARCHIVE_BODY_LIMIT} from './profile-archive.mjs'

test('HTTP rejects an oversized announced archive before receiving its body and preserves split UTF-8 input',async()=>{
  const app=makeApp({store:new Store(':memory:'),tutor:{status:async()=>({connected:false}),close(){}}})
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve))
  const port=app.server.address().port
  const headers={'X-Pole-Client':'notebook-v1','Content-Type':'application/json'}
  const post=(path,body)=>new Promise((resolve,reject)=>{
    const req=httpRequest({host:'127.0.0.1',port,path,method:'POST',headers},res=>{
      let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text)}))
    });req.on('error',reject);req.end(JSON.stringify(body))
  })
  try{
    const refused=await new Promise((resolve,reject)=>{
      const req=httpRequest({host:'127.0.0.1',port,path:'/api/profile/archive/restore',method:'POST',headers:{...headers,'Content-Length':String(PROFILE_ARCHIVE_BODY_LIMIT+1)}},res=>{
        res.resume();res.on('end',()=>{resolve(res.statusCode);req.destroy()})
      });req.on('error',reject);req.flushHeaders()
    })
    assert.equal(refused,413)
    const {data:{work}}=await post('/api/exam/start',{familyId:'number.percent',mode:'guided',requestId:'http-start'})
    const body=Buffer.from(JSON.stringify({workId:work.id,expectedRevision:work.revision,expectedModeEpoch:work.modeEpoch,answersByPart:work.answersByPart,reasoning:'Сохраняю мысль: целое — это 100%.'}))
    const boundary=body.indexOf(Buffer.from('С'))+1
    const saved=await new Promise((resolve,reject)=>{
      const req=httpRequest({host:'127.0.0.1',port,path:'/api/exam/save',method:'POST',headers},res=>{
        let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text)}))
      });req.on('error',reject);req.write(body.subarray(0,boundary));setTimeout(()=>req.end(body.subarray(boundary)),10)
    })
    assert.equal(saved.status,200)
    assert.equal(saved.data.work.reasoning,'Сохраняю мысль: целое — это 100%.')
  }finally{app.server.closeAllConnections();await app.close()}
})
