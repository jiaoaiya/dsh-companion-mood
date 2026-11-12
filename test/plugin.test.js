import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'

test('plugin evaluates the finished chat while idle, then cancels the plan on a new message', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-companion-mood-'))
  const originalHome = process.env.DSH_HOME
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  const file = join(root, 'storages', 'companion-mood', 'state.json')
  const preferencesFile = join(root, 'storages', 'companion-mood', 'settings.json')
  const humanAt = Date.now() - 40 * 60000
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({
    valence: 0.25, energy: 0.6, closeness: 0.4,
    updatedAt: humanAt,
    lastHumanAt: humanAt,
    lastContactAt: 0, targetSessionId: 'session-one', day: '', countToday: 0,
    lastPlannedHumanAt: 0, assessmentDueAt: Date.now() - 1000,
    plan: null,
  }))

  let tick
  let promptContext
  let claimed
  let agentStatus
  let sessionEvent
  let modelCalls = 0
  const registeredTools = {}
  const sent = []
  const events = new Map([
    [1, { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '今天有点累' }] } }],
    [2, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '辛苦了，休息一下吧。' }] } } }],
  ])
  const agent = {
    id: 'session-one', status: 'idle', session: {
      id: 'session-one', meta: { origin: 'user' }, surface: { nodes: [1, 2] },
      eventAt: seq => events.get(seq), requestHeader: () => ({ config: { provider: 'test', model: 'test-model' } }),
    },
    followup: async (message) => { sent.push(message) },
  }
  globalThis.setInterval = (callback) => { tick = callback; return 1 }
  globalThis.clearInterval = () => {}
  process.env.DSH_HOME = root
  try {
    apply({
      agents: { get: (id) => id === agent.id ? agent : undefined },
      systemPrompt: { context: (value) => { promptContext = value } },
      tools: {
        register: (definition) => { registeredTools[definition.name] = definition },
        get: (toolName) => toolName === 'send_meme' ? { name: toolName } : undefined,
      },
      get: name => name === 'llm' ? { stream: async function* ({ messages }) {
        modelCalls++
        assert.match(messages[0].content[0].text, /辛苦了，休息一下吧/)
        yield { type: 'text-delta', text: '{"emotion":"关切","intensity":0.8,"decision":"send","delayMinutes":45}' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      } } : undefined,
      on: (event, callback) => { if (event === 'agent/inbox/claimed') claimed = callback; if (event === 'agent/status') agentStatus = callback; if (event === 'session/event') sessionEvent = callback },
      effect: (callback) => { callback() },
    }, { quietStartHour: 0, quietEndHour: 0, checkMinutes: 1 })

    assert.match(promptContext.text({ agent }), /陪伴状态/)
    assert.equal(registeredTools.companion_set_mood, undefined)
    assert.equal(registeredTools.companion_plan_contact, undefined)
    assert.doesNotMatch(promptContext.text({ agent }), /先调用 companion_set_mood/)
    writeFileSync(preferencesFile, JSON.stringify({ enabled: false }))
    assert.equal(promptContext.text({ agent }), '')
    tick()
    await new Promise(setImmediate)
    assert.equal(sent.length, 0)
    writeFileSync(preferencesFile, JSON.stringify({ enabled: true, memeMode: 'off' }))
    assert.doesNotMatch(promptContext.text({ agent }), /send_meme/)
    writeFileSync(preferencesFile, JSON.stringify({ enabled: true, memeMode: 'often' }))
    tick()
    await new Promise(setImmediate)
    assert.equal(modelCalls, 1)
    assert.equal(sent.length, 0)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).modelEmotion, '关切')
    assert.ok(JSON.parse(readFileSync(file, 'utf8')).plan.dueAt > Date.now())

    claimed({ agent, message: { source: { kind: 'user' }, content: [{ type: 'text', text: '刚才的话题我还想聊' }] } })
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).plan, null)
    agentStatus({ agent, status: 'idle' })
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).assessmentDueAt, 0)
    sessionEvent(agent.session, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    agentStatus({ agent, status: 'idle' })
    assert.ok(JSON.parse(readFileSync(file, 'utf8')).assessmentDueAt > Date.now())
    assert.doesNotMatch(promptContext.text({ agent }), /companion_plan_contact/)
    assert.match(promptContext.text({ agent }), /send_meme/)
    assert.match(promptContext.text({ agent }), /query 搜索/)
    assert.match(promptContext.text({ agent }), /核对候选描述/)
    assert.match(promptContext.text({ agent }), /合适的回合尽量常发/)
    tick()
    await new Promise(setImmediate)
    assert.equal(sent.length, 0)
    assert.equal(modelCalls, 1)

    claimed({ agent, message: { source: { kind: 'user' }, content: [{ type: 'text', text: '别主动找我' }] } })
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).plan, null)
    tick()
    await new Promise(setImmediate)
    assert.equal(sent.length, 0)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).paused, true)
  } finally {
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
    if (originalHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalHome
    rmSync(root, { recursive: true, force: true })
  }
})

