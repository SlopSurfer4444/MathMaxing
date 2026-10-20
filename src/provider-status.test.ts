import test from 'node:test'
import assert from 'node:assert/strict'
import { providerPresentation, providerState } from './provider-status.ts'

test('configured tutor invites the first question without claiming a verified connection', () => {
  const provider = { connected: false, configured: true, provider: 'OpenAI API' }
  assert.equal(providerState(provider), 'ready')
  assert.deepEqual(providerPresentation(provider), { state: 'ready', label: 'Готов к вопросу', warning: null })
  // A loading status during boot must not flash an unavailable warning either.
  assert.equal(providerPresentation(null).warning, null)
  assert.equal(providerState({ connected: false, provider: 'Наставник', loading: true }), 'loading')
})

test('actual failures override configured readiness and remain visible', () => {
  const error = 'Серверный доступ к OpenAI API не подтверждён.'
  const presentation = providerPresentation({ connected: false, configured: true, provider: 'OpenAI API', error })
  assert.equal(presentation.state, 'unavailable')
  assert.equal(presentation.label, 'Нет подключения')
  assert.ok(presentation.warning?.includes(error))
  assert.equal(providerState({ connected: true, configured: true, provider: 'test', error }), 'unavailable')
})

test('local provider retains its checked connection and unavailable states', () => {
  assert.deepEqual(providerPresentation({ connected: true, provider: 'Codex' }), { state: 'connected', label: 'Наставник на связи', warning: null })
  assert.equal(providerState({ connected: false, provider: 'Codex' }), 'unavailable')
  assert.equal(providerState({ connected: false, provider: 'Codex', error: 'Codex недоступен' }), 'unavailable')
})
