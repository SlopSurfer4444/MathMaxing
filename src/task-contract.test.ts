import { test } from 'node:test'
import assert from 'node:assert/strict'
import { taskContract, isNumericProblem } from './task-contract.ts'
import type { Problem } from './api-types'
const legacy: Problem = { id:'old',title:'Уравнение',equation:'sin x=0',interval:'[0;pi]',description:'',skills:[] }
test('legacy trig contract retains a/b, notebook and bounded check capabilities',()=>{
 const result=taskContract(legacy)
 assert.equal(result.input,'notebook');assert.deepEqual(result.requirements.map(r=>r.answerField),['generalAnswer','finalAnswer']);assert.equal(result.capabilities.photo,true);assert.equal(result.capabilities.reasoningVerdict,false)
 assert.deepEqual(result.examAlignment,{kind:'exam-task',year:2026,position:13,label:'Профильный ЕГЭ · задание 13 · формат 2026'})
})
test('numeric topic has one scalar requirement and no invented exam task number',()=>{
 const problem={...legacy,kind:'numeric' as const,packageId:'percentages',contentVersion:2};const result=taskContract(problem)
 assert.equal(isNumericProblem(problem),true);assert.equal(isNumericProblem(undefined),false);assert.equal(result.contentVersion,2)
 assert.deepEqual(result.requirements,[{id:'answer',label:'Ответ',answerField:'finalAnswer'}]);assert.equal(result.capabilities.photo,false);assert.equal(result.capabilities.exactGeneralAnswer,false);assert.equal(result.examAlignment.kind,'preparation');assert.equal('position' in result.examAlignment,false)
})

test('graph and interval packs retain distinct inputs and scalar answer fields',()=>{
 for(const [packageId,kind,input] of [['graphs','numeric','number'],['inequalities','interval','interval']] as const){
  const contract=taskContract({...legacy,packageId,kind})
  assert.equal(contract.packageId,packageId);assert.equal(contract.input,input)
  assert.deepEqual(contract.requirements.map(r=>r.answerField),['finalAnswer'])
  assert.equal(contract.capabilities.exactGeneralAnswer,false);assert.equal(contract.examAlignment.kind,'preparation')
 }
})
