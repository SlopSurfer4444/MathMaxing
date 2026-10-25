type PackageId = 'percentages' | 'trigonometry' | 'graphs' | 'inequalities'
type Metadata = { packageId?: string; kind?: 'trig' | 'numeric' | 'interval' }
const packages: readonly string[] = ['percentages', 'trigonometry', 'graphs', 'inequalities']
const explicitPackage = (value?: string): PackageId | undefined => packages.includes(value ?? '') ? value as PackageId : undefined

/** Frozen work metadata owns generated instances absent from the public catalogue. */
export function workPackage(work: Metadata & { problemId: string }, problems: readonly (Metadata & {id:string})[]): PackageId | null {
  const own = explicitPackage(work.packageId)
  if (own) return own
  const problem = problems.find(item => item.id === work.problemId)
  const catalog = explicitPackage(problem?.packageId)
  if (catalog) return catalog
  const kind = work.kind ?? problem?.kind
  if (kind === 'trig') return 'trigonometry'
  if (kind === 'interval') return 'inequalities'
  // Legacy numeric works belong to percentages; newer scalar packages persist packageId.
  if (kind === 'numeric') return 'percentages'
  // Legacy catalogue entries predate kind/packageId and are trig. Missing
  // metadata alone is not evidence that an unknown generated task is trig.
  return problem ? 'trigonometry' : null
}
