import { resolve } from 'node:path'

function number(env, key, fallback, min, max) {
  const value = env[key] === undefined ? fallback : Number(env[key])
  if (!Number.isSafeInteger(value) || value < min || value > max) throw Error(`Invalid ${key}`)
  return value
}

export function loadServerConfig(env = process.env) {
  const hosted = env.POLE_MODE === 'hosted'
  if (env.POLE_MODE && !['local', 'hosted'].includes(env.POLE_MODE)) throw Error('Invalid POLE_MODE')
  const provider = env.POLE_TUTOR_PROVIDER || 'codex'
  if (!['codex', 'openai', 'cliproxy'].includes(provider)) throw Error('Invalid POLE_TUTOR_PROVIDER')
  if (hosted && provider === 'codex') throw Error('Hosted mode requires POLE_TUTOR_PROVIDER=openai or cliproxy')
  const origins = (env.POLE_ALLOWED_ORIGINS || (hosted ? '' : 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4317,http://localhost:4317')).split(',').filter(Boolean)
  if (!origins.length) throw Error('POLE_ALLOWED_ORIGINS is required')
  for (const origin of origins) {
    let url
    try { url = new URL(origin) } catch { throw Error('Invalid POLE_ALLOWED_ORIGINS') }
    if (url.origin !== origin || url.username || url.password || (hosted ? url.protocol !== 'https:' : !['http:', 'https:'].includes(url.protocol))) throw Error('Origins must be exact origins; hosted origins must use HTTPS')
  }
  if (hosted && !env.POLE_DB_PATH) throw Error('Hosted mode requires an isolated POLE_DB_PATH')
  const apiKey = (provider === 'cliproxy' ? env.CLIPROXY_API_KEY : env.OPENAI_API_KEY) || ''
  const model = env.OPENAI_MODEL || ''
  if (provider !== 'codex' && (!apiKey.trim() || !model.trim())) throw Error(`${provider} provider requires a server API key and OPENAI_MODEL`)
  const proxyBaseUrl = env.CLIPROXY_BASE_URL || 'http://127.0.0.1:8317/v1'
  if (provider === 'cliproxy') {
    let proxy
    try { proxy = new URL(proxyBaseUrl) } catch { throw Error('Invalid CLIPROXY_BASE_URL') }
    if (proxy.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(proxy.hostname) || proxy.username || proxy.password || proxy.search || proxy.hash || proxy.pathname !== '/v1') throw Error('CLIPROXY_BASE_URL must be a loopback HTTP /v1 endpoint')
  }
  return {
    hosted, provider, origins,
    host: '127.0.0.1', port: number(env, 'POLE_PORT', 4317, 1024, 65535),
    dbPath: resolve(env.POLE_DB_PATH || '.runtime/pole.sqlite'), apiKey, model, proxyBaseUrl,
    maxBodyBytes: number(env, 'POLE_MAX_BODY_BYTES', 300000, 1024, 1000000),
    maxHttpConcurrent: number(env, 'POLE_HTTP_CONCURRENT', 12, 1, 30),
    requestsPerMinute: number(env, 'POLE_REQUESTS_PER_MINUTE', 240, 1, 1000),
    maxVisitors: number(env, 'POLE_MAX_VISITORS', 50, 1, 100),
    modelRequestsPerDay: number(env, 'POLE_MODEL_REQUESTS_PER_DAY', 60, 1, 500),
    maxInputChars: number(env, 'POLE_MODEL_INPUT_CHARS', 60000, 1000, 200000),
    maxOutputTokens: number(env, 'POLE_MODEL_OUTPUT_TOKENS', 3000, 128, 8000),
    timeoutMs: number(env, 'POLE_MODEL_TIMEOUT_MS', 90000, 1000, 120000),
  }
}
