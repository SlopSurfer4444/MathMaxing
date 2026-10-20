type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
let currentId: string | null = null

export function sessionStorageKey(id: string, key: string): string {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('Некорректная сессия')
  // The local owner's existing notebook retains its original storage keys.
  return id === 'local' ? key : `pole.visitor.${id}.${key}`
}
export function scopedStorage(storage: StorageLike, id: string): StorageLike {
  return {
    getItem: key => storage.getItem(sessionStorageKey(id,key)),
    setItem: (key,value) => storage.setItem(sessionStorageKey(id,key),value),
    removeItem: key => storage.removeItem(sessionStorageKey(id,key)),
  }
}
export async function initializeVisitor(): Promise<void> {
  const response = await fetch('/api/session', {
    headers:{'X-Pole-Client':'notebook-v1'}, credentials:'same-origin',
    cache:'no-store', signal:AbortSignal.timeout(12000),
  })
  const data = await response.json()
  if (!response.ok || typeof data.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(data.id)) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Не удалось открыть твою сессию.')
  }
  currentId = data.id
}
export function visitorHeaders(): Record<string,string> {
  if (!currentId) throw new Error('Сессия ещё не открыта. Обнови страницу.')
  return {'X-Pole-Session':currentId}
}
function storage(): StorageLike {
  if (!currentId) throw new Error('Сессия ещё не открыта')
  return scopedStorage(window.localStorage,currentId)
}
export const learnerStorage: StorageLike = {
  getItem: key => storage().getItem(key),
  setItem: (key,value) => storage().setItem(key,value),
  removeItem: key => storage().removeItem(key),
}
