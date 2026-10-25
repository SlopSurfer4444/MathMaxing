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

const work = (overrides: Partial<Work> = {}) => ({ id: 'w', problemId: 'p', revision: 3, modeEpoch: 2,
  mode: 'guided', document: { type: 'doc', content: [{ type: 'text', text: 'current' }] },
  finalAnswer: 'current answer', generalAnswer: 'current general answer', messages: [], submissions: [],
  createdAt: '2026-10-23T10:00:00Z', updatedAt: '2026-10-23T10:00:00Z', priorExposure: false,
  ...overrides } as Work)
const preparation = (id: string, revision: number, answer: string, completed = false) => ({
  id, revision, exerciseId: 'root-selection', answer, completed, documentRevision: 3,
  startedAt: '2026-10-23T10:00:00Z', attempts: [],
})

test('older mode epoch cannot reopen solo mode at the same document revision', () => {
  const current = work({ mode: 'guided', modeEpoch: 4, correctionOf: 'submitted-attempt' })
  const old = work({ mode: 'solo', modeEpoch: 3 })
  const merged = mergeWork(current, old)
  assert.equal(merged.revision, 3)
  assert.equal(merged.modeEpoch, 4)
  assert.equal(merged.mode, 'guided')
  assert.equal(merged.correctionOf, 'submitted-attempt')
})

test('newer document merges without rolling mode, preparation instance or return history backward', () => {
  const returned = preparation('returned-prep', 5, 'π', true)
  const current = work({ mode: 'review', modeEpoch: 5, preparation: returned, preparationHistory: [returned] })
  const incoming = work({ revision: 4, modeEpoch: 3, mode: 'guided', document: { type: 'doc', content: [{ type: 'text', text: 'saved later' }] },
    finalAnswer: 'new answer', generalAnswer: 'new general answer', preparation: preparation('old-prep', 99, 'old answer'), preparationHistory: [] })
  const merged = mergeWork(current, incoming)
  assert.equal(merged.revision, 4)
  assert.deepEqual(merged.document, incoming.document)
  assert.equal(merged.finalAnswer, 'new answer')
  assert.equal(merged.generalAnswer, 'new general answer')
  assert.equal(merged.modeEpoch, 5)
  assert.equal(merged.mode, 'review')
  assert.deepEqual(merged.preparation, returned)
  assert.deepEqual(merged.preparationHistory, [returned])
})

test('newer lifecycle merges even when its document snapshot is older', () => {
  const current = work({ revision: 7, modeEpoch: 2, mode: 'solo' })
  const next = work({ revision: 6, modeEpoch: 3, mode: 'guided', document: { type: 'doc' }, finalAnswer: 'old answer', generalAnswer: 'old general answer' })
  const merged = mergeWork(current, next)
  assert.equal(merged.revision, 7)
  assert.deepEqual(merged.document, current.document)
  assert.equal(merged.finalAnswer, current.finalAnswer)
  assert.equal(merged.generalAnswer, current.generalAnswer)
  assert.equal(merged.modeEpoch, 3)
  assert.equal(merged.mode, 'guided')
})

test('older same-preparation answer/check cannot erase a newer answer, result or attempts', () => {
  const checked = { ...preparation('same', 4, 'π/3'), result: { status: 'correct' as const, summary: 'Проверено' },
    attempts: [{ answer: 'π/3', result: { status: 'correct' as const, summary: 'Проверено' }, createdAt: '2026-10-23T10:01:00Z' }] }
  const current = work({ preparation: checked })
  const older = work({ revision: 4, preparation: preparation('same', 3, '0') })
  const merged = mergeWork(current, older)
  assert.equal(merged.revision, 4)
  assert.deepEqual(merged.preparation, checked)
  assert.equal(merged.preparation?.answer, 'π/3')
  assert.equal(merged.preparation?.result?.status, 'correct')
})

test('newer same-preparation revision is admitted despite an older document snapshot', () => {
  const current = work({ revision: 8, preparation: preparation('same', 1, 'first') })
  const incoming = work({ revision: 7, preparation: preparation('same', 2, 'revised') })
  const merged = mergeWork(current, incoming)
  assert.equal(merged.revision, 8)
  assert.equal(merged.preparation?.revision, 2)
  assert.equal(merged.preparation?.answer, 'revised')
})

