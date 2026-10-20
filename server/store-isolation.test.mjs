import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from './store.mjs'

test('original ownerless schema migrates without sharing local work, memory or learning',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'pole-old-schema-')),path=join(directory,'old.sqlite')
  const seed=new Store(':memory:'),work=seed.current(),learning=seed.learning();seed.close()
  const old=new DatabaseSync(path)
  old.exec('CREATE TABLE works(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE evidence(id TEXT PRIMARY KEY,data TEXT NOT NULL)')
  old.prepare('INSERT INTO works VALUES(?,?)').run(work.id,JSON.stringify(work))
  old.prepare('INSERT INTO settings VALUES(?,?)').run('current',work.id)
  old.prepare('INSERT INTO settings VALUES(?,?)').run('learning',JSON.stringify({...learning,entry:'refresh'}))
  old.prepare('INSERT INTO settings VALUES(?,?)').run('learning-event:old',JSON.stringify({id:'old',summary:'local-only'}))
  old.prepare('INSERT INTO evidence VALUES(?,?)').run('local-memory',JSON.stringify({id:'local-memory'}));old.close()
  let store
  try{
    store=new Store(path)
    assert.deepEqual(store.current(),work);assert.equal(store.learning().entry,'refresh')
    assert.equal(store.memory()[0].id,'local-memory');assert.equal(store.learningEvidence()[0].id,'old')
    const guest=store.forVisitor(randomUUID())
    assert.deepEqual(guest.list(),[]);assert.deepEqual(guest.memory(),[]);assert.deepEqual(guest.learningEvidence(),[])
    assert.equal(guest.learning().entry,null);assert.notEqual(guest.current().id,work.id)
    store.close();store=new Store(path)
    assert.deepEqual(store.current(),work);assert.equal(store.list().length,1)
  }finally{store?.close();await rm(directory,{recursive:true,force:true})}
})

test('guest resource exhaustion rejects new data without evicting saved work or affecting peers',()=>{
  const store=new Store(':memory:')
  try{
    const guest=store.forVisitor(randomUUID()),peer=store.forVisitor(randomUUID()),work=guest.current(),peerWork=peer.current()
    const tooLarge=structuredClone(work);tooLarge.document={type:'doc',content:[{type:'text',text:'x'.repeat(1000000)}]}
    assert.throws(()=>guest.put(tooLarge),{status:429});assert.deepEqual(guest.current(),work)
    for(let i=1;i<100;i++)guest.create('double-angle-cos','guided')
    const current=guest.current()
    assert.throws(()=>guest.create('double-angle-sin','guided'),{status:429})
    assert.equal(guest.list().length,100);assert.deepEqual(guest.current(),current);assert.deepEqual(guest.get(work.id),work)
    assert.deepEqual(peer.current(),peerWork);assert.equal(peer.list().length,1);assert.deepEqual(store.list(),[])
    for(let i=0;i<310;i++)guest.learningChecked({workId:work.id,kind:'diagnostic',summary:`check ${i}`})
    assert.equal(guest.learningEvidence().length,60)
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM settings WHERE key LIKE ?').get(`${guest.key('learning-event:')}%`).count,300)
    assert.deepEqual(peer.learningEvidence(),[])
  }finally{store.close()}
})
