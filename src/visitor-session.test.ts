import test from 'node:test'
import assert from 'node:assert/strict'
import { scopedStorage, sessionStorageKey } from './visitor-session.ts'

test('visitor drafts cannot read overwrite or remove another visitor or local owner keys', () => {
  const data = new Map<string,string>([['pole.notebook.v1','owner']])
  const storage = {getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)},removeItem:(key:string)=>{data.delete(key)}}
  const alice=scopedStorage(storage,'alice'), bob=scopedStorage(storage,'bob')
  for(const key of ['pole.notebook.v1','pole.learning-draft.v2.tab','pole.library.navigation.v1','pole.chat-draft.v1.work']) {
    alice.setItem(key,'alice answer')
    assert.equal(bob.getItem(key),null)
    bob.setItem(key,'bob answer')
    bob.removeItem(key)
    assert.equal(alice.getItem(key),'alice answer')
  }
  assert.equal(scopedStorage(storage,'local').getItem('pole.notebook.v1'),'owner')
  assert.equal(sessionStorageKey('alice','x'),'pole.visitor.alice.x')
  assert.throws(()=>sessionStorageKey('../','x'))
})