test('a skipped chat is reassessed later and can become a contact plan', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-companion-reassess-'))
  const originalHome = process.env.DSH_HOME
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  const file = join(root, 'storages', 'companion-mood', 'state.json')
  const humanAt = Date.now() - 8 * 3600000
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({
    lastHumanAt: humanAt, lastPlannedHumanAt: humanAt, targetSessionId: 'revisit',
    modelEmotion: '安静', modelEmotionAt: humanAt + 3 * 60000, plan: null,
    lastDecision: 'skip', lastAssessmentAt: humanAt + 3 * 60000, assessmentDueAt: Date.now() - 1000,
  }))
  const events = new Map([
    [1, { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '最近有什么趣事吗' }] } }],
    [2, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '有，晚点再聊。' }] } } }],
  ])
  const agent = { id: 'revisit', status: 'idle', session: {
    id: 'revisit', meta: { origin: 'user' }, surface: { nodes: [1, 2] },
    eventAt: seq => events.get(seq),
    requestHeader: () => ({ config: { provider: 'test', model: 'test-model' } }),
  } }
  let tick
  let calls = 0
  process.env.DSH_HOME = root
  globalThis.setInterval = callback => { tick = callback; return 1 }
  globalThis.clearInterval = () => {}
  try {
    apply({
      agents: { get: () => agent }, systemPrompt: { context: () => {} },
      tools: { register: () => {}, get: () => undefined },
      get: name => name === 'llm' ? { stream: async function* () {
        calls++
        yield { type: 'text-delta', text: '{"emotion":"好奇","intensity":0.6,"decision":"send","delayMinutes":30}' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      } } : undefined,
      on: () => {}, effect: callback => { callback() },
    }, { checkMinutes: 1, reassessMinutes: 30 })
    tick()
    for (let i = 0; i < 30; i++) {
      if (JSON.parse(readFileSync(file, 'utf8')).lastDecision === 'send') break
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(calls, 1)
    assert.equal(saved.lastDecision, 'send')
    assert.ok(saved.plan.dueAt > Date.now())
    assert.equal(saved.assessmentDueAt, 0)
  } finally {
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
    if (originalHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalHome
    rmSync(root, { recursive: true, force: true })
  }
})

test('upgrade schedules a new assessment for an old skipped decision', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-companion-upgrade-'))
  const originalHome = process.env.DSH_HOME
  const file = join(root, 'storages', 'companion-mood', 'state.json')
  const humanAt = Date.now() - 8 * 3600000
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({
    lastHumanAt: humanAt, lastPlannedHumanAt: humanAt, targetSessionId: 'old-session',
    modelEmotion: '安静', modelEmotionAt: humanAt + 3 * 60000, plan: null,
  }))
  process.env.DSH_HOME = root
  try {
    apply({
      agents: { get: () => undefined }, systemPrompt: { context: () => {} },
      tools: { register: () => {}, get: () => undefined },
      on: () => {}, effect: () => {},
    }, { reassessMinutes: 240 })
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(saved.lastDecision, 'skip')
    assert.ok(saved.assessmentDueAt > Date.now())
  } finally {
    if (originalHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalHome
    rmSync(root, { recursive: true, force: true })
  }
})

test('opted-in image review saves a chosen meme through dsh-meme', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-companion-collect-'))
  const originalHome = process.env.DSH_HOME
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  const file = join(root, 'storages', 'companion-mood', 'state.json')
  const preferences = join(root, 'storages', 'companion-mood', 'settings.json')
  mkdirSync(dirname(file), { recursive: true })
  const humanAt = Date.now() - 40 * 60000
  writeFileSync(file, JSON.stringify({ lastHumanAt: humanAt, lastPlannedHumanAt: 0, targetSessionId: 'image-session', assessmentDueAt: Date.now() - 1000 }))
  writeFileSync(preferences, JSON.stringify({ autoCollectMemes: true }))
  const image = { attachmentId: 'image-1', mediaType: 'image/png' }
  const events = new Map([
    [1, { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '这个表情好玩' }, { type: 'image', attachment: image }] } }],
    [2, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '确实挺有趣' }] } } }],
  ])
  const agent = { id: 'image-session', status: 'idle', session: {
    id: 'image-session', meta: { origin: 'user' }, surface: { nodes: [1, 2] }, eventAt: seq => events.get(seq),
    requestHeader: () => ({ config: { provider: 'test', model: 'vision' } }),
  } }
  let tick
  let saves = 0
  process.env.DSH_HOME = root
  globalThis.setInterval = callback => { tick = callback; return 1 }
  globalThis.clearInterval = () => {}
  try {
    apply({
      agents: { get: () => agent }, systemPrompt: { context: () => {} },
      tools: {
        register: () => {}, get: name => name === 'learn_meme' ? { name } : undefined,
        execute: async batch => {
          saves++
          assert.equal(batch.calls[0].name, 'learn_meme')
          assert.equal(JSON.parse(batch.calls[0].arguments).attachmentId, image.attachmentId)
          return { results: [{ result: { isError: false, value: { ok: true, message: '已收录到我的收藏' } } }] }
        },
      },
      get: name => name === 'llm' ? {
        resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }),
        stream: async function* ({ messages }) {
          assert.equal(messages[0].content[1].attachment.attachmentId, image.attachmentId)
          yield { type: 'text-delta', text: '{"emotion":"愉快","intensity":0.7,"decision":"skip","collectMeme":true}' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      } : name === 'attachments' ? { readImage: async () => ({ data: Buffer.from('sample-image-bytes') }) } : undefined,
      on: () => {}, effect: callback => { callback() },
    })
    tick()
    for (let i = 0; i < 30 && !saves; i++) await new Promise(resolve => setTimeout(resolve, 5))
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(saves, 1)
    assert.equal(saved.collectedHashes.length, 1)
    assert.match(saved.lastAutoCollectResult, /已收录/)
    assert.equal(saved.lastDecision, 'skip')
    assert.ok(saved.assessmentDueAt > Date.now())
  } finally {
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
    if (originalHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalHome
    rmSync(root, { recursive: true, force: true })
  }
})

