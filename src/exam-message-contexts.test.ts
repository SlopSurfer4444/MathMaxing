import test from 'node:test'
import assert from 'node:assert/strict'
import { examMessageContexts } from './exam-message-contexts.ts'

test('each assistant annotation belongs to its originating question',()=>{
  const messages=[{id:'q1',role:'user',contexts:[{quote:'первая запись'}]},{id:'a1',role:'assistant'},{id:'q2',role:'user',contexts:[{quote:'вторая запись'}]},{id:'a2',role:'assistant'}]
  assert.deepEqual(examMessageContexts(messages,'a1'),[{quote:'первая запись'}])
  assert.deepEqual(examMessageContexts(messages,'a2'),[{quote:'вторая запись'}])
})
test('a question without quotes cannot inherit an earlier annotation',()=>{
  const messages=[{id:'q1',role:'user',contexts:[{quote:'старая запись'}]},{id:'a1',role:'assistant'},{id:'q2',role:'user'},{id:'a2',role:'assistant'}]
  assert.deepEqual(examMessageContexts(messages,'a2'),[])
  assert.deepEqual(examMessageContexts(messages,'missing'),[])
})
test('explicit reply contexts stay bound even when another question intervenes',()=>{
  const messages=[{id:'q1',role:'user',contexts:[{quote:'первая запись'}]},{id:'q2',role:'user',contexts:[{quote:'вторая запись'}]},{id:'a1',role:'assistant',contexts:[{quote:'первая запись'}]}]
  assert.deepEqual(examMessageContexts(messages,'a1'),[{quote:'первая запись'}])
})
