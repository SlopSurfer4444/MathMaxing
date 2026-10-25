import test from 'node:test'
import assert from 'node:assert/strict'
import {readModelDraft,writeModelDraft,modelDraftConflicts,flushModelDraft,ModelSyncError,confirmModelDraftBackup,type ModelSyncContext} from './exam-local-model.ts'
test('unsubmitted model draft is bounded and isolated, never stores a verdict',()=>{
  const records=new Map<string,string>(),storage={getItem:(key:string)=>records.get(key)??null,setItem:(key:string,value:string)=>{records.set(key,value)},removeItem:(key:string)=>{records.delete(key)}}
  const draft={episodeId:'episode',descriptorDigest:'a'.repeat(64),baseState:{input:'',choice:'',reveal:0},state:{input:'11550',choice:'interest-2',reveal:1}}
  writeModelDraft(storage,'a',draft)
  assert.deepEqual(readModelDraft(storage,'a'),draft)
  assert.equal(readModelDraft(storage,'b'),null)
  assert.throws(()=>writeModelDraft(storage,'a',{...draft,state:{...draft.state,input:'1'.repeat(121)}}))
  assert.deepEqual(readModelDraft(storage,'a'),draft)
  records.set('exam.model.a',JSON.stringify({version:1,draft:{...draft,state:{...draft.state,reveal:4}}}))
  assert.equal(readModelDraft(storage,'a'),null)
})
test('same episode detects a concurrent model edit even after revision readback',()=>{
  const baseState={input:'100',choice:'',reveal:0},state={...baseState,input:'200'}
  const draft={episodeId:'same',descriptorDigest:'a'.repeat(64),baseState,state}
  assert.equal(modelDraftConflicts(draft,{id:'same',state:baseState}),false)
  assert.equal(modelDraftConflicts(draft,{id:'same',state}),false)
  assert.equal(modelDraftConflicts(draft,{id:'same',state:{...baseState,input:'300'}}),true)
  assert.equal(modelDraftConflicts(draft,{id:'new',state}),true)
})

function syncFixture(){
  const state={input:'100',choice:'',reveal:0}
  const context:ModelSyncContext={workId:'work-a',open:true,episode:{id:'episode-a',descriptorDigest:'a'.repeat(64),state},draft:{episodeId:'episode-a',descriptorDigest:'a'.repeat(64),baseState:state,state:{...state,input:'200'}},recovery:false}
  return context
}
const reason=(expected:ModelSyncError['reason'])=>(error:unknown)=>error instanceof ModelSyncError&&error.reason===expected

