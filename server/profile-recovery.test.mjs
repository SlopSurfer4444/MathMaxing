import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { Store } from './store.mjs'
import { createVisitorSessions } from './visitors.mjs'
import { createProfileRecovery } from './profile-recovery.mjs'
import { makeApp } from './index.mjs'

function fixture(){
  const store=new Store(':memory:'),config={hosted:true,maxVisitors:50};let clock=1000
  createVisitorSessions(config,store)
  const owners=[randomUUID(),randomUUID()]
  for(const owner of owners)store.db.prepare('INSERT INTO visitors VALUES(?,?,?,?)').run(owner,`original-${owner}`,clock,clock+99999999)
  const recovery=createProfileRecovery(config,store,{now:()=>clock})
  return {store,owners,recovery,advance:ms=>clock+=ms}
}
const body=code=>({code,confirmSwitch:true,savedCurrentCode:true})
test('profile recovery preserves separate works, settings and original browser credentials',()=>{
  const {store,owners:[a,b],recovery}=fixture()
  try{
    const left=store.forVisitor(a),right=store.forVisitor(b)
    const original=left.current(),other=right.current()
    left.setSetting('learning',JSON.stringify({view:'episode',episodeId:'K3'}))
    const codeA=recovery.create(a).code,codeB=recovery.create(b).code
    const restored=recovery.restore(b,body(codeA))
    assert.equal(restored.id,a)
    assert.match(restored.cookie,/Secure; HttpOnly; SameSite=Lax/)
    const token=restored.cookie.split(';')[0].split('=')[1]
    assert.equal(recovery.findSession(createHash('sha256').update(token).digest('hex')).id,a)
    assert.equal(left.current().id,original.id);assert.equal(right.current().id,other.id)
    assert.equal(left.learning().episodeId,'K3')
    assert.equal(recovery.restore(a,body(codeB)).id,b)
    assert.equal(store.db.prepare('SELECT token_hash FROM visitors WHERE id=?').get(a).token_hash,`original-${a}`)
    const serialized=JSON.stringify(store.db.prepare('SELECT * FROM profile_recovery').all())
    assert.ok(!serialized.includes(codeA));assert.ok(!serialized.includes(codeA.replaceAll('-','')))
  }finally{store.close()}
})
test('replacing recovery code invalidates previous code without invalidating existing devices',()=>{
  const {store,owners:[a,b],recovery}=fixture()
  try{
    const old=recovery.create(a).code;recovery.create(b)
    const session=recovery.restore(b,body(old));const fresh=recovery.create(a).code
    assert.throws(()=>recovery.restore(b,body(old)),/Код не найден/)
    assert.equal(recovery.restore(b,body(fresh)).id,a)
    const token=session.cookie.split(';')[0].split('=')[1]
    assert.equal(recovery.findSession(createHash('sha256').update(token).digest('hex')).id,a)
  }finally{store.close()}
})
test('restore requires protection and explicit switch, rejects malformed codes and throttles persisted attempts',()=>{
  const {store,owners:[a,b],recovery,advance}=fixture()
  try{
    const code=recovery.create(a).code
    assert.throws(()=>recovery.restore(b,body(code)),/Сначала сохрани/)
    recovery.create(b)
    assert.throws(()=>recovery.restore(b,{code}),/Сначала сохрани/)
    for(let n=0;n<6;n++)assert.throws(()=>recovery.restore(b,body('invalid')),/Код не найден/)
    assert.throws(()=>recovery.restore(b,body(code)),error=>error.status===429)
    advance(15*60*1000)
    assert.equal(recovery.restore(b,body(code)).id,a)
  }finally{store.close()}
})
test('local data cannot be claimed by hosted recovery',()=>{
  const {store,owners:[a],recovery}=fixture()
  try{
    assert.equal(recovery.status('local').available,false)
    assert.throws(()=>recovery.create('local'),/Локальная тетрадь/)
    const localRecovery=createProfileRecovery({hosted:false},store)
    assert.equal(localRecovery.status(a).available,false)
    assert.throws(()=>localRecovery.create(a),/Локальная тетрадь/)
  }finally{store.close()}
})

test('hosted HTTP restore keeps original device and rejects stale-tab writes and cross-origin restore',async()=>{
  const app=makeApp({config:{hosted:true,dbPath:':memory:',origins:['https://school.test'],requestsPerMinute:200,maxHttpConcurrent:12,maxBodyBytes:100000,maxVisitors:20},tutor:{status:async()=>({connected:false}),close:async()=>{}}})
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve))
  const base=`http://127.0.0.1:${app.server.address().port}`
  async function call(path,visitor,body,origin='https://school.test'){
    const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'X-Pole-Client':'notebook-v1',Origin:origin,...(visitor?{Cookie:visitor.cookie,'X-Pole-Session':visitor.id}:{}),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]}
  }
  try{
    const first=await call('/api/session'),second=await call('/api/session')
    const a={id:first.data.id,cookie:first.cookie},b={id:second.data.id,cookie:second.cookie}
    const original=(await call('/api/state',a)).data.work.id,other=(await call('/api/state',b)).data.work.id
    const route=(await call('/api/study-route',a)).data.route
    const codeA=(await call('/api/profile/recovery',a,{})).data.code
    const codeB=(await call('/api/profile/recovery',b,{})).data.code
    assert.equal((await call('/api/profile/restore',b,body(codeA),'https://evil.test')).status,403)
    const restored=await call('/api/profile/restore',b,body(codeA))
    assert.equal(restored.status,200);assert.equal(restored.data.id,a.id)
    assert.ok(!JSON.stringify(restored.data).includes('__Host'))
    const current={id:a.id,cookie:restored.cookie}
    assert.equal((await call('/api/state',current)).data.work.id,original)
    assert.deepEqual((await call('/api/study-route',current)).data.route,route)
    assert.equal((await call('/api/state',a)).data.work.id,original)
    assert.equal((await call('/api/state',{id:b.id,cookie:restored.cookie})).status,409)
    const back=await call('/api/profile/restore',current,body(codeB))
    assert.equal((await call('/api/state',{id:b.id,cookie:back.cookie})).data.work.id,other)
  }finally{await app.close()}
})

test('local HTTP profile explicitly declines transfer and preserves local work',async()=>{
  const app=makeApp({config:{hosted:false,dbPath:':memory:',origins:['http://localhost:5173'],requestsPerMinute:200,maxHttpConcurrent:12,maxBodyBytes:100000},tutor:{status:async()=>({connected:false}),close:async()=>{}}})
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve))
  const base=`http://127.0.0.1:${app.server.address().port}`
  const headers={'X-Pole-Client':'notebook-v1',Origin:'http://localhost:5173','Content-Type':'application/json'}
  try{
    const original=app.store.current().id
    assert.equal((await (await fetch(base+'/api/profile',{headers})).json()).available,false)
    const response=await fetch(base+'/api/profile/recovery',{method:'POST',headers,body:'{}'})
    assert.equal(response.status,400);assert.match((await response.json()).error,/Локальная тетрадь/)
    assert.equal(app.store.current().id,original)
  }finally{await app.close()}
})
