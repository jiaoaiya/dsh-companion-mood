const CATALOG_URLS = Object.freeze([
  'https://raw.githubusercontent.com/yyh-001/dsh-meme-packs/main/catalog.json',
  'https://cdn.jsdelivr.net/gh/yyh-001/dsh-meme-packs@main/catalog.json',
])
const CACHE_MS = 5 * 60 * 1000
const MAX_BYTES = 2 * 1024 * 1024

export function safeHttpsUrl(value) {
  if (typeof value !== 'string') return ''
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''
  } catch { return '' }
}

export function normalizeCatalog(input) {
  const rows = Array.isArray(input) ? input : input?.packs
  if (!Array.isArray(rows)) throw new Error('图库目录格式无效')
  const seen = new Set()
  const packs = []
  for (const item of rows.slice(0, 500)) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(item.id) || seen.has(item.id)) continue
    const name = String(item.name || '').trim().slice(0, 80)
    if (!name) continue
    seen.add(item.id)
    packs.push({
      id: item.id,
      name,
      version: String(item.version || '').slice(0, 40),
      description: String(item.description || '').slice(0, 500),
      maintainer: String(item.maintainer || item.author || '').slice(0, 80),
      count: Number.isSafeInteger(item.count) && item.count >= 0 ? item.count : null,
      downloads: Number.isSafeInteger(item.downloads) && item.downloads >= 0 ? item.downloads : null,
      bytes: Number.isSafeInteger(item.bytes) && item.bytes >= 0 ? item.bytes : null,
      preview: safeHttpsUrl(item.preview),
      previews: Array.isArray(item.previews) ? item.previews.map(safeHttpsUrl).filter(Boolean).slice(0, 24) : [],
      keywords: Array.isArray(item.keywords) ? item.keywords.filter(x => typeof x === 'string').map(x => x.slice(0, 60)).slice(0, 15) : [],
      archiveUrl: safeHttpsUrl(item.archiveUrl),
      manifestUrl: safeHttpsUrl(item.manifestUrl),
      sha256: /^[a-f0-9]{64}$/i.test(item.sha256 || '') ? item.sha256.toLowerCase() : '',
      homepage: safeHttpsUrl(item.homepage),
    })
  }
  return { updatedAt: typeof input?.updatedAt === 'string' ? input.updatedAt : '', packs }
}

export function createCatalogLoader({ fetchImpl = fetch, now = Date.now, urls = CATALOG_URLS } = {}) {
  let cached
  let expires = 0
  let pending
  return async function loadCatalog({ force = false } = {}) {
    if (!force && cached && now() < expires) return cached
    if (pending) return pending
    pending = (async () => {
      let lastError
      for (const url of urls) {
        try {
          const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } })
          if (!response.ok) throw new Error('HTTP ' + response.status)
          const length = Number(response.headers.get('content-length'))
          if (length > MAX_BYTES) throw new Error('目录超过 2 MB')
          const reader = response.body?.getReader()
          if (!reader) throw new Error('目录内容为空')
          const chunks = []
          let total = 0
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            total += value.byteLength
            if (total > MAX_BYTES) { await reader.cancel(); throw new Error('目录超过 2 MB') }
            chunks.push(value)
          }
          const bytes = new Uint8Array(total)
          let offset = 0
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
          cached = normalizeCatalog(JSON.parse(new TextDecoder().decode(bytes)))
          expires = now() + CACHE_MS
          return cached
        } catch (error) { lastError = error }
      }
      if (cached) return { ...cached, stale: true }
      throw new Error('获取图库目录失败：' + (lastError?.message || '网络不可用'))
    })()
    try { return await pending } finally { pending = null }
  }
}

export const loadCatalog = createCatalogLoader()
