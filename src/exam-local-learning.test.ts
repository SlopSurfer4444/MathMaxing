import test from 'node:test'
import assert from 'node:assert/strict'
import {readProbeDrafts,writeProbeDrafts} from './exam-local-learning.ts'
test('unsubmitted probes survive family hops and reload without fabricating checks',()=>{
  const records=new Map<string,string>(),storage={getItem:(key:string)=>records.get(key)??null,setItem:(key:string,value:string)=>{records.set(key,value)}}
  writeProbeDrafts(storage,'work-a',new Map([['arith.percent-base','180'],['finance.savings','242']]))
  assert.deepEqual([...readProbeDrafts(storage,'work-a')],[['arith.percent-base','180'],['finance.savings','242']])
  assert.equal(readProbeDrafts(storage,'work-b').size,0)
  storage.getItem=()=>JSON.stringify({version:1,answers:[['good','20'],['bad',{}],['../x','1']]})
  assert.deepEqual([...readProbeDrafts(storage,'work-a')],[['good','20']])
})
