import { CodexTutor } from './codex-adapter.mjs'
import { OpenAITutor } from './openai-adapter.mjs'

export function createTutor(config, { db, fetchImpl } = {}) {
  if (config.provider === 'codex') return new CodexTutor()
  if (!['openai','cliproxy'].includes(config.provider)) throw Error('Unsupported tutor provider')
  return new OpenAITutor({ apiKey: config.apiKey, model: config.model, timeoutMs: config.timeoutMs,
    maxInputChars: config.maxInputChars, maxOutputTokens: config.maxOutputTokens,
    requestsPerDay: config.modelRequestsPerDay, db, ...(fetchImpl ? { fetchImpl } : {}),
    ...(config.provider === 'cliproxy' ? {proxyBaseUrl:config.proxyBaseUrl} : {}) })
}
