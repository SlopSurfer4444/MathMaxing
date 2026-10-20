import { CodexTutor } from '../server/codex-adapter.mjs'
import assert from 'node:assert/strict'

async function selfTest() {
  function fixture() {
    const tutor = new CodexTutor({ timeoutMs: 50 })
    tutor._connect = async () => {}
    tutor._checkAccount = async () => {}
    tutor.model = 'fixture'
    tutor.effort = 'low'
    tutor.child = { killed: false }
    tutor._stop = async () => { tutor.child = null }
    tutor.calls = []
    tutor._rpc = async (method) => {
      tutor.calls.push(method)
      if (method === 'thread/start') return {
        model: 'fixture', modelProvider: 'openai', reasoningEffort: 'low',
        thread: { id: 'thread', ephemeral: true, environments: [] },
        approvalPolicy: 'never', sandbox: { type: 'readOnly', networkAccess: false },
      }
      if (method === 'turn/start') return { turn: { id: 'turn' } }
      return {}
    }
    return tutor
  }
  const input = { system: 'tutor', prompt: 'synthetic question' }
  const tick = () => new Promise(resolve => setImmediate(resolve))
  const event = (tutor, method, params) => tutor._message(JSON.stringify({ method, params: { threadId: 'thread', ...params } }))
  let tutor = fixture()
  let running = tutor.respond(input)
  await tick()
  event(tutor, 'item/completed', { item: { id: 'answer', type: 'agentMessage', text: 'Три четверти.' } })
  event(tutor, 'turn/completed', { turn: { id: 'turn', status: 'completed' } })
  assert.equal((await running).text, 'Три четверти.')
  assert(tutor.calls.includes('thread/unsubscribe'))

  tutor = fixture()
  running = tutor.respond(input)
  await tick()
  event(tutor, 'turn/completed', { turn: { id: 'turn', status: 'failed', error: { message: 'private text' } } })
  await assert.rejects(running, error => error.code === 'CODEX_REQUEST_FAILED' && !error.message.includes('private'))
  assert(tutor.calls.includes('turn/interrupt'))

  tutor = fixture()
  await assert.rejects(tutor.respond(input), error => error.code === 'CODEX_TIMEOUT')
  tutor = fixture()
  const controller = new AbortController()
  running = tutor.respond({ ...input, signal: controller.signal })
  await tick()
  await assert.rejects(tutor.respond(input), error => error.code === 'CODEX_BUSY')
  controller.abort()
  await assert.rejects(running, error => error.code === 'CODEX_CANCELLED')

  tutor = fixture()
  tutor._send = message => { assert(message.error); assert.equal(message.result, undefined) }
  running = tutor.respond(input)
  await tick()
  tutor._message(JSON.stringify({ id: 77, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread' } }))
  await assert.rejects(running, error => error.code === 'CODEX_TOOL_BLOCKED')

  tutor = fixture()
  const rpc = tutor._rpc
  tutor._rpc = async method => {
    const result = await rpc(method)
    if (method === 'thread/start') result.thread.environments = [{ id: 'unexpected' }]
    return result
  }
  await assert.rejects(tutor.respond(input), error => error.code === 'CODEX_ISOLATION')
  assert(!tutor.calls.includes('turn/start'))
  console.log(JSON.stringify({ check: 'codex-offline-lifecycle', passed: true, cases: ['completion', 'failed-turn-redaction', 'timeout', 'abort', 'busy', 'request-denial', 'isolation-before-turn'] }))
}

if (process.argv.includes('--self-test')) {
  await selfTest()
  process.exit(0)
}

const tutor = new CodexTutor()
try {
  const status = await tutor.status()
  console.log(JSON.stringify({ check: 'codex-connection', ...status }))
  if (!status.connected) process.exitCode = 1
  else if (process.argv.includes('--live')) {
    // Explicit opt-in: consumes a real Codex turn. No student data is used.
    const answer = await tutor.respond({
      system: 'Ты спокойный школьный репетитор. Кратко объясняй смысл и задавай один вопрос ученику. Не решай за него задания.',
      prompt: 'Объясни за два предложения, что означает 3/4, и задай один простой вопрос для проверки понимания.',
    })
    console.log(JSON.stringify({ check: 'codex-live-inference', observed: true, ...answer }))
  }
} catch (error) {
  console.error(JSON.stringify({ check: 'codex-probe', error: error.message, code: error.code }))
  process.exitCode = 1
} finally {
  await tutor.close()
}
