type Context = {
  messages?: { role: string; requestId?: string }[];
  preparation?: { id?: string; revision?: number; completed?: boolean };
  numericPreparation?: { id?: string; revision?: number; open?: boolean; completed?: boolean };
}

/** One public context identity shared by the browser and the tutor route. */
export function assistanceContextKey(work: Context): string {
  const user = work.messages?.slice().reverse().find(message => message.role === 'user')
  const prep = work.preparation, numeric = work.numericPreparation
  return JSON.stringify([user?.requestId ?? null, prep?.id ?? null, prep?.revision ?? 0, prep?.completed ?? null,
    numeric?.id ?? null, numeric?.revision ?? 0, numeric?.open ?? null, numeric?.completed ?? null])
}