test('explicit flush waits for confirmed persistence before dependent navigation',async()=>{
  const context=syncFixture(),events:string[]=[]
  let release!:()=>void
  const gate=new Promise<void>(resolve=>{release=resolve})
  const done=flushModelDraft(()=>context,async()=>{events.push('save');await gate;context.episode.state=structuredClone(context.draft!.state);context.draft!.baseState=context.episode.state;events.push('saved')}).then(()=>{events.push('leave')})
  assert.deepEqual(events,['save']);release();await done
  assert.deepEqual(events,['save','saved','leave'])
})
test('failed persistence never retries, mutates local input or permits dependent action',async()=>{
  const context=syncFixture(),before=structuredClone(context),failure=Error('network unknown');let calls=0,left=false
  await assert.rejects(flushModelDraft(()=>context,async()=>{calls++;throw failure}).then(()=>{left=true}),error=>reason('save')(error)&&(error as ModelSyncError).cause===failure)
  assert.equal(calls,1);assert.equal(left,false);assert.deepEqual(context,before)
})
test('typing during a successful save flushes the newer snapshot next',async()=>{
  const context=syncFixture(),saved:string[]=[]
  await flushModelDraft(()=>context,async()=>{
    const snapshot=structuredClone(context.draft!.state);saved.push(snapshot.input)
    if(saved.length===1)context.draft!.state={...snapshot,input:'300'}
    context.episode.state=snapshot;context.draft!.baseState=snapshot
  })
  assert.deepEqual(saved,['200','300']);assert.equal(context.episode.state.input,'300')
})
test('binding changes after persistence never write into the replacement work or episode',async()=>{
  for(const field of ['work','episode','digest','closed'] as const){
    const context=syncFixture();let calls=0
    await assert.rejects(flushModelDraft(()=>context,async()=>{calls++;if(field==='work')context.workId='work-b';if(field==='episode')context.episode.id='episode-b';if(field==='digest')context.episode.descriptorDigest='b'.repeat(64);if(field==='closed')context.open=false}),reason('changed'))
    assert.equal(calls,1)
  }
})
test('conflicting or unresolved recovery input never starts persistence',async()=>{
  for(const recovery of [true,false]){
    const context=syncFixture();context.recovery=recovery
    if(!recovery)context.episode.state={...context.episode.state,input:'400'}
    let calls=0;await assert.rejects(flushModelDraft(()=>context,async()=>{calls++}),reason('conflict'));assert.equal(calls,0)
  }
})
test('clean, closed and absent model contexts do not save',async()=>{
  const clean=syncFixture();clean.draft!.state=structuredClone(clean.episode.state)
  const closed=syncFixture();closed.open=false
  for(const context of [null,clean,closed,{...clean,draft:null}]){let calls=0;await flushModelDraft(()=>context,async()=>{calls++});assert.equal(calls,0)}
})
test('continued edits stop after three confirmed saves; a no-op persistence is not retried',async()=>{
  const context=syncFixture();let calls=0
  await assert.rejects(flushModelDraft(()=>context,async()=>{calls++;context.episode.state=structuredClone(context.draft!.state);context.draft!.baseState=context.episode.state;context.draft!.state={...context.draft!.state,input:String(200+calls)}}),reason('editing'))
  assert.equal(calls,3);assert.notEqual(context.draft!.state.input,context.episode.state.input)
  calls=0;await assert.rejects(flushModelDraft(()=>syncFixture(),async()=>{calls++}),reason('save'));assert.equal(calls,1)
})

function backupStorage(){
  const data=new Map<string,string>()
  return {data,getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)},removeItem:(key:string)=>{data.delete(key)}}
}
test('navigation backup requires an exact readable copy and propagates storage failure',()=>{
  const storage=backupStorage(),draft=syncFixture().draft!
  assert.deepEqual(confirmModelDraftBackup(storage,'a',draft),draft)
  assert.deepEqual(readModelDraft(storage,'a'),draft)
  for(const operation of ['read','write']){
    const failing={...storage,...(operation==='read'?{getItem:()=>{throw Error('read denied')}}:{setItem:()=>{throw Error('quota')}})}
    let left=false
    assert.throws(()=>{confirmModelDraftBackup(failing,'a',draft);left=true},operation==='read'?/read denied/:/quota/)
    assert.equal(left,false)
  }
})
test('ignored writes and corrupt or stale readback cannot authorize leaving',()=>{
  const draft=syncFixture().draft!
  for(const raw of [null,'broken',JSON.stringify({version:1,draft:{...draft,state:{...draft.state,input:'old'}}})]){
    let left=false
    const storage={getItem:()=>raw,setItem:()=>{},removeItem:()=>{}}
    assert.throws(()=>{confirmModelDraftBackup(storage,'a',draft);left=true},/не подтверждена/)
    assert.equal(left,false)
  }
})
test('unresolved recovery keeps its original baseline and rejects mismatched backup identity',()=>{
  const storage=backupStorage(),original=syncFixture().draft!,recovery=original.state
  writeModelDraft(storage,'a',original)
  const rebased={...original,baseState:{...original.baseState,input:'300'},state:{...original.state,input:'300'}}
  const before=storage.getItem('exam.model.a')
  const noWrite={...storage,setItem:()=>{throw Error('must not overwrite recovery')}}
  assert.deepEqual(confirmModelDraftBackup(noWrite,'a',rebased,recovery),original)
  assert.equal(storage.getItem('exam.model.a'),before)
  assert.throws(()=>confirmModelDraftBackup(noWrite,'b',rebased,recovery),/спорного ввода/)
  for(const changed of [{...rebased,episodeId:'other'},{...rebased,descriptorDigest:'b'.repeat(64)}])assert.throws(()=>confirmModelDraftBackup(noWrite,'a',changed,recovery),/спорного ввода/)
  assert.throws(()=>confirmModelDraftBackup(noWrite,'a',rebased,{...recovery,input:'different'}),/спорного ввода/)
  assert.equal(storage.getItem('exam.model.a'),before)
})

