const denied = (message, status) => Object.assign(Error(message), { status })
export function createRequestGuard(config, { now = Date.now } = {}) {
  const origins = new Set(config.origins)
  let active = 0, windowStart = now(), requests = 0
  return (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    // X-Pole-Client is a CSRF marker, never an access credential.
    const origin = req.headers.origin
    if (req.headers['x-pole-client'] !== 'notebook-v1' || (origin && !origins.has(origin)) || req.method === 'OPTIONS') throw denied('Запрос вне приложения отклонён.', 403)
    if (req.headers['sec-fetch-site'] === 'cross-site') throw denied('Межсайтовый запрос запрещён.', 403)
    if (now() - windowStart >= 60000) { windowStart = now(); requests = 0 }
    if (++requests > config.requestsPerMinute) {
      res.setHeader('Retry-After', '60')
      throw denied('Слишком много запросов. Подождите минуту.', 429)
    }
    if (active >= config.maxHttpConcurrent) throw denied('Сервер занят. Дождитесь завершения запроса.', 429)
    active++
    let released = false
    const release = () => { if (!released) { active--; released = true } }
    res.once('finish', release); res.once('close', release)
  }
}
