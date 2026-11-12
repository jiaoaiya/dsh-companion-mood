import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { apply } from '../index.js'

async function call(handler, method, url, body) {
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : [])
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:3000', ...(method === 'POST' ? { origin: 'http://127.0.0.1:3000' } : {}) }
  const result = {}
  const res = { writeHead(status) { result.status = status }, end(text) { result.body = JSON.parse(text) } }
  await handler(req, res)
  return result
}

test('DSH host exposes editable settings to its client section', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-companion-host-ui-'))
  const oldHome = process.env.DSH_HOME
  const oldInterval = globalThis.setInterval
  const oldClear = globalThis.clearInterval
  let route
  process.env.DSH_HOME = root
  globalThis.setInterval = () => 1
  globalThis.clearInterval = () => {}
  try {
    apply({
      webServer: { register: value => { route = value } },
      tools: { register() {}, get() {} }, systemPrompt: { context() {} },
      on() {}, effect: fn => fn(),
    })
    assert.equal(route.path, '/companion-mood-api')
    const loaded = await call(route.handler, 'GET', '/companion-mood-api?op=settings')
    assert.equal(loaded.status, 200)
    assert.equal(loaded.body.settings.assessmentIdleMinutes, 3)
    const updated = await call(route.handler, 'POST', '/companion-mood-api', {
      op: 'settings', settings: { ...loaded.body.settings, assessmentIdleMinutes: 7 },
    })
    assert.equal(updated.status, 200)
    assert.equal(updated.body.settings.assessmentIdleMinutes, 7)
    const again = await call(route.handler, 'GET', '/companion-mood-api?op=settings')
    assert.equal(again.body.settings.assessmentIdleMinutes, 7)
  } finally {
    globalThis.setInterval = oldInterval
    globalThis.clearInterval = oldClear
    if (oldHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldHome
    rmSync(root, { recursive: true, force: true })
  }
})
