import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeConfig } from './logic.js'
import { createCatalogLoader, normalizeCatalog } from './discover.js'
import { callMemeApi, getMemeDirectory, parseDshPort, probeMemeApi } from './dsh-meme-api.js'
import { effectiveSettings, settingsFile, writeSettings } from './settings.js'

const page = readFileSync(new URL('./settings-ui.html', import.meta.url), 'utf8')

function reply(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

async function jsonBody(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 16384) throw new Error('设置内容过大')
  }
  return JSON.parse(body)
}

export async function startSettingsUi({ home, port = 0, fetchImpl = fetch } = {}) {
  const file = settingsFile(home)
  const loadCatalog = createCatalogLoader({ fetchImpl })
  const jobs = new Map()
  const token = randomBytes(32).toString('hex')
  const nonce = randomBytes(16).toString('base64')
  async function discovery(requestedPort, force = false) {
    const meme = await probeMemeApi({ port: requestedPort, excludePort: server.address().port, fetchImpl })
    let catalog
    let stale = false
    if (meme) {
      try {
        const remote = await getMemeDirectory(meme.port, fetchImpl)
        catalog = normalizeCatalog(remote.rows)
        stale = remote.stale
      } catch { /* 已连接的 dsh-meme 目录暂不可用，改用公开目录。 */ }
    }
    if (!catalog) {
      catalog = await loadCatalog({ force })
      stale = !!catalog.stale
    }
    return { ...catalog, stale, connected: !!meme, port: meme?.port || 0, installedIds: meme?.installedIds || [] }
  }
  const server = createServer(async (req, res) => {
    const host = '127.0.0.1:' + server.address().port
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== 'http://' + host)) {
      reply(res, 403, { error: '请求来源无效' })
      return
    }
    const url = new URL(req.url, 'http://' + host)
    if (req.method === 'GET' && url.pathname === '/' && url.searchParams.get('token') === token) {
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'nonce-" + nonce + "'; img-src https:; connect-src 'self'; base-uri 'none'; form-action 'none'")
      reply(res, 200, page.replaceAll('__NONCE__', nonce), 'text/html; charset=utf-8')
      return
    }
    if (req.headers['x-companion-token'] !== token) {
      reply(res, 403, { error: '访问令牌无效' })
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/settings') {
      try { reply(res, 200, { settings: effectiveSettings(file), defaults: normalizeConfig(), file }) }
      catch (error) { reply(res, 500, { error: '读取设置失败：' + error.message }) }
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/discover') {
      try { reply(res, 200, await discovery(parseDshPort(url.searchParams.get('port')), url.searchParams.has('refresh'))) }
      catch (error) { reply(res, 502, { error: error.message }) }
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/discover/install') {
      try {
        const { id } = await jsonBody(req)
        if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(id)) throw new Error('图库 ID 无效')
        const dir = await discovery(parseDshPort(url.searchParams.get('port')))
        if (!dir.connected) throw new Error('未连接到 dsh-meme；请填写 DSH Web 端口')
        const pack = dir.packs.find(p => p.id === id)
        if (!pack) throw new Error('图库不在当前目录中')
        const operation = pack.archiveUrl && pack.sha256
          ? { op: 'installRemoteArchive', archiveUrl: pack.archiveUrl, sha256: pack.sha256, packId: pack.id, name: pack.name, version: pack.version }
          : pack.manifestUrl ? { op: 'subscribeRemote', manifestUrl: pack.manifestUrl, packId: pack.id } : null
        if (!operation) throw new Error('此图库缺少可校验的 ZIP 或远程清单，无法一键安装')
        const result = await callMemeApi(dir.port, operation, fetchImpl)
        if (typeof result.id !== 'string') throw new Error('dsh-meme 没有返回任务编号')
        jobs.set(result.id, { port: dir.port, at: Date.now() })
        for (const [key, value] of jobs) if (Date.now() - value.at > 60 * 60 * 1000) jobs.delete(key)
        reply(res, 200, { jobId: result.id, state: result.state, message: result.message })
      } catch (error) { reply(res, 400, { error: error.message }) }
      return
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/discover/job/')) {
      try {
        const id = decodeURIComponent(url.pathname.slice('/api/discover/job/'.length))
        const job = jobs.get(id)
        if (!job) throw new Error('安装任务已过期')
        const result = await callMemeApi(job.port, { op: 'remoteJobStatus', jobId: id }, fetchImpl)
        if (result.state !== 'running') jobs.delete(id)
        reply(res, 200, { state: result.state, message: result.message, done: result.done, total: result.total })
      } catch (error) { reply(res, 400, { error: error.message }) }
      return
    }
    if (req.method === 'PUT' && url.pathname === '/api/settings') {
      try { reply(res, 200, { settings: writeSettings(file, await jsonBody(req)) }) }
      catch (error) { reply(res, 400, { error: error.message }) }
      return
    }
    reply(res, 404, { error: '页面不存在' })
  })
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(port, '127.0.0.1', resolveListen)
  })
  return { server, file, url: 'http://127.0.0.1:' + server.address().port + '/?token=' + token, token }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startSettingsUi().then(({ url, file }) => {
    process.stdout.write('陪伴插件设置页：' + url + '\n设置文件：' + file + '\n关闭此终端即关闭设置页，DSH 插件仍可继续运行。\n')
    const opener = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
    const child = spawn(opener, [url], { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', () => {})
    child.unref()
  }).catch((error) => {
    process.stderr.write('设置页启动失败：' + error.message + '\n')
    process.exitCode = 1
  })
}
