import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { normalizeConfig } from '../logic.js'
import { readSettings, settingsFile, validateSettings } from '../settings.js'
import { startSettingsUi } from '../settings-ui.js'

test('settings validation rejects unknown or out-of-range values', () => {
  assert.throws(() => validateSettings({ maxPerDay: 25 }, { partial: true }), /maxPerDay/)
  assert.throws(() => validateSettings({ timeZone: 'not-a-zone' }, { partial: true }), /时区/)
  assert.throws(() => validateSettings({ unknown: 1 }, { partial: true }), /未知设置/)
  assert.equal(normalizeConfig().autoCollectMemes, false)
  assert.equal(normalizeConfig().reassessMinutes, 240)
  assert.throws(() => validateSettings({ reassessMinutes: 10 }, { partial: true }), /reassessMinutes/)
  assert.equal(validateSettings({ autoCollectMemes: true }, { partial: true }).autoCollectMemes, true)
  assert.throws(() => validateSettings({ autoCollectMemes: 'yes' }, { partial: true }), /autoCollectMemes/)
})

test('local UI saves validated settings and rejects unauthorized writes', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-companion-ui-'))
  const { server, url, token } = await startSettingsUi({ home })
  const base = new URL(url).origin
  try {
    const noToken = await fetch(base + '/')
    assert.equal(noToken.status, 403)
    const page = await fetch(url)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /陪伴插件设置/)

    const headers = { 'X-Companion-Token': token, 'Content-Type': 'application/json' }
    const initial = await (await fetch(base + '/api/settings', { headers })).json()
    assert.equal(initial.settings.checkMinutes, 5)
    const settings = { ...normalizeConfig(), minIdleMinutes: 45, maxPerDay: 3, memeMode: 'often' }
    const saved = await fetch(base + '/api/settings', { method: 'PUT', headers, body: JSON.stringify(settings) })
    assert.equal(saved.status, 200)
    assert.equal(readSettings(settingsFile(home)).minIdleMinutes, 45)
    assert.equal(JSON.parse(readFileSync(settingsFile(home), 'utf8')).maxPerDay, 3)
    const bad = await fetch(base + '/api/settings', { method: 'PUT', headers, body: JSON.stringify({ ...settings, maxPerDay: 99 }) })
    assert.equal(bad.status, 400)
    assert.equal(readSettings(settingsFile(home)).maxPerDay, 3)
    const denied = await fetch(base + '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) })
    assert.equal(denied.status, 403)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(home, { recursive: true, force: true })
  }
})