import {createModelAutosave,modelBindingOf,assertModelBinding,type ModelBinding} from './exam-local-model.ts'

function autosaveFixture(){
  const context=syncFixture(),writes:string[]=[],errors:unknown[]=[]
  let now=0,nextId=0,tail:Promise<unknown>=Promise.resolve(),fail=false
  const timers=new Map<number,{at:number;callback:()=>void}>()
  const autosave=createModelAutosave({set:(callback,delay)=>{const id=++nextId;timers.set(id,{at:now+delay,callback});return id},clear:id=>{timers.delete(id as number)}})
  const enqueue=(task:()=>Promise<void>)=>{const next=tail.catch(()=>{}).then(task);tail=next;return next}
  const read=()=>context
  const persist=async(binding?:ModelBinding)=>{
    if(binding)assertModelBinding(context,binding)
    writes.push(context.draft!.state.input)
    if(fail)throw Error('HTTP429')
    context.episode.state=structuredClone(context.draft!.state)
    context.draft!.baseState=context.episode.state
  }
  const schedule=()=>autosave.schedule(read,enqueue,persist,cause=>{errors.push(cause)})
  const advance=(ms:number)=>{now+=ms;for(const [id,timer] of [...timers].sort((a,b)=>a[1].at-b[1].at)){if(timer.at<=now&&timers.delete(id))timer.callback()}}
  const drain=async()=>{await tail.catch(()=>{});await Promise.resolve()}
  return {context,writes,errors,autosave,enqueue,read,persist,schedule,advance,drain,setFail:(value:boolean)=>{fail=value}}
}

test('React autosave scheduler: immediate failed return has one request, even after debounce and later edits',async()=>{
  const f=autosaveFixture();f.setFail(true);f.schedule();f.advance(699)
  const release=f.autosave.hold() // synchronous explicit admission, before queue entry
  await assert.rejects(f.enqueue(()=>flushModelDraft(f.read,()=>f.persist(),f.autosave)),reason('save'))
  release();f.advance(2000);await f.drain()
  assert.deepEqual(f.writes,['200']);assert.equal(f.context.draft!.state.input,'200')
  f.context.draft!.state={...f.context.draft!.state,input:'300'}
  f.schedule();f.advance(2000);await f.drain()
  assert.deepEqual(f.writes,['200']);assert.equal(f.context.draft!.state.input,'300')
  // Explicit retry is the only new request and confirms the latest input.
  f.setFail(false)
  await f.enqueue(()=>flushModelDraft(f.read,()=>f.persist(),f.autosave,f.autosave.admit(f.read(),true)))
  f.advance(2000);await f.drain()
  assert.deepEqual(f.writes,['200','300']);assert.equal(f.context.episode.state.input,'300')
})

test('React autosave scheduler: fired timer already queued behind work loses authority on explicit admission',async()=>{
  const f=autosaveFixture();f.setFail(true)
  let unblock!:()=>void
  const waiting=new Promise<void>(resolve=>{unblock=resolve})
  void f.enqueue(()=>waiting)
  f.schedule();f.advance(700) // callback queued, not merely a pending timer
  const release=f.autosave.hold()
  const attempt=f.enqueue(()=>flushModelDraft(f.read,()=>f.persist(),f.autosave))
  unblock();await assert.rejects(attempt,reason('save'));release()
  f.advance(2000);await f.drain()
  assert.deepEqual(f.writes,['200']);assert.deepEqual(f.errors,[])
})