test('image review failure still completes the ordinary mood assessment', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-companion-image-fallback-'))
  const originalHome = process.env.DSH_HOME
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  const file = join(root, 'storages', 'companion-mood', 'state.json')
  mkdirSync(dirname(file), { recursive: true })
  const humanAt = Date.now() - 40 * 60000
  writeFileSync(file, JSON.stringify({ lastHumanAt: humanAt, lastPlannedHumanAt: 0, targetSessionId: 'fallback', assessmentDueAt: Date.now() - 1000 }))
  writeFileSync(join(dirname(file), 'settings.json'), JSON.stringify({ autoCollectMemes: true }))
  const image = { attachmentId: 'bad-image' }
  const events = new Map([
    [1, { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '看看' }, { type: 'image', attachment: image }] } }],
    [2, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '看到了' }] } } }],
  ])
  const agent = { id: 'fallback', status: 'idle', session: {
    id: 'fallback', meta: { origin: 'user' }, surface: { nodes: [1, 2] }, eventAt: seq => events.get(seq),
    requestHeader: () => ({ config: { provider: 'test', model: 'vision' } }),
  } }
  let tick
  let calls = 0
  process.env.DSH_HOME = root
  globalThis.setInterval = callback => { tick = callback; return 1 }
  globalThis.clearInterval = () => {}
  try {
    apply({
      agents: { get: () => agent }, systemPrompt: { context: () => {} },
      tools: { register: () => {}, get: name => name === 'learn_meme' ? { name } : undefined, execute: () => { throw new Error('should not save') } },
      get: name => name === 'llm' ? {
        resolveModelInfo: async () => ({ inputModalities: ['image'] }),
        stream: async function* ({ messages }) {
          calls++
          if (messages[0].content.some(part => part.type === 'image')) throw new Error('vision unavailable')
          yield { type: 'text-delta', text: '{"emotion":"安静","intensity":0.4,"decision":"skip"}' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      } : undefined,
      on: () => {}, effect: callback => { callback() },
    })
    tick()
    for (let i = 0; i < 30; i++) {
      if (JSON.parse(readFileSync(file, 'utf8')).lastPlannedHumanAt === humanAt) break
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(calls, 2)
    assert.equal(saved.modelEmotion, '安静')
    assert.match(saved.lastAutoCollectResult, /识图评估失败/)
  } finally {
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
    if (originalHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalHome
    rmSync(root, { recursive: true, force: true })
  }
})

test('plugin searches enabled dsh-meme packs before choosing a sticker', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-companion-memes-'))
  const originalHome = process.env.DSH_HOME
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  process.env.DSH_HOME = root
  globalThis.setInterval = () => 1
  globalThis.clearInterval = () => {}
  const agent = { id: 'meme-session', status: 'idle', session: { meta: { origin: 'user' } } }
  const registered = {}
  let context
  let searches = 0
  try {
    apply({
      agents: { get: () => agent },
      get: (name) => name === 'dshMeme' ? {
        search: async () => {
          searches++
          return { memes: [{ caption: '加班到趴桌', keywords: '工作 累', packName: '大肥鱼' }] }
        },
      } : undefined,
      tools: {
        register: (definition) => { registered[definition.name] = definition },
        get: (name) => name === 'send_meme' ? { name } : undefined,
      },
      systemPrompt: { context: (value) => { context = value } },
      on: () => {}, effect: (callback) => { callback() },
    })
    assert.match(context.text({ agent }), /companion_find_meme/)
    const response = JSON.parse(await registered.companion_find_meme.execute({ query: '加班', alternatives: ['工作太累'] }, { agent }))
    assert.equal(response.source, 'dsh-meme')
    assert.equal(response.candidates[0].caption, '加班到趴桌')
    assert.ok(searches >= 2)
    assert.match(response.guidance, /send_meme/)
  } finally {
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
    if (originalHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalHome
    rmSync(root, { recursive: true, force: true })
  }
})
