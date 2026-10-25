import test from 'node:test'
import assert from 'node:assert/strict'
import { assistanceContextKey } from './assistance-context.ts'

test('help context changes for an explicit request or preparation version, not an assistant echo',()=>{
  const work={messages:[{role:'user',requestId:'one'}],numericPreparation:{id:'p',revision:1,open:true,completed:false}}
  const base=assistanceContextKey(work)
  assert.equal(assistanceContextKey({...work,messages:[...work.messages,{role:'assistant',requestId:'one'}]}),base)
  assert.notEqual(assistanceContextKey({...work,messages:[...work.messages,{role:'user',requestId:'two'}]}),base)
  assert.notEqual(assistanceContextKey({...work,numericPreparation:{...work.numericPreparation,revision:2}}),base)
  assert.notEqual(assistanceContextKey({...work,numericPreparation:{...work.numericPreparation,open:false,completed:true}}),base)
})
