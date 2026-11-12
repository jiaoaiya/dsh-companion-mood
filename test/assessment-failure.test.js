import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'

test('failed mood assessment remains scheduled and exposes its cause', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-companion-failure-'))
  const previousHome = process.env.DSH_HOME
  const previousInterval = globalThis.setInterval
  const previousClear = globalThis.clearInterval
  const file = join(root, 'storages', 'companion-mood', 'state.json')
  const humanAt = Date.now() - 40 * 60000
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ lastHumanAt: humanAt, targetSessionId: 'test-session', assessmentDueAt: Date.now() - 1 }))
  const events = new Map([
    [1, { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] } }],
    [2, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '你好呀' }] } } }],
  ])
  const agent = { id: 'test-session', status: 'idle', session: {
    id: 'test-session', surface: { nodes: [1, 2] }, eventAt: seq => events.get(seq),
    requestHeader: () => ({ config: { provider: 'test', model: 'test-model' } }),
  } }
  let tick
  let fail = true
  const context = {
    agents: { get: () => agent }, systemPrompt: { context: () => {} },
    tools: { register: () => {}, get: () => undefined },
    get: name => name === 'llm' ? { stream: async function* () {
      if (fail) throw new Error('model unavailable')
      yield { type: 'text-delta', text: '{"emotion":"安静","intensity":0.5,"decision":"skip"}' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } } : undefined,
    on: () => {}, effect: callback => { callback() },
  }
  process.env.DSH_HOME = root
  globalThis.setInterval = callback => { tick = callback; return 1 }
  globalThis.clearInterval = () => {}
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const due = Date.now() - 1
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      saved.assessmentDueAt = due
      writeFileSync(file, JSON.stringify(saved))
      // The plugin keeps an in-memory state; exercise each retry with a fresh instance.
      apply(context, { checkMinutes: 1, reassessMinutes: 30 })
      tick()
      for (let n = 0; n < 20; n++) {
        if (JSON.parse(readFileSync(file, 'utf8')).assessmentAttempts === attempt) break
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      const result = JSON.parse(readFileSync(file, 'utf8'))
      assert.equal(result.assessmentAttempts, attempt)
      assert.equal(result.lastAssessmentError, 'model unavailable')
      assert.ok(result.assessmentDueAt > Date.now())
      if (attempt === 3) assert.ok(result.assessmentDueAt - Date.now() > 29 * 60000)
      assert.equal(result.lastPlannedHumanAt, 0)
    }
    fail = false
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    saved.assessmentDueAt = Date.now() - 1
    writeFileSync(file, JSON.stringify(saved))
    apply(context, { checkMinutes: 1, reassessMinutes: 30 })
    tick()
    for (let n = 0; n < 20; n++) {
      if (JSON.parse(readFileSync(file, 'utf8')).lastDecision === 'skip') break
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    const recovered = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(recovered.lastDecision, 'skip')
    assert.equal(recovered.assessmentAttempts, 0)
    assert.equal(recovered.lastAssessmentError, '')
    assert.equal(recovered.lastAssessmentErrorAt, 0)
  } finally {
    globalThis.setInterval = previousInterval
    globalThis.clearInterval = previousClear
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(root, { recursive: true, force: true })
  }
})
