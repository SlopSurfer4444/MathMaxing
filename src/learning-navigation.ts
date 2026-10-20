export type LearningDestination = {view: 'home' | 'episode' | 'work' | 'diagnostic' | 'materials'; episodeId: string | null}
export type LearningNavigation = {resume: LearningDestination; materialReturn: LearningDestination; episodeReturn: LearningDestination | 'course'; episodeTrail?: (LearningDestination | 'course')[]}
export const defaultLearningNavigation = (): LearningNavigation => ({resume:{view:'work',episodeId:null},materialReturn:{view:'home',episodeId:null},episodeReturn:{view:'home',episodeId:null}})
export function readLearningNavigation(raw: string | null): LearningNavigation {
  if (!raw) return defaultLearningNavigation()
  const data = JSON.parse(raw) as LearningNavigation
  const valid = (target: LearningDestination) => target && ['home','episode','work','diagnostic','materials'].includes(target.view) && (target.episodeId === null || /^(K[1-7]|M[1-3])$/.test(target.episodeId)) && (target.view !== 'episode' || target.episodeId !== null)
  if (data.episodeTrail && (!Array.isArray(data.episodeTrail) || data.episodeTrail.some(target => target !== 'course' && !valid(target)))) throw new Error('Некорректная цепочка возврата')
  if (!valid(data.resume) || !valid(data.materialReturn) || (data.episodeReturn !== 'course' && !valid(data.episodeReturn))) throw new Error('Некорректная сохранённая точка возврата')
  return data
}
export function addressedEpisodeNavigation(nav: LearningNavigation, from: LearningDestination): LearningNavigation {
  const target = from.view === 'materials' ? nav.materialReturn : from
  return {...nav, episodeReturn: target, episodeTrail: target.view === 'episode' ? [...(nav.episodeTrail ?? []), nav.episodeReturn] : []}
}
export function episodeCompletion(nav: LearningNavigation, episodeId: string): LearningDestination {
  if (nav.episodeReturn !== 'course') return nav.episodeReturn
  const sequence = ['K1','K2','K3','K4','K5','K6','K7','M1']
  const index = sequence.indexOf(episodeId)
  return index >= 0 && index < sequence.length - 1 ? {view:'episode',episodeId:sequence[index+1]} : {view:'work',episodeId:null}
}
