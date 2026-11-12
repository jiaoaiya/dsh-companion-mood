const API_PATH = '/dsh-memes-api'
const DEFAULT_PORTS = [3000, 3001, 3080, 3210, 5173, 8000, 8080, 8787]

export function parseDshPort(value) {
  if (value == null || value === '' || value === 0) return 0
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DSH 端口必须是 1–65535 的整数')
  return port
}

function candidates(requestedPort, excludePort) {
  const all = requestedPort ? [requestedPort] : [
    process.env.DSH_WEB_PORT, process.env.DSH_PORT, process.env.PORT, ...DEFAULT_PORTS,
  ]
  return [...new Set(all.map(x => { try { return parseDshPort(x) } catch { return 0 } }).filter(x => x && x !== excludePort))]
}

async function readJson(response) {
  const raw = await response.text()
  if (raw.length > 4 * 1024 * 1024) throw new Error('dsh-meme 响应过大')
  let data
  try { data = JSON.parse(raw) } catch { throw new Error('dsh-meme 返回了无效数据') }
  if (!response.ok) throw new Error(data?.error || 'dsh-meme 返回 HTTP ' + response.status)
  return data
}

export async function probeMemeApi({ port = 0, excludePort = 0, fetchImpl = fetch } = {}) {
  const ports = candidates(parseDshPort(port), excludePort)
  const attempts = ports.map(async candidate => {
    const url = 'http://127.0.0.1:' + candidate + API_PATH + '?packId=__companion_probe__&q=__companion_no_match__'
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(1800), redirect: 'error' })
    const data = await readJson(response)
    if (data?.ok !== true || !Array.isArray(data.packs)) throw new Error('此端口没有 dsh-meme')
    return { port: candidate, installedIds: data.packs.map(p => p?.id).filter(x => typeof x === 'string') }
  })
  try { return await Promise.any(attempts) } catch { return null }
}

export async function getMemeDirectory(port, fetchImpl = fetch) {
  const response = await fetchImpl('http://127.0.0.1:' + parseDshPort(port) + API_PATH + '?remoteDir=1', {
    signal: AbortSignal.timeout(35000), redirect: 'error',
  })
  const data = await readJson(response)
  if (data?.ok !== true || !Array.isArray(data.remoteDir)) throw new Error(data?.remoteDirError || 'dsh-meme 图库目录不可用')
  return { rows: data.remoteDir, stale: !!data.remoteDirCached }
}

export async function callMemeApi(port, operation, fetchImpl = fetch) {
  const response = await fetchImpl('http://127.0.0.1:' + parseDshPort(port) + API_PATH, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operation),
  })
  const data = await readJson(response)
  if (data?.ok !== true) throw new Error(data?.error || 'dsh-meme 操作失败')
  return data
}
