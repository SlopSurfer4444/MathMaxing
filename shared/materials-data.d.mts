export type Material = {
  id: string; version: number; title: string; tag: string; statement: string; formula: string;
  explanation: string; proof: { text: string; formula?: string }[]; caution: string;
  sections?: { title: string; text: string; formula?: string }[];
  diagram?: 'triangle' | 'circle';
}

export const materials: Material[]
export const materialRelations: Record<string, { prerequisites: string[]; related: string[] }>