test('React autosave scheduler: an edit after admission stays local and is included in explicit flush',async()=>{
  const f=autosaveFixture();f.schedule()
  const release=f.autosave.hold()
  f.context.draft!.state={...f.context.draft!.state,input:'350'}
  f.schedule();f.advance(1000);await f.drain()
  assert.deepEqual(f.writes,[])
  await f.enqueue(()=>flushModelDraft(f.read,()=>f.persist(),f.autosave));release()
  f.schedule();f.advance(1000);await f.drain()
  assert.deepEqual(f.writes,['350']);assert.equal(f.context.episode.state.input,'350')
})

test('React autosave scheduler: nested holds cannot resume a later explicit action',async()=>{
  const f=autosaveFixture(),first=f.autosave.hold(),second=f.autosave.hold()
  first();first();f.schedule();f.advance(700);await f.drain();assert.deepEqual(f.writes,[])
  second();f.schedule();f.advance(699);await f.drain();assert.deepEqual(f.writes,[])
  f.advance(1);await f.drain();assert.deepEqual(f.writes,['200'])
})

test('React autosave scheduler: a failed background write cancels newer pending work until explicit confirmation',async()=>{
  const f=autosaveFixture();let reject!:()=>void,started!:()=>void
  const entered=new Promise<void>(resolve=>{started=resolve})
  const waiting=new Promise<void>((_,rejectPromise)=>{reject=()=>rejectPromise(Error('HTTP429'))})
  f.autosave.schedule(f.read,f.enqueue,async()=>{f.writes.push('200');started();await waiting},cause=>{f.errors.push(cause)})
  f.advance(700);await entered
  f.context.draft!.state={...f.context.draft!.state,input:'400'};f.schedule()
  reject();await f.drain();f.advance(2000);await f.drain()
  assert.deepEqual(f.writes,['200']);assert.equal(f.errors.length,1)
  await f.enqueue(()=>flushModelDraft(f.read,()=>f.persist(),f.autosave,f.autosave.admit(f.read(),true)))
  f.context.draft!.state={...f.context.draft!.state,input:'500'};f.schedule();f.advance(700);await f.drain()
  assert.deepEqual(f.writes,['200','400','500'])
})

test('React autosave scheduler: stale work, episode, descriptor or closed model cannot run queued persistence',async()=>{
  for(const field of ['work','episode','digest','closed'] as const){
    const f=autosaveFixture(),admission=f.autosave.admit(f.read(),true);let unblock!:()=>void
    const waiting=new Promise<void>(resolve=>{unblock=resolve})
    void f.enqueue(()=>waiting);f.schedule();f.advance(700)
    if(field==='work')f.context.workId='work-b'
    if(field==='episode')f.context.episode.id='episode-b'
    if(field==='digest')f.context.episode.descriptorDigest='b'.repeat(64)
    if(field==='closed')f.context.open=false
    unblock();await f.drain();assert.deepEqual(f.writes,[],field)
    await assert.rejects(f.enqueue(async()=>{assertModelBinding(f.read(),admission!.binding);await flushModelDraft(f.read,()=>f.persist(),f.autosave,admission)}),reason('changed'))
    assert.deepEqual(f.writes,[],field)
  }
})

test('React autosave scheduler: unmount cancellation invalidates queued callbacks and pending timers',async()=>{
  const f=autosaveFixture();let unblock!:()=>void
  const waiting=new Promise<void>(resolve=>{unblock=resolve})
  void f.enqueue(()=>waiting);f.schedule();f.advance(700);f.autosave.cancel();unblock();await f.drain()
  f.schedule();f.autosave.cancel();f.advance(2000);await f.drain();assert.deepEqual(f.writes,[])
})

