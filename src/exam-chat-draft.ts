type StorageLike = Pick<Storage, 'getItem'|'setItem'|'removeItem'>
export type ChatContext = {quote:string;partId?:string;origin?:'answer'|'reasoning'|'excerpt';selection?:import('./exam-quote-selection').ExamQuoteRange;source?:{workId:string;revision:number;attemptId?:string;field:'answer'|'reasoning'|'excerpt';partId?:string;text:string;start?:number;end?:number;fieldDigest?:string}}
export type ExamChatDraft = {text:string;contexts:ChatContext[]}
const emptyDraft=():ExamChatDraft=>({text:'',contexts:[]})
const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9_.:-]{1,100}$/.test(value)
function selectionOf(value:unknown):ChatContext['selection'] {
  if(!record(value)||!Number.isSafeInteger(value.start)||!Number.isSafeInteger(value.end)||Number(value.start)<0||Number(value.end)<=Number(value.start)||Number(value.end)>80000||typeof value.fieldDigest!=='string'||!/^[a-f0-9]{64}$/.test(value.fieldDigest))return undefined
  return {start:Number(value.start),end:Number(value.end),fieldDigest:value.fieldDigest}
}
function sourceOf(value:unknown,workId:string):ChatContext['source'] {
  if(!record(value)||value.workId!==workId||!identifier(value.workId)||!Number.isSafeInteger(value.revision)||Number(value.revision)<0||typeof value.text!=='string'||value.text.length>4300)return undefined
  if(value.field!=='answer'&&value.field!=='reasoning'&&value.field!=='excerpt')return undefined
  if(value.partId!==undefined&&!identifier(value.partId)||value.attemptId!==undefined&&!identifier(value.attemptId))return undefined
  const hasAnchor=value.start!==undefined||value.end!==undefined||value.fieldDigest!==undefined
  const anchor=hasAnchor?selectionOf(value):undefined
  if(hasAnchor&&(!anchor||value.field==='excerpt'))return undefined
  return {workId:value.workId,revision:Number(value.revision),field:value.field,text:value.text,...(value.partId!==undefined?{partId:value.partId as string}:{}),...(value.attemptId!==undefined?{attemptId:value.attemptId as string}:{}),...anchor}
}
function contextsOf(value:unknown[],workId:string):ChatContext[] {
  return value.slice(0,6).flatMap(item=>{
    if(!record(item)||typeof item.quote!=='string'||!item.quote.trim()||item.quote.length>4000)return []
    const source=sourceOf(item.source,workId)
    const selection=selectionOf(item.selection)
    const origin=item.selection!==undefined&&!selection?'excerpt':item.origin==='answer'||item.origin==='reasoning'||item.origin==='excerpt'?item.origin:undefined
    return [{quote:item.quote,...(identifier(item.partId)?{partId:item.partId}:{}),...(origin?{origin}:{}),...(selection?{selection}:{}),...(source?{source}:{})}]
  })
}

/** One bounded record keeps a question and its literal citations together. */
export function readExamChatDraft(storage:StorageLike,workId:string):ExamChatDraft {
  const raw=storage.getItem(`exam.chat.${workId}`)
  if(!raw||raw.length>40000)return emptyDraft()
  let value:unknown
  try{
    value=JSON.parse(raw)
  }catch{
    // Old releases stored plain text in the same owner-scoped key.
    return /^\s*\{/.test(raw)&&/"(?:version|text|contexts)"\s*:/.test(raw)?emptyDraft():{text:raw.slice(0,4000),contexts:[]}
  }
  if(!record(value)&&!Array.isArray(value))return {text:raw.slice(0,4000),contexts:[]}
  if(!record(value)||value.version!==1||typeof value.text!=='string'||!Array.isArray(value.contexts))return emptyDraft()
  return {text:value.text.slice(0,4000),contexts:contextsOf(value.contexts,workId)}
}
export function writeExamChatDraft(storage:StorageLike,workId:string,draft:ExamChatDraft):void {
  if(!draft.text&&!draft.contexts.length){storage.removeItem(`exam.chat.${workId}`);return}
  const value=JSON.stringify({version:1,text:draft.text.slice(0,4000),contexts:contextsOf(draft.contexts,workId)})
  if(value.length>40000)throw Error('Слишком большой черновик вопроса. Текст остался на открытой странице.')
  storage.setItem(`exam.chat.${workId}`,value)
}
