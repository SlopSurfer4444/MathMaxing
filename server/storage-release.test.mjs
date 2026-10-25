import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Store,PROFILE_LIMITS} from './store.mjs'
import {problems} from './problems.mjs'

test('every authored legacy work is frozen and unknown historical instances remain readable without a catalog fallback',()=>{
 const store=new Store(':memory:');try{const work=store.create('double-angle-cos','guided'),frozen=store.problem(work),old=problems[0].equation;try{problems[0].equation='catalog changed';assert.equal(store.problem(work).equation,frozen.equation)}finally{problems[0].equation=old}
 const custom=store.create('retired-task','solo',{id:'retired-task',kind:'retired-custom',title:'Historical original',parts:[{id:'a'},{id:'b'},{id:'proof'}]});assert.equal(store.problem(custom).kind,'retired-custom');assert.throws(()=>store.create('unknown-task','solo'),/Неизвестная/)
 }finally{store.close()}
})

test('work, frozen instance and current selection are one atomic creation including nested callers',()=>{
 const store=new Store(':memory:');try{const owner=store.forVisitor(randomUUID()),old=owner.current();store.db.exec("CREATE TRIGGER frozen_failure BEFORE INSERT ON settings WHEN NEW.key LIKE '%problem-instance:%' BEGIN SELECT RAISE(ABORT,'frozen failure'); END")
 assert.throws(()=>owner.create('double-angle-sin','solo'),/frozen failure/);assert.deepEqual(owner.current(),old);assert.equal(owner.list().length,1)
 store.db.exec('DROP TRIGGER frozen_failure');assert.throws(()=>owner.transaction(()=>{owner.create('double-angle-sin','solo');throw Error('outer failure')}),/outer failure/);assert.deepEqual(owner.current(),old);assert.equal(owner.list().length,1)
 }finally{store.close()}
})

test('SQL summaries and bounded pagination do not deserialize notebook JSON in JavaScript',()=>{
 const store=new Store(':memory:');try{for(let i=0;i<8;i++)store.create('double-angle-cos','solo');const expected=store.list();assert.equal(expected.length,8);assert.ok(store.db.prepare("EXPLAIN QUERY PLAN SELECT 1 FROM works WHERE owner=? AND json_extract(data,'$.problemId')=?").all('local','double-angle-cos').some(row=>row.detail.includes('works_owner_problem')))
 const parse=JSON.parse;try{JSON.parse=()=>{throw Error('JSON deserialization forbidden')};assert.deepEqual(store.listPage({limit:3,offset:2}),expected.slice(2,5));assert.deepEqual(store.list(),expected)}finally{JSON.parse=parse}
 assert.throws(()=>store.listPage({limit:101}),{status:400});assert.throws(()=>store.listPage({offset:-1}),{status:400})
 }finally{store.close()}
})

test('common profile budget includes frozen settings, archived learning and new exam data; reserve permits a last edit at creation cap',()=>{
 const store=new Store(':memory:');try{const a=store.forVisitor(randomUUID()),b=store.forVisitor(randomUUID()),work=a.current();const initial=a.profileBudget().bytes
 store.db.exec('CREATE TABLE exam_instances(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL);CREATE TABLE exam_requests(owner TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,response TEXT NOT NULL)')
 store.db.prepare('INSERT INTO exam_instances VALUES(?,?,?)').run(randomUUID(),a.owner,JSON.stringify({private:'x'.repeat(1000)}));store.db.prepare('INSERT INTO exam_requests VALUES(?,?,?,?)').run(a.owner,'r','h','r'.repeat(2000));assert.ok(a.profileBudget().bytes>=initial+3000)
 a.setSetting('space-fixture','x'.repeat(PROFILE_LIMITS.bytes-a.profileBudget().bytes));assert.equal(a.profileBudget().full,true);assert.equal(a.profileBudget().warning,true);assert.throws(()=>a.create('double-angle-sin','solo'),{status:429})
 work.finalAnswer='last saved answer';a.put(work);assert.equal(a.current().finalAnswer,'last saved answer');assert.equal(b.profileBudget().bytes,0)
 const saved=a.current();a.setSetting('reserve-fixture','x'.repeat(PROFILE_LIMITS.bytes+PROFILE_LIMITS.editReserveBytes-a.profileBudget().bytes));assert.throws(()=>a.put({...saved,finalAnswer:'x'.repeat(5000)}),{status:429});assert.deepEqual(a.current(),saved)
 }finally{store.close()}
})

test('retention never silently deletes evidence and old learning events move to a profile-owned durable archive',()=>{
 const store=new Store(':memory:');try{const a=store.forVisitor(randomUUID()),work=a.current();for(let i=0;i<310;i++)a.learningChecked({workId:work.id,summary:`event ${i}`});assert.equal(a.learningEvidence().length,60);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM learning_event_archive WHERE owner=?').get(a.owner).n,10)
 for(let i=0;i<110;i++)a.evidence({id:randomUUID(),createdAt:work.createdAt,mode:'solo',helpCount:0,result:{status:'correct'}},work);assert.equal(a.memory().length,30);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM evidence WHERE owner=?').get(a.owner).n,110)
 }finally{store.close()}
})

test('representative 100-work history fits measured inherited quota without deleting historical snapshots',t=>{
 const store=new Store(':memory:');try{const a=store.forVisitor(randomUUID());for(let i=0;i<100;i++){const work=a.create('double-angle-cos','solo');work.document.content[0].content=[{type:'text',text:'Решение и обоснование. '.repeat(80)}];work.submissions=Array.from({length:5},()=>({id:randomUUID(),snapshot:{document:structuredClone(work.document)},result:{status:'unknown'},review:{summary:'Проверка числа не доказывает обоснование.',findings:[]}}));a.put(work);a.learningChecked({workId:work.id,summary:'Наблюдение по неизменяемой попытке'})}
 const budget=a.profileBudget();t.diagnostic(`100 works; 500 frozen submission snapshots; 100 learning events: ${budget.bytes} bytes of ${PROFILE_LIMITS.bytes}`);assert.ok(budget.bytes<PROFILE_LIMITS.warningBytes);assert.equal(budget.count,100);const work=a.current();work.finalAnswer='Последняя запись';a.put(work);assert.equal(a.current().finalAnswer,'Последняя запись')
 }finally{store.close()}
})

test('restart recovers only indexed interrupted jobs and preserves ordinary history byte-for-byte',()=>{
 const dir=mkdtempSync(join(tmpdir(),'school-recovery-')),path=join(dir,'store.sqlite');let store=new Store(path)
 try{const completed=store.current(),pending=store.create('double-angle-sin','guided');pending.messages.push({role:'assistant',status:'pending',id:randomUUID()});store.put(pending);const untouched=store.db.prepare('SELECT data FROM works WHERE id=?').get(completed.id).data;assert.equal(store.db.prepare('SELECT pending_recovery p FROM works WHERE id=?').get(pending.id).p,1);store.close();store=new Store(path);assert.equal(store.get(pending.id).messages[0].status,'failed');assert.equal(store.db.prepare('SELECT pending_recovery p FROM works WHERE id=?').get(pending.id).p,0);assert.equal(store.db.prepare('SELECT data FROM works WHERE id=?').get(completed.id).data,untouched)
 }finally{store.close();rmSync(dir,{recursive:true,force:true})}
})
