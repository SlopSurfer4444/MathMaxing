import type { AssistanceRecord, Work } from './api-types'

const assistanceVersion=(value:AssistanceRecord|undefined)=>{
  const version=value?.version
  return typeof version==='number'&&Number.isSafeInteger(version)&&version>0?version:0
}
const assistanceTime=(value:AssistanceRecord)=>{const time=Date.parse(value.createdAt);return Number.isFinite(time)?time:0}
function newerAssistance<T extends AssistanceRecord>(current:T|undefined,incoming:T|undefined):T|undefined{
  if(!current)return incoming
  if(!incoming)return current
  const oldVersion=assistanceVersion(current),newVersion=assistanceVersion(incoming)
  // Server versions are authoritative. Legacy records have timestamps only;
  // an equal or unknown generation must not replace the displayed guidance.
  if(oldVersion||newVersion)return newVersion>oldVersion?incoming:current
  return assistanceTime(incoming)>assistanceTime(current)?incoming:current
}

// Network readbacks can arrive out of order. Never erase a newer message or
// submission just because an older save/poll carried an earlier work snapshot.
export function mergeWork(current: Work | null, incoming: Work): Work {
  if (!current || current.id !== incoming.id) return incoming
  const messages = new Map(current.messages.map(item => [item.id, item]))
  for (const item of incoming.messages) {
    const old = messages.get(item.id)
    const keepSent = old?.status === 'sent' && item.status !== 'sent'
    messages.set(item.id, { ...(keepSent ? old : item), stale: old?.stale || item.stale })
  }
  const submissions = new Map(current.submissions.map(item => [item.id, item]))
  for (const item of incoming.submissions) {
    const old = submissions.get(item.id)
    if (!old || (item.reviewVersion ?? 0) >= (old.reviewVersion ?? 0)) submissions.set(item.id, item)
  }
  // Document edits, mode/preparation transitions and preparation answers have
  // separate clocks. A newer document cannot make an older mode current again.
  const base = incoming.revision < current.revision ? current : incoming
  const lifecycle = (incoming.modeEpoch ?? 0) < (current.modeEpoch ?? 0) ? current : incoming
  let preparation = lifecycle.preparation
  if (current.preparation && incoming.preparation && current.preparation.id === incoming.preparation.id) {
    preparation = (incoming.preparation.revision ?? 0) < (current.preparation.revision ?? 0)
      ? current.preparation : incoming.preparation
  }
  let numericPreparation = lifecycle.numericPreparation
  if (current.numericPreparation && incoming.numericPreparation && current.numericPreparation.id === incoming.numericPreparation.id) {
    numericPreparation = incoming.numericPreparation.revision < current.numericPreparation.revision
      ? current.numericPreparation : incoming.numericPreparation
  }
  const assistance=newerAssistance(current.assistance,incoming.assistance)
  const assistanceHistory=new Map((current.assistanceHistory??[]).map(item=>[item.guidance.id,item]))
  for(const item of incoming.assistanceHistory??[]){
    assistanceHistory.set(item.guidance.id,newerAssistance(assistanceHistory.get(item.guidance.id),item)!)
  }
  const orderedAssistanceHistory=[...assistanceHistory.values()].sort((left,right)=>{
    const leftVersion=assistanceVersion(left),rightVersion=assistanceVersion(right)
    return leftVersion||rightVersion?leftVersion-rightVersion:assistanceTime(left)-assistanceTime(right)
  }).slice(-16)
  return { ...base, mode: lifecycle.mode, modeEpoch: lifecycle.modeEpoch,
    correctionOf: lifecycle.correctionOf, preparation, preparationHistory: lifecycle.preparationHistory,
    numericPreparation, numericPreparationHistory:lifecycle.numericPreparationHistory,
    numericHelpSeen:current.numericHelpSeen||incoming.numericHelpSeen,
    assistance,assistanceHistory:orderedAssistanceHistory,
    messages: [...messages.values()], submissions: [...submissions.values()] }
}