test('a new preparation instance uses the transition epoch rather than comparing unrelated revisions', () => {
  const old = preparation('old-instance', 20, 'old answer', true)
  const fresh = preparation('new-instance', 0, '')
  const current = work({ revision: 8, modeEpoch: 4, preparation: old, preparationHistory: [old] })
  const incoming = work({ revision: 7, modeEpoch: 5, preparation: fresh, preparationHistory: [old] })
  const next = mergeWork(current, incoming)
  assert.equal(next.revision, 8)
  assert.equal(next.modeEpoch, 5)
  assert.deepEqual(next.preparation, fresh)
  const oldPoll = work({ revision: 9, modeEpoch: 4, preparation: old })
  const merged = mergeWork(next, oldPoll)
  assert.equal(merged.revision, 9)
  assert.equal(merged.modeEpoch, 5)
  assert.deepEqual(merged.preparation, fresh)
})

test('returning from preparation cannot be undone by an earlier answer readback', () => {
  const returned = preparation('same', 5, 'π/3', true)
  const current = work({ modeEpoch: 6, preparation: returned, preparationHistory: [returned] })
  const late = work({ modeEpoch: 5, preparation: preparation('same', 4, 'π/3') })
  const merged = mergeWork(current, late)
  assert.equal(merged.modeEpoch, 6)
  assert.equal(merged.preparation?.completed, true)
  assert.equal(merged.preparation?.revision, 5)
  assert.deepEqual(merged.preparationHistory, [returned])
})

test('different work IDs replace context and inputs remain unchanged during clock merging', () => {
  const current = work({ preparation: preparation('same', 5, 'current') })
  const incoming = work({ revision: 2, modeEpoch: 3, preparation: preparation('same', 4, 'older') })
  const original = structuredClone({ current, incoming })
  mergeWork(current, incoming)
  assert.deepEqual({ current, incoming }, original)
  const other = work({ id: 'other', revision: 0, modeEpoch: 0, mode: 'solo' })
  assert.equal(mergeWork(current, other), other)
  assert.equal(mergeWork(null, incoming), incoming)
})

const numericPreparation = (id:string,revision:number,answer:string,completed=false) => ({
  id,revision,answer,open:!completed,completed,helpId:'help-p',contentVersion:1,startedAt:'2026-10-23T10:00:00Z',attempts:[],
  help:{title:'Подготовка',introduction:'Объяснение',steps:[],example:{prompt:'Пример',steps:[]},check:{prompt:'Проба',answerUnit:'рублей'}},
})
test('numeric preparation revision protects its answer/result independently of the document',()=>{
  const checked={...numericPreparation('same',5,'150'),result:{status:'correct' as const,summary:'Числовой ответ верный'}}
  const current=work({numericPreparation:checked})
  const incoming=work({revision:4,numericPreparation:numericPreparation('same',4,'15')})
  const merged=mergeWork(current,incoming)
  assert.equal(merged.revision,4)
  assert.deepEqual(merged.numericPreparation,checked)
  const later=work({revision:2,numericPreparation:numericPreparation('same',6,'пересмотренный ответ')})
  assert.equal(mergeWork(merged,later).numericPreparation?.answer,'пересмотренный ответ')
})
test('numeric preparation instance and completed history follow mode epoch across delayed readbacks',()=>{
  const completed=numericPreparation('finished',9,'150',true)
  const current=work({modeEpoch:5,numericPreparation:completed,numericPreparationHistory:[completed]})
  const late=work({revision:4,modeEpoch:4,numericPreparation:numericPreparation('finished',8,'150'),numericPreparationHistory:[]})
  const returned=mergeWork(current,late)
  assert.equal(returned.revision,4)
  assert.equal(returned.numericPreparation?.completed,true)
  assert.deepEqual(returned.numericPreparationHistory,[completed])
  const fresh=numericPreparation('new-instance',0,'')
  const opened=mergeWork(returned,work({revision:3,modeEpoch:6,numericPreparation:fresh,numericPreparationHistory:[completed]}))
  assert.equal(opened.revision,4)
  assert.deepEqual(opened.numericPreparation,fresh)
  const oldHighRevision=work({revision:5,modeEpoch:5,numericPreparation:completed,numericPreparationHistory:[completed]})
  assert.deepEqual(mergeWork(opened,oldHighRevision).numericPreparation,fresh)
})
test('exposure cannot regress when an earlier readback carries the same document and mode versions',()=>{
  const current=work({numericHelpSeen:true})
  const old=work()
  assert.equal(mergeWork(current,old).numericHelpSeen,true)
  assert.equal(mergeWork(old,current).numericHelpSeen,true)
})

