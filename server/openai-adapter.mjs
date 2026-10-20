const endpoint = 'https://api.openai.com/v1/responses'
const failure = (message, code, status = 502) => Object.assign(Error(message), { code, status })

/** Text-only official API transport. No SDK retries, tools, conversations or credentials in the browser. */
export class OpenAITutor {
  constructor({ apiKey, model, timeoutMs = 90000, maxInputChars = 60000, maxOutputTokens = 3000, requestsPerDay = 60, db, fetchImpl = fetch, now = () => new Date(), proxyBaseUrl }) {
    if (!apiKey || !model) throw Error('OpenAI server configuration is missing')
    Object.assign(this, { apiKey, model, timeoutMs, maxInputChars, maxOutputTokens, requestsPerDay, db, fetchImpl, now })
    this.endpoint = endpoint
    this.provider = 'OpenAI API'
    if (proxyBaseUrl) {
      const url = new URL(proxyBaseUrl)
      if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/v1') throw Error('Proxy must be the private loopback /v1 endpoint')
      this.endpoint = `${url.origin}/v1/responses`
      this.provider = 'Codex · CLIProxyAPI'
    }
    if (!db) throw Error('OpenAI provider requires a persistent request budget database')
    db.exec('CREATE TABLE IF NOT EXISTS model_request_budget (day TEXT PRIMARY KEY, count INTEGER NOT NULL)')
    this.active = null; this.closed = false; this.lastError = ''
  }
  async status() {
    // Configuration is not evidence of remote access. A successful call verifies access for this process.
    return { connected: this.verified === true && !this.closed, provider: this.provider, model: this.model,
      ...(!this.verified ? { error: this.lastError || 'API настроен; доступ ещё не подтверждён запросом.' } : {}) }
  }
  _reserve() {
    const day = this.now().toISOString().slice(0, 10)
    // Reserve before network I/O; failures/cancellation also consume the budget. Survives restart.
    const row = this.db.prepare(`INSERT INTO model_request_budget(day,count) VALUES(?,1)
      ON CONFLICT(day) DO UPDATE SET count=count+1 WHERE count<? RETURNING count`).get(day, this.requestsPerDay)
    if (!row) throw failure('Дневной лимит запросов демонстрации исчерпан.', 'OPENAI_LIMIT', 429)
  }
  async respond({ prompt, system, signal, onDelta } = {}) {
    if (this.closed || signal?.aborted) throw failure('Запрос отменён.', 'OPENAI_CANCELLED', 499)
    if (typeof prompt !== 'string' || !prompt.trim() || typeof system !== 'string' || !system.trim()) throw failure('Не переданы материалы наставнику.', 'OPENAI_INPUT', 400)
    if (prompt.length + system.length > this.maxInputChars) throw failure('Контекст слишком большой для демонстрации. Сократи вопрос или запись.', 'OPENAI_INPUT_LIMIT', 413)
    if (this.active) throw failure('Наставник уже отвечает. Дождись завершения.', 'OPENAI_BUSY', 429)
    this._reserve()
    const controller = new AbortController(); this.active = controller
    let timedOut = false
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, this.timeoutMs)
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, instructions: system, input: prompt, tools: [], tool_choice: 'none',
          store: false, stream: false, max_output_tokens: this.maxOutputTokens,
          ...(this.provider === 'Codex · CLIProxyAPI' ? {reasoning:{effort:'low'}} : {}) }),
      })
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw failure('Серверный доступ к OpenAI API не подтверждён. Сообщи владельцу демонстрации.', 'OPENAI_AUTH', 503)
        if (response.status === 429) throw failure('Лимит OpenAI API достигнут. Запрос не повторялся.', 'OPENAI_LIMIT', 429)
        throw failure('OpenAI API не выполнил запрос. Автоматического повтора не было.', 'OPENAI_REQUEST_FAILED')
      }
      // Bound the response before JSON parsing, including unexpected upstream content.
      const chunks = []; let bytes = 0
      for await (const chunk of response.body) {
        bytes += chunk.byteLength
        if (bytes > 1000000) { controller.abort(); throw failure('Ответ API слишком большой.', 'OPENAI_RESPONSE_LIMIT') }
        chunks.push(Buffer.from(chunk))
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (data.status !== 'completed') throw failure('API вернул незавершённый ответ. Автоматического повтора не было.', 'OPENAI_INCOMPLETE')
      const items = Array.isArray(data.output) ? data.output : []
      if (items.some(item => !['message', 'reasoning'].includes(item.type))) throw failure('API вернул неподдерживаемое действие.', 'OPENAI_TOOL_BLOCKED')
      const text = items.filter(item => item.type === 'message' && item.role === 'assistant').flatMap(item => item.content ?? []).map(part => part.type === 'output_text' ? part.text : part.type === 'refusal' ? part.refusal : '').filter(value => typeof value === 'string').join('\n').trim()
      if (!text) throw failure('API завершил запрос без текста.', 'OPENAI_EMPTY')
      if (controller.signal.aborted) throw failure('Запрос отменён.', 'OPENAI_CANCELLED', 499)
      this.verified = true; this.lastError = ''
      onDelta?.(text)
      return { text, model: typeof data.model === 'string' ? data.model : this.model, runId: data.id }
    } catch (error) {
      this.verified = false
      const safe = timedOut ? failure('Время ожидания API истекло. Запрос не повторялся.', 'OPENAI_TIMEOUT', 504)
        : error.code?.startsWith('OPENAI_') ? error
          : controller.signal.aborted ? failure('Запрос отменён. Автоматического повтора не было.', 'OPENAI_CANCELLED', 499)
            : failure('Связь с OpenAI API прервана. Автоматического повтора не было.', 'OPENAI_REQUEST_FAILED')
      this.lastError = safe.message
      throw safe
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort)
      if (this.active === controller) this.active = null
    }
  }
  async close() { this.closed = true; this.active?.abort() }
}
