import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findMemeCandidates, rankMemes, searchVariants } from '../meme-search.js'

test('fuzzy search tries related phrases and ranks matching dsh-meme captions', async () => {
  const searched = []
  const service = {
    search: async ({ query, limit }) => {
      searched.push({ query, limit })
      return { memes: [
        { caption: '加班到趴桌', keywords: '工作 累', tag: 'work', packName: '大肥鱼' },
        { caption: '周末去晒太阳', keywords: '休息', tag: 'happy', packName: '官方' },
      ] }
    },
  }
  const found = await findMemeCandidates(service, { query: '加斑', alternatives: ['加班'], limit: 5 })
  assert.ok(searched.some((call) => call.query === '加班'))
  assert.equal(found.length, 1)
  assert.equal(found[0].caption, '加班到趴桌')
  assert.equal(found[0].pack, '大肥鱼')
  assert.equal(found[0].marker, '[表情: 加班到趴桌]')
})

test('fuzzy ranking rejects unrelated candidates and does not invent captions', () => {
  assert.ok(searchVariants('今天加班太累了').length > 1)
  assert.deepEqual(rankMemes([{ caption: '周末去晒太阳', keywords: '休息' }], ['加班'], 5), [])
})

test('single-character fallback recovers a one-character typo', async () => {
  const searched = []
  const service = { search: async ({ query }) => {
    searched.push(query)
    return { memes: query === '加' ? [{ caption: '加班到趴桌', keywords: '工作' }] : [] }
  } }
  const found = await findMemeCandidates(service, { query: '加斑' })
  assert.ok(searched.includes('加'))
  assert.equal(found[0].caption, '加班到趴桌')
})