const assistance=(id:string,version?:number,createdAt='2026-10-23T10:00:00Z')=>({
  guidance:{id,text:`Помощь ${id}`,kind:'explanation' as const,revision:3,modeEpoch:2},createdAt,
  ...(version===undefined?{}:{version}),
})
test('older assistance cannot replace a newer accepted response at identical document and mode versions',()=>{
  const latest=assistance('g3',3,'2026-10-23T10:03:00Z')
  const old=assistance('g2',2,'2026-10-23T12:00:00Z')
  const current=work({assistance:latest,assistanceHistory:[{...latest,reply:'Уже понял базу'}]})
  const incoming=work({assistance:old,assistanceHistory:[{...old,reply:'Не знаю'}]})
  const merged=mergeWork(current,incoming)
  assert.equal(merged.revision,current.revision)
  assert.equal(merged.modeEpoch,current.modeEpoch)
  assert.deepEqual(merged.assistance,latest)
  assert.deepEqual(merged.assistanceHistory?.map(item=>item.guidance.id),['g2','g3'])
  assert.equal(merged.assistanceHistory?.at(-1)?.reply,'Уже понял базу')
})
test('new accepted assistance advances its own sequence without document edits or mode changes',()=>{
  const old=assistance('g1',1),latest=assistance('g2',2)
  const merged=mergeWork(work({assistance:old}),work({assistance:latest}))
  assert.deepEqual(merged.assistance,latest)
  assert.equal(merged.revision,3)
  assert.equal(merged.modeEpoch,2)
  const tie={...latest,guidance:{...latest.guidance,text:'Запоздалое противоречивое эхо'},createdAt:'2026-10-24T10:00:00Z'}
  assert.deepEqual(mergeWork(merged,work({assistance:tie})).assistance,latest)
})
test('snapshots without assistance cannot erase a reply or its history even with a newer document',()=>{
  const accepted=assistance('accepted',5)
  const current=work({assistance:accepted,assistanceHistory:[{...accepted,reply:'Мой вопрос'}]})
  const merged=mergeWork(current,work({revision:4}))
  assert.equal(merged.revision,4)
  assert.deepEqual(merged.assistance,accepted)
  assert.deepEqual(merged.assistanceHistory,current.assistanceHistory)
})
test('legacy assistance uses creation time with current-on-tie fallback and cannot supersede a server version',()=>{
  const older=assistance('legacy-old',undefined,'2026-10-23T10:00:00Z')
  const later=assistance('legacy-new',undefined,'2026-10-23T10:01:00Z')
  assert.deepEqual(mergeWork(work({assistance:later}),work({assistance:older})).assistance,later)
  assert.deepEqual(mergeWork(work({assistance:older}),work({assistance:later})).assistance,later)
  const tie=assistance('legacy-tie',undefined,later.createdAt)
  assert.deepEqual(mergeWork(work({assistance:later}),work({assistance:tie})).assistance,later)
  const versioned=assistance('server-sequence',1,'2026-10-23T09:00:00Z')
  assert.deepEqual(mergeWork(work({assistance:later}),work({assistance:versioned})).assistance,versioned)
  assert.deepEqual(mergeWork(work({assistance:versioned}),work({assistance:later})).assistance,versioned)
  const invalid=assistance('unknown-time',undefined,'invalid')
  assert.deepEqual(mergeWork(work({assistance:later}),work({assistance:invalid})).assistance,later)
})
test('assistance histories union by guidance ID, preserve accepted duplicate data and retain the newest sixteen',()=>{
  const entries=Array.from({length:25},(_,index)=>({...assistance(`g${index+1}`,index+1),reply:`Ответ ${index+1}`}))
  const current=work({assistance:entries[24],assistanceHistory:entries.slice(9)})
  const old=work({assistance:entries[23],assistanceHistory:entries.slice(0,24).map(item=>item.guidance.id==='g20'?{...item,reply:'Старое эхо с другой записью'}:item)})
  const before=structuredClone({current,old}),merged=mergeWork(current,old)
  assert.equal(merged.assistanceHistory?.length,16)
  assert.deepEqual(merged.assistanceHistory?.map(item=>item.version),Array.from({length:16},(_,index)=>index+10))
  assert.equal(new Set(merged.assistanceHistory?.map(item=>item.guidance.id)).size,16)
  assert.equal(merged.assistanceHistory?.find(item=>item.guidance.id==='g20')?.reply,'Ответ 20')
  assert.deepEqual({current,old},before)
  const corrected={...entries[24],version:26,reply:'Более новая серверная запись того же шага'}
  const advanced=mergeWork(merged,work({assistance:corrected,assistanceHistory:[corrected]}))
  assert.equal(advanced.assistanceHistory?.filter(item=>item.guidance.id==='g25').length,1)
  assert.equal(advanced.assistanceHistory?.at(-1)?.version,26)
  assert.equal(advanced.assistanceHistory?.at(-1)?.reply,corrected.reply)
})
