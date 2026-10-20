import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeWork } from './merge-work.ts'
import type { Work } from './api-types'
test('old save cannot erase a reply or a new submission or regress review', () => {
  const current = {id:'w',revision:3,document:{type:'doc'},messages:[{id:'m',status:'sent',stale:true}],submissions:[{id:'s',reviewStatus:'ready',reviewVersion:2},{id:'new',reviewVersion:1}]} as unknown as Work
  const old = {...current,revision:2,messages:[],submissions:[{id:'s',reviewStatus:'pending',reviewVersion:1}]} as unknown as Work
  const merged = mergeWork(current,old)
  assert.equal(merged.revision,3)
  assert.equal(merged.messages[0].stale,true)
  assert.equal(merged.submissions.length,2)
  assert.equal(merged.submissions[0].reviewStatus,'ready')
})
test('explicit retry is newer than a failed review, stale annotation survives echo', () => {
  const current={id:'w',revision:1,messages:[{id:'m',status:'sent',stale:true}],submissions:[{id:'s',reviewStatus:'failed',reviewVersion:2}]} as unknown as Work
  const next={...current,messages:[{id:'m',status:'sent',stale:false}],submissions:[{id:'s',reviewStatus:'pending',reviewVersion:3}]} as unknown as Work
  assert.equal(mergeWork(current,next).submissions[0].reviewStatus,'pending')
  assert.equal(mergeWork(current,next).messages[0].stale,true)
})
