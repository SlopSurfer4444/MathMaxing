/** Authored version-1 lengths: positive safe integers no greater than 1e9. */
export type ParallelModelFacts = Readonly<{ ad: number; db: number; ae: number; ec: number }>
export type ParallelModelChoice = 'sides-angle' | 'parallel-angles' | 'other'
export type ParallelModelResult = {
  status: 'correct' | 'incorrect' | 'unknown'
  summary: string
  scope: string
  mastery: false
  ratios: { left: number; right: number }
  sides: { ab: number; ac: number }
  parallel: boolean | null
}
/** Checks one selected basis, not a complete proof. Invalid facts throw RangeError. */
export function evaluateParallelModel(facts: ParallelModelFacts, choice: string): ParallelModelResult
