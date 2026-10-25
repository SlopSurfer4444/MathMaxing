type StorageLike=Pick<Storage,'getItem'|'setItem'>
const MAX_RECORD=180000

/** Owner scoping is supplied by learnerStorage. No assessed result is invented. */
export function readProbeDrafts(storage:StorageLike,workId:string):Map<string,string> {
  const raw=storage.getItem(`exam.probes.${workId}`)
  if(!raw||raw.length>MAX_RECORD)return new Map()
  try{
    const value=JSON.parse(raw)
    if(value?.version!==1||!Array.isArray(value.answers))return new Map()
    return new Map(value.answers.slice(0,39).filter((pair:unknown):pair is [string,string]=>Array.isArray(pair)&&pair.length===2&&typeof pair[0]==='string'&&/^[a-zA-Z0-9._-]{1,100}$/.test(pair[0])&&typeof pair[1]==='string'&&pair[1].length<=4000))
  }catch{return new Map()}
}
export function writeProbeDrafts(storage:StorageLike,workId:string,answers:Map<string,string>):void {
  if(answers.size>39)throw Error('Слишком много незавершённых проб в этой работе.')
  const raw=JSON.stringify({version:1,answers:[...answers]})
  if(raw.length>MAX_RECORD)throw Error('Ответ на пробу пока остался только на открытой странице.')
  storage.setItem(`exam.probes.${workId}`,raw)
}
