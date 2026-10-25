import test from 'node:test'
import assert from 'node:assert/strict'
import {canRebaseExamSave,examRefreshDecision} from './exam-save-rebase.ts'
test('a pending chat metadata update can rebase a confirmed draft CAS rejection, another edit cannot',()=>{
  const base={id:'w',mode:'guided',modeEpoch:2,completed:false,answersByPart:{a:'2'} as Record<string,string>,reasoning:'Моя запись'}
  assert.equal(canRebaseExamSave(base,{...base}),true)
  const patches:Partial<typeof base>[]=[{id:'other'},{modeEpoch:3},{mode:'review'},{completed:true},{reasoning:'Другой вкладкой изменено'},{answersByPart:{a:'3'}},{answersByPart:{a:'2',b:'4'}}]
  for(const patch of patches)assert.equal(canRebaseExamSave(base,{...base,...patch}),false)
})
test('chat refresh cannot turn another tab edit into the baseline of a silent overwrite',()=>{
  const before={answersByPart:{a:'2'},reasoning:'Первый черновик'},local={...before,reasoning:'Моя новая мысль'},remote={...before,reasoning:'Другая вкладка изменила запись'}
  assert.equal(examRefreshDecision(before,local,remote),'conflict')
  assert.equal(examRefreshDecision(before,before,remote),'adopt')
  assert.equal(examRefreshDecision(before,local,before),'metadata')
  assert.equal(examRefreshDecision(before,remote,remote),'metadata')
})
