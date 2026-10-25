type SavedWork={id:string;mode:string;modeEpoch:number;completed:boolean;answersByPart:Record<string,string>;reasoning:string}
/** A confirmed CAS rejection may be retried only when another operation changed
 * metadata, not the saved learner text or its editing permission. */
export function canRebaseExamSave(base:SavedWork,latest:SavedWork):boolean {
  return base.id===latest.id&&base.mode===latest.mode&&base.modeEpoch===latest.modeEpoch&&!latest.completed&&latest.mode!=='review'&&base.reasoning===latest.reasoning&&Object.keys(base.answersByPart).length===Object.keys(latest.answersByPart).length&&Object.entries(base.answersByPart).every(([key,value])=>latest.answersByPart[key]===value)
}

type Draft=Pick<SavedWork,'answersByPart'|'reasoning'>
const sameText=(a:Draft,b:Draft)=>a.reasoning===b.reasoning&&Object.keys(a.answersByPart).length===Object.keys(b.answersByPart).length&&Object.entries(a.answersByPart).every(([key,value])=>b.answersByPart[key]===value)
export function examRefreshDecision(base:Draft,local:Draft,latest:Draft):'metadata'|'adopt'|'conflict' {
  if(sameText(base,latest)||sameText(local,latest))return 'metadata'
  return sameText(base,local)?'adopt':'conflict'
}
