import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { Script } from 'node:vm'
import { createCatalogLoader, normalizeCatalog } from '../discover.js'
import { startSettingsUi } from '../settings-ui.js'

const item = {
  id: 'cute-fish', name: '可爱鱼', version: '1.0.0', description: '开心和安慰',
  maintainer: 'meme-maker', count: 42, downloads: 79,
  archiveUrl: 'https://example.com/cute-fish.zip', sha256: 'a'.repeat(64),
  preview: 'https://example.com/cover.png', previews: ['https://example.com/1.png'],
  keywords: ['开心', '鲸鱼'],
}

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
}
function close(server) {
  return new Promise(resolve => server.close(resolve))
}

test('catalog normalization filters unsafe links and duplicate IDs', () => {
  const catalog = normalizeCatalog({ packs: [item, { ...item }, { id: '../bad', name: '坏' }, { ...item, id: 'safe', preview: 'javascript:alert(1)', archiveUrl: 'http://example.com/file.zip' }] })
  assert.equal(catalog.packs.length, 2)
  assert.equal(catalog.packs[1].preview, '')
  assert.equal(catalog.packs[1].archiveUrl, '')
  assert.equal(catalog.packs[0].downloads, 79)
})

test('catalog loader falls back to mirror and caches results', async () => {
  const urls = ['https://example.com/raw', 'https://example.com/mirror']
  const calls = []
  const loader = createCatalogLoader({ urls, fetchImpl: async url => {
    calls.push(url)
    if (url === urls[0]) throw new Error('offline')
    return new Response(JSON.stringify({ packs: [item] }), { headers: { 'content-type': 'application/json' } })
  } })
  assert.equal((await loader()).packs[0].name, '可爱鱼')
  assert.equal((await loader()).packs.length, 1)
  assert.deepEqual(calls, urls)
})

test('Discover uses dsh-meme directory and delegates verified installation', async () => {
  const operations = []
  const memeServer = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'GET' && req.url.includes('remoteDir=')) return res.end(JSON.stringify({ ok: true, remoteDir: [item] }))
    if (req.method === 'GET') return res.end(JSON.stringify({ ok: true, packs: [{ id: 'already-installed' }] }))
    let body = ''
    for await (const chunk of req) body += chunk
    const operation = JSON.parse(body)
    operations.push(operation)
    if (operation.op === 'installRemoteArchive') return res.end(JSON.stringify({ ok: true, id: 'ra-test', state: 'running', message: '开始下载' }))
    if (operation.op === 'remoteJobStatus') return res.end(JSON.stringify({ ok: true, state: 'done', message: '安装完成' }))
    res.end(JSON.stringify({ ok: false, error: 'unexpected operation' }))
  })
  await listen(memeServer)
  const { server, url, token } = await startSettingsUi()
  const base = new URL(url).origin
  const port = memeServer.address().port
  const headers = { 'X-Companion-Token': token, 'Content-Type': 'application/json' }
  try {
    const unauthorized = await fetch(base + '/api/discover?port=' + port)
    assert.equal(unauthorized.status, 403)
    const catalog = await (await fetch(base + '/api/discover?port=' + port, { headers })).json()
    assert.equal(catalog.connected, true)
    assert.equal(catalog.port, port)
    assert.equal(catalog.packs[0].name, '可爱鱼')
    assert.deepEqual(catalog.installedIds, ['already-installed'])
    const invalid = await fetch(base + '/api/discover/install?port=' + port, { method: 'POST', headers, body: JSON.stringify({ id: 'not-listed' }) })
    assert.equal(invalid.status, 400)
    const started = await (await fetch(base + '/api/discover/install?port=' + port, { method: 'POST', headers, body: JSON.stringify({ id: 'cute-fish' }) })).json()
    assert.equal(started.jobId, 'ra-test')
    assert.deepEqual(operations[0], { op: 'installRemoteArchive', archiveUrl: item.archiveUrl, sha256: item.sha256, packId: item.id, name: item.name, version: item.version })
    const status = await (await fetch(base + '/api/discover/job/ra-test', { headers })).json()
    assert.equal(status.state, 'done')
    assert.equal(operations[1].op, 'remoteJobStatus')
  } finally { await close(server); await close(memeServer) }
})

test('Discover remains browsable when dsh-meme is offline', async () => {
  const fetchImpl = async url => {
    if (String(url).startsWith('http://127.0.0.1:')) throw new Error('DSH offline')
    return new Response(JSON.stringify({ packs: [item] }))
  }
  const { server, url, token } = await startSettingsUi({ fetchImpl })
  try {
    const base = new URL(url).origin
    const headers = { 'X-Companion-Token': token, 'Content-Type': 'application/json' }
    const response = await fetch(base + '/api/discover', { headers })
    assert.equal(response.status, 200, await response.clone().text())
    const body = await response.json()
    assert.equal(body.connected, false)
    assert.equal(body.packs[0].id, item.id)
    const install = await fetch(base + '/api/discover/install', { method: 'POST', headers, body: JSON.stringify({ id: item.id }) })
    assert.equal(install.status, 400)
  } finally { await close(server) }
})

test('Discover page client script parses', () => {
  const html = readFileSync(new URL('../settings-ui.html', import.meta.url), 'utf8')
  const script = html.match(/<script nonce="__NONCE__">([\s\S]*?)<\/script>/)?.[1]
  assert.ok(script)
  new Script(script)
})