test('explicit flush preserves edits made during persistence and fails closed at its existing bound',async()=>{
  const f=autosaveFixture(),inputs:string[]=[]
  await flushModelDraft(f.read,async()=>{
    const snapshot=structuredClone(f.context.draft!.state);inputs.push(snapshot.input)
    if(inputs.length===1)f.context.draft!.state={...snapshot,input:'600'}
    f.context.episode.state=snapshot;f.context.draft!.baseState=snapshot
  },f.autosave)
  assert.deepEqual(inputs,['200','600']);assert.equal(f.context.draft!.state.input,'600')
  f.context.draft!.state={...f.context.draft!.state,input:'700'}
  let count=0
  await assert.rejects(flushModelDraft(f.read,async()=>{
    count++;f.context.episode.state=structuredClone(f.context.draft!.state);f.context.draft!.baseState=f.context.episode.state
    f.context.draft!.state={...f.context.draft!.state,input:String(700+count)}
  },f.autosave),reason('editing'))
  f.schedule();f.advance(2000);await f.drain();assert.equal(count,3);assert.deepEqual(f.writes,[])
  assert.equal(f.context.draft!.state.input,'703');assert.equal(f.context.episode.state.input,'702')
})

test('scheduler failure pause belongs to the exact model; conflict recovery prevents new automatic writes',async()=>{
  const f=autosaveFixture();f.autosave.block(modelBindingOf(f.context))
  f.context.workId='work-b';f.autosave.block(modelBindingOf(f.context))
  f.context.workId='work-a';f.schedule();f.advance(700);await f.drain();assert.deepEqual(f.writes,[])
  f.context.workId='work-c';f.schedule();f.advance(700);await f.drain();assert.deepEqual(f.writes,['200'])
  f.context.draft!.state={...f.context.draft!.state,input:'300'}
  f.context.recovery=true;f.schedule();f.advance(700);await f.drain();assert.deepEqual(f.writes,['200'])
  f.context.recovery=false;f.context.episode.state={...f.context.episode.state,input:'400'}
  f.schedule();f.advance(700);await f.drain();assert.deepEqual(f.writes,['200'])
})

test('in-flight rejection after return or check admission cannot become an implicit retry',async()=>{
  for(const action of ['return','check'] as const){
    const f=autosaveFixture();let started!:()=>void,reject!:()=>void
    const entered=new Promise<void>(resolve=>{started=resolve})
    const response=new Promise<void>((_,fail)=>{reject=()=>fail(Error('HTTP429'))})
    f.autosave.schedule(f.read,f.enqueue,async()=>{f.writes.push('200');started();await response},cause=>{f.errors.push(cause)})
    f.advance(700);await entered // POST really entered before click
    const admission=f.autosave.admit(f.read(),true),release=f.autosave.hold()
    const attempt=f.enqueue(async()=>{
      if(action==='return')await flushModelDraft(f.read,()=>f.persist(),f.autosave,admission)
      else {f.autosave.assertAdmission(modelBindingOf(f.context),admission);await f.persist()}
    })
    reject();await assert.rejects(attempt,reason('save'));release()
    f.advance(2000);await f.drain();assert.deepEqual(f.writes,['200']);assert.equal(f.errors.length,1)
    // Neither navigation nor an old click can authorize the failed write.
    await assert.rejects(flushModelDraft(f.read,()=>f.persist(),f.autosave,f.autosave.admit(f.read())),reason('save'))
    assert.deepEqual(f.writes,['200'])
    // A new explicit retry after observing the error authorizes exactly one write.
    const retry=f.autosave.admit(f.read(),true)
    await f.enqueue(()=>flushModelDraft(f.read,()=>f.persist(),f.autosave,retry))
    f.advance(2000);await f.drain();assert.deepEqual(f.writes,['200','200'])
  }
})
