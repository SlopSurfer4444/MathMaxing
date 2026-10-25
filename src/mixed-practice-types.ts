export type MixedPracticeItem = {
  index: number
  workId?: string
  repeated?: boolean
  status: 'unattempted' | 'correct' | 'incorrect' | 'unknown'
  assistance: 'none' | 'used' | 'unknown'
  submissionId?: string
}
export type MixedPracticeState = {
  id: string
  revision: number
  status: 'active' | 'complete'
  position: number
  total: number
  currentWorkId: string | null
  items: MixedPracticeItem[]
  scope: string
}
