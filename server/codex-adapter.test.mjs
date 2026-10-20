import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodexTutor, resolveCodexLaunch } from './codex-adapter.mjs'

const windows = (files, options = {}) => ({ platform: 'win32', env: { Path: 'C:\\First;"C:\\Program Files\\Codex"' }, cwd: 'C:\\Project', nodePath: 'C:\\Node\\node.exe', isFile: path => files.includes(path), ...options })

test('Codex uses PATH on Windows and preserves directory precedence', () => {
  const first = 'C:\\First\\codex.exe', second = 'C:\\Program Files\\Codex\\codex.exe'
  assert.deepEqual(resolveCodexLaunch('codex', windows([first, second])), { executable: first, args: [] })
  assert.deepEqual(resolveCodexLaunch('codex', windows([second])), { executable: second, args: [] })
})

test('an explicit Codex path is literal and cannot fall back to another installation', () => {
  const executable = 'C:\\Tools & More\\codex.exe'
  assert.deepEqual(resolveCodexLaunch(executable, windows([executable])), { executable, args: [] })
  assert.throws(() => resolveCodexLaunch('C:\\Missing\\codex.exe', windows(['C:\\First\\codex.exe'])), { code: 'CODEX_UNAVAILABLE' })
  assert.deepEqual(resolveCodexLaunch('.\\tools\\codex.exe', windows(['C:\\Project\\tools\\codex.exe'])), { executable: 'C:\\Project\\tools\\codex.exe', args: [] })
})

test('standard npm Windows shims use Node with a literal JS path, without a shell', () => {
  const directory = 'C:\\Tools & More\\100% Codex', entry = `${directory}\\node_modules\\@openai\\codex\\bin\\codex.js`
  for (const extension of ['cmd', 'bat']) {
    const shim = `${directory}\\codex.${extension}`
    assert.deepEqual(resolveCodexLaunch(shim, windows([shim, entry])), { executable: 'C:\\Node\\node.exe', args: [entry] })
  }
  const shim = 'C:\\First\\codex.cmd', firstEntry = 'C:\\First\\node_modules\\@openai\\codex\\bin\\codex.js'
  assert.deepEqual(resolveCodexLaunch('codex', windows([shim, firstEntry, 'C:\\Program Files\\Codex\\codex.exe'])), { executable: 'C:\\Node\\node.exe', args: [firstEntry] })
  assert.throws(() => resolveCodexLaunch(shim, windows([shim])), { code: 'CODEX_UNAVAILABLE' })
  assert.throws(() => resolveCodexLaunch('C:\\First\\custom.cmd', windows(['C:\\First\\custom.cmd', firstEntry])), { code: 'CODEX_UNAVAILABLE' })
})

test('POSIX uses PATH, and explicit JS paths run with the current Node', () => {
  const options = { platform: 'linux', env: { PATH: '/usr/local/bin:/usr/bin' }, cwd: '/project', nodePath: '/usr/bin/node', isFile: path => ['/usr/bin/codex', '/project/tools/codex.mjs'].includes(path) }
  assert.deepEqual(resolveCodexLaunch('codex', options), { executable: '/usr/bin/codex', args: [] })
  assert.deepEqual(resolveCodexLaunch('./tools/codex.mjs', options), { executable: '/usr/bin/node', args: ['/project/tools/codex.mjs'] })
  assert.throws(() => resolveCodexLaunch('missing', options), { code: 'CODEX_UNAVAILABLE' })
})

test('Codex launches an explicit JS entrypoint from an isolated directory and closes it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pole-launch-test-'))
  const entry = join(directory, 'tools & literal', 'codex.mjs')
  let tutor
  try {
    await mkdir(join(directory, 'tools & literal'))
    await writeFile(entry, `import { createInterface } from 'node:readline'
const locked = { web_search: 'disabled', project_doc_max_bytes: 0, notify: [] }
if (process.argv[2] !== 'app-server' || process.argv[3] !== '--stdio') process.exit(2)
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line)
  if (!('id' in request)) return
  const result = request.method === 'account/read' ? { account: { type: 'chatgpt' } }
    : request.method === 'config/read' ? { config: locked }
    : request.method === 'model/list' ? { data: [{ model: 'fixture', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }] }
    : {}
  process.stdout.write(JSON.stringify({ id: request.id, result }) + '\\n')
})
`)
    tutor = new CodexTutor({ executable: entry, requestTimeoutMs: 3000 })
    assert.deepEqual(await tutor.status(), { connected: true, provider: 'Codex', model: 'fixture' })
    assert.notEqual(tutor.hostDir, directory)
    assert.notEqual(tutor.hostDir, process.cwd())
  } finally {
    await tutor?.close()
    await rm(directory, { recursive: true, force: true })
  }
})
