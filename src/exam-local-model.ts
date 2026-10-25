import type {StepModelState} from '../shared/step-model.mjs'
type StorageLike=Pick<Storage,'getItem'|'setItem'|'removeItem'>
export type ModelDraft={episodeId:string;descriptorDigest:string;baseState:StepModelState;state:StepModelState}
export type ModelSyncContext={workId:string;open:boolean;episode:{id:string;descriptorDigest:string;state:StepModelState};draft:ModelDraft|null;recovery:boolean}
export type ModelBinding={workId:string;episodeId:string;descriptorDigest:string}
export const modelBindingOf=(context:ModelSyncContext):ModelBinding=>({workId:context.workId,episodeId:context.episode.id,descriptorDigest:context.episode.descriptorDigest})
export type ModelSaveAdmission={binding:ModelBinding;failure:number|undefined;retry:boolean}
const bindingKey=(binding:ModelBinding)=>JSON.stringify([binding.workId,binding.episodeId,binding.descriptorDigest])
export function assertModelBinding(context:ModelSyncContext|null,binding:ModelBinding):asserts context is ModelSyncContext{
  if(!context?.open||bindingKey(modelBindingOf(context))!==bindingKey(binding))throw new ModelSyncError('changed')
}
type AutosaveClock={set:(callback:()=>void,delay:number)=>unknown;clear:(timer:unknown)=>void}
/** Debounce authority is checked inside the serial queue, not only when its timer fires. */
export function createModelAutosave(clock:AutosaveClock={set:(callback,delay)=>setTimeout(callback,delay),clear:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>)}){
  let generation=0,timer:unknown=null,holds=0
  const blocked=new Map<string,number>()
  let failures=0
  const cancel=()=>{generation++;if(timer!==null){clock.clear(timer);timer=null}}
  const block=(binding:ModelBinding)=>{cancel();blocked.set(bindingKey(binding),++failures)}
  const confirm=(binding:ModelBinding)=>{blocked.delete(bindingKey(binding))}
  const admit=(context:ModelSyncContext|null,retry=false):ModelSaveAdmission|null=>context?.open?{binding:modelBindingOf(context),failure:blocked.get(bindingKey(modelBindingOf(context))),retry}:null
  const assertAdmission=(binding:ModelBinding,admission:ModelSaveAdmission|null=null)=>{
    if(admission&&bindingKey(admission.binding)!==bindingKey(binding))throw new ModelSyncError('changed')
    const failure=blocked.get(bindingKey(binding))
    if(failure!==undefined&&(!admission?.retry||admission.failure!==failure))throw new ModelSyncError('save')
  }
  const hold=()=>{cancel();holds++;let released=false;return()=>{if(!released){released=true;holds--}}}
  const schedule=(read:()=>ModelSyncContext|null,enqueue:(task:()=>Promise<void>)=>Promise<unknown>,persist:(binding:ModelBinding)=>Promise<void>,onError:(cause:unknown)=>void)=>{
    cancel()
    const initial=read()
    if(!initial?.open||!initial.draft||initial.recovery||initial.draft.episodeId!==initial.episode.id||initial.draft.descriptorDigest!==initial.episode.descriptorDigest||modelDraftConflicts(initial.draft,initial.episode)||JSON.stringify(initial.draft.state)===JSON.stringify(initial.episode.state))return()=>{}
    const binding=modelBindingOf(initial),key=bindingKey(binding),token=generation
    if(holds||blocked.has(key))return()=>{}
    const current=()=>{try{assertModelBinding(read(),binding);return true}catch{return false}}
    timer=clock.set(()=>{
      timer=null
      void enqueue(async()=>{
        if(token!==generation||holds||blocked.has(key)||!current())return
        const latest=read()
        if(!latest?.draft||latest.recovery||latest.draft.episodeId!==binding.episodeId||latest.draft.descriptorDigest!==binding.descriptorDigest||modelDraftConflicts(latest.draft,latest.episode))return
        await persist(binding)
      }).catch(cause=>{if(current()){block(binding);onError(cause)}})
    },700)
    return()=>{if(token===generation)cancel()}
  }
  return {cancel,block,confirm,hold,schedule,admit,assertAdmission}
}
export type ModelAutosave=ReturnType<typeof createModelAutosave>
export class ModelSyncError extends Error {
  readonly reason:'save'|'conflict'|'changed'|'editing'
  constructor(reason:ModelSyncError['reason'],cause?:unknown){
    super({save:'Не удалось подтвердить сохранение разбора. Переход не выполнен.',conflict:'Разбор изменён. Сначала выбери, какой ввод продолжить.',changed:'Работа или разбор изменились. Повтори переход из текущей работы.',editing:'Ввод продолжает меняться. Заверши редактирование и повтори переход.'}[reason],cause===undefined?undefined:{cause})
    this.name='ModelSyncError';this.reason=reason
  }
}
/** Explicit navigation flush: only confirmed saves may be followed by another save of newer input. */
export async function flushModelDraft(read:()=>ModelSyncContext|null,persist:()=>Promise<void>,autosave?:ModelAutosave,admission:ModelSaveAdmission|null=null):Promise<void>{
  const release=autosave?.hold()
  let binding:ModelBinding|null=null,admitted=false
  try{
  const initial=read()
  if(!initial?.open)return
  binding=modelBindingOf(initial)
  const bound=binding
  autosave?.assertAdmission(bound,admission);admitted=true
  const same=(a:StepModelState,b:StepModelState)=>JSON.stringify(a)===JSON.stringify(b)
  const check=(value:ModelSyncContext|null):ModelSyncContext=>{
    assertModelBinding(value,bound)
    if(value.recovery||value.draft&&(value.draft.descriptorDigest!==bound.descriptorDigest||modelDraftConflicts(value.draft,value.episode)))throw new ModelSyncError('conflict')
    return value
  }
  let current=check(initial)
  for(let count=0;count<3;count++){
    if(!current.draft||same(current.draft.state,current.episode.state)){autosave?.confirm(bound);return}
    const sent=structuredClone(current.draft.state)
    try{await persist()}catch(cause){throw new ModelSyncError('save',cause)}
    current=check(read())
    // A resolved callback alone is not confirmation that this snapshot was saved.
    if(!same(current.episode.state,sent))throw new ModelSyncError('save')
    if(!current.draft||same(current.draft.state,current.episode.state)){autosave?.confirm(bound);return}
  }
  throw new ModelSyncError('editing')
  }catch(cause){if(binding&&admitted)autosave?.block(binding);throw cause}
  finally{release?.()}
}
export function modelDraftConflicts(draft:ModelDraft,server:{id:string;state:StepModelState}){
  return draft.episodeId!==server.id||JSON.stringify(server.state)!==JSON.stringify(draft.baseState)&&JSON.stringify(server.state)!==JSON.stringify(draft.state)
}
const validState=(value:unknown):value is StepModelState=>{
  if(!value||typeof value!=='object')return false
  const item=value as StepModelState
  return typeof item.input==='string'&&item.input.length<=120&&typeof item.choice==='string'&&item.choice.length<=32&&Number.isInteger(item.reveal)&&item.reveal>=0&&item.reveal<=2
}
const valid=(value:unknown):value is ModelDraft=>{
  if(!value||typeof value!=='object')return false
  const item=value as ModelDraft
  return typeof item.episodeId==='string'&&item.episodeId.length<=100&&typeof item.descriptorDigest==='string'&&/^[a-f0-9]{64}$/.test(item.descriptorDigest)&&validState(item.baseState)&&validState(item.state)
}
/** One bounded, unassessed draft per work, scoped by learnerStorage. */
export function readModelDraft(storage:StorageLike,workId:string):ModelDraft|null{
  const raw=storage.getItem(`exam.model.${workId}`)
  if(!raw||raw.length>4000)return null
  try{const value=JSON.parse(raw);return value?.version===1&&valid(value.draft)?value.draft:null}catch{return null}
}
export function writeModelDraft(storage:StorageLike,workId:string,draft:ModelDraft){
  if(!valid(draft))throw Error('Некорректный черновик разбора')
  const raw=JSON.stringify({version:1,draft})
  if(raw.length>4000)throw Error('Черновик разбора слишком большой')
  storage.setItem(`exam.model.${workId}`,raw)
}
export function clearModelDraft(storage:StorageLike,workId:string){storage.removeItem(`exam.model.${workId}`)}
/** A leave fallback requires readable backup evidence, not merely a successful setItem call. */
export function confirmModelDraftBackup(storage:StorageLike,workId:string,draft:ModelDraft,recovery:StepModelState|null=null):ModelDraft{
  const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b)
  if(recovery){
    const saved=readModelDraft(storage,workId)
    if(!saved||saved.episodeId!==draft.episodeId||saved.descriptorDigest!==draft.descriptorDigest||!same(saved.state,recovery))throw Error('Не удалось подтвердить локальную копию спорного ввода. Останься в разборе и выбери версию.')
    return saved
  }
  writeModelDraft(storage,workId,draft)
  const saved=readModelDraft(storage,workId)
  if(!same(saved,draft))throw Error('Локальная копия разбора не подтверждена. Останься на странице и повтори сохранение.')
  return saved!
}
