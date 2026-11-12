function clean(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function grams(value) {
  const chars = [...clean(value)]
  if (chars.length < 2) return new Set(chars)
  return new Set(chars.slice(0, -1).map((char, index) => char + chars[index + 1]))
}

function similarity(query, text) {
  const needle = clean(query)
  const hay = clean(text)
  if (!needle || !hay) return 0
  if (hay.includes(needle)) return 1
  const queryGrams = grams(needle)
  const hayGrams = grams(hay)
  const matching = [...queryGrams].filter((gram) => hayGrams.has(gram)).length
  const overlap = queryGrams.size ? matching / queryGrams.size : 0
  const queryChars = [...needle]
  const hayChars = [...hay]
  if (queryChars.length >= 2 && queryChars.length <= 6 && hayChars.length >= queryChars.length) {
    for (let start = 0; start <= hayChars.length - queryChars.length; start++) {
      let differences = 0
      for (let index = 0; index < queryChars.length; index++) {
        if (queryChars[index] !== hayChars[start + index]) differences++
        if (differences > 1) break
      }
      if (differences === 1) return Math.max(overlap, 0.8 * (queryChars.length - 1) / queryChars.length)
    }
  }
  return overlap
}

export function searchVariants(query, alternatives = []) {
  const seeds = [query, ...alternatives].map((part) => String(part || '').trim().slice(0, 80)).filter(Boolean)
  const variants = []
  const add = (part) => { if (part && !variants.includes(part)) variants.push(part) }
  for (const seed of seeds) add(seed)
  for (const seed of seeds) {
    for (const part of seed.split(/[\s,，、。！!？?;；/]+/u)) {
      if ([...clean(part)].length >= 2) add(part)
    }
  }
  for (const seed of seeds) {
    const chars = [...clean(seed)]
    if (chars.length >= 3 && chars.length <= 16) {
      for (let index = 0; index < chars.length - 1; index++) add(chars[index] + chars[index + 1])
    }
  }
  return variants.slice(0, 10)
}

export function rankMemes(memes, variants, limit = 5) {
  const seen = new Set()
  return memes.map((meme) => {
    const caption = String(meme?.caption || '').trim()
    const keywords = Array.isArray(meme?.keywords) ? meme.keywords.join(' ') : String(meme?.keywords || '')
    const hay = caption + ' ' + keywords + ' ' + String(meme?.tag || '')
    const score = Math.max(0, ...variants.map((query, index) => similarity(query, hay) * (index === 0 ? 1 : 0.85)))
    return { caption, tag: String(meme?.tag || ''), pack: String(meme?.packName || meme?.pack || ''), score }
  }).filter((item) => item.caption && item.score >= 0.25)
    .sort((left, right) => right.score - left.score || left.caption.localeCompare(right.caption, 'zh-CN'))
    .filter((item) => {
      const key = item.caption + '\0' + item.pack
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
    .map((item) => ({ ...item, score: Number(item.score.toFixed(2)), marker: '[表情: ' + item.caption + ']' }))
}

export async function findMemeCandidates(service, { query, alternatives = [], limit = 5 }) {
  const variants = searchVariants(query, alternatives)
  if (!variants.length) throw new Error('请给出与当前对话相关的搜索词')
  const found = []
  const errors = []
  for (const variant of variants) {
    try {
      const result = await service.search({ query: variant, limit: 12 })
      if (Array.isArray(result?.memes)) found.push(...result.memes)
    } catch (error) {
      errors.push(error)
    }
    if (found.length >= 48) break
  }
  let candidates = rankMemes(found, variants, limit)
  const chars = [...clean(query)]
  if (!candidates.length && chars.length >= 2 && chars.length <= 6 && chars.some((char) => /\p{Script=Han}/u.test(char))) {
    for (const char of [...new Set(chars)].slice(0, 3)) {
      try {
        const result = await service.search({ query: char, limit: 30 })
        if (Array.isArray(result?.memes)) found.push(...result.memes)
      } catch (error) { errors.push(error) }
    }
    candidates = rankMemes(found, variants, limit)
  }
  if (!found.length && errors.length >= variants.length) throw new Error('dsh-meme 检索暂不可用')
  return candidates
}
