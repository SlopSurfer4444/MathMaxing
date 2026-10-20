import type { ProviderStatus } from './api-types'

// Only a successful provider check/response means connected. Configuration alone
// lets the learner ask a first question without claiming verified remote access.
export function providerState(provider: ProviderStatus | null) {
  if (provider?.error) return 'unavailable'
  if (provider?.connected) return 'connected'
  if (provider?.configured) return 'ready'
  if (!provider || provider.loading) return 'loading'
  return 'unavailable'
}

export function providerPresentation(provider: ProviderStatus | null) {
  const state = providerState(provider)
  return {
    state,
    label: state === 'connected' ? 'Наставник на связи' : state === 'ready' ? 'Готов к вопросу' : state === 'loading' ? 'Уточняем статус…' : 'Нет подключения',
    warning: state === 'unavailable' ? `${provider?.error || 'Наставник пока недоступен.'} Можно продолжать решать и пользоваться материалами. Чтобы обновить статус, нажми ↻.` : null,
  }
}
