import type { Work } from './api-types'

// Network readbacks can arrive out of order. Never erase a newer message or
// submission just because an older save/poll carried an earlier work snapshot.
export function mergeWork(current: Work | null, incoming: Work): Work {
  if (!current || current.id !== incoming.id) return incoming
  const messages = new Map(current.messages.map(item => [item.id, item]))
  for (const item of incoming.messages) {
    const old = messages.get(item.id)
    const keepSent = old?.status === 'sent' && item.status !== 'sent'
    messages.set(item.id, { ...(keepSent ? old : item), stale: old?.stale || item.stale })
  }
  const submissions = new Map(current.submissions.map(item => [item.id, item]))
  for (const item of incoming.submissions) {
    const old = submissions.get(item.id)
    if (!old || (item.reviewVersion ?? 0) >= (old.reviewVersion ?? 0)) submissions.set(item.id, item)
  }
  const base = incoming.revision < current.revision ? current : incoming
  return { ...base, messages: [...messages.values()], submissions: [...submissions.values()] }
}
