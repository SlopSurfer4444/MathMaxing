export type StudyPackageId = 'percentages' | 'trigonometry' | 'graphs' | 'inequalities'
export type StudyRouteAction = { type: 'open'; workId: string } | { type: 'new'; packageId: StudyPackageId; mode: 'solo' | 'guided'; taskId?: string }
export type StudyRouteCard = { id: string; packageId: StudyPackageId; title: string; reason: string; action: StudyRouteAction }
export type StudyRouteState = { version: 1; revision: number; preferredPackage: StudyPackageId; goal: string; current: StudyRouteCard; next: StudyRouteCard[]; generatedAt: string; basisSignature: string; paused: boolean }
