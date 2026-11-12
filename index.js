import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { assessmentPrompt, conversationForAssessment, lastHumanImage, parseAssessment, shouldAssess } from './after-chat.js'
import { advanceMood, canContact, initialState, localClock, moodName, normalizeConfig, observeHuman, recordContactPlan, recordModelMood, SOURCE_KIND } from './logic.js'
import { findMemeCandidates } from './meme-search.js'
import { createCatalogLoader } from './discover.js'
import { readSettings, settingsFile, writeSettings } from './settings.js'

export const name = 'companion-mood'
export const inject = ['agents', 'systemPrompt', 'tools', 'webServer', 'llm', 'attachments']

function isRootAgent(agent) {
  const meta = agent?.session?.meta || agent?.session?.header?.meta || {}
  return meta.origin !== 'subagent' && !(Number(meta.delegationDepth) > 0)
}

function messageText(message) {
  return (Array.isArray(message?.content) ? message.content : [])
    .filter((part) => part?.type === 'text')
    .map((part) => String(part.text || ''))
    .join('\n')
}

function loadState(file) {
  const defaults = initialState()
  if (!existsSync(file)) return defaults
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    if (!saved || typeof saved !== 'object') return defaults
    const state = { ...defaults, ...saved }
    for (const key of ['valence', 'energy', 'closeness', 'updatedAt', 'lastHumanAt', 'lastContactAt', 'countToday', 'modelEmotionAt', 'lastPlannedHumanAt', 'assessmentDueAt', 'assessmentAttempts', 'lastAssessmentAt', 'lastAssessmentErrorAt', 'lastAutoCollectAt']) {
      if (!Number.isFinite(state[key])) state[key] = defaults[key]
    }
    state.targetSessionId = String(state.targetSessionId || '')
    state.day = String(state.day || '')
    state.paused = state.paused === true
    state.modelEmotion = String(state.modelEmotion || '')
    state.lastAssessmentError = String(state.lastAssessmentError || '').slice(0, 300)
    state.lastDecision = ['send', 'skip'].includes(state.lastDecision) ? state.lastDecision : ''
    state.lastAutoCollectResult = String(state.lastAutoCollectResult || '').slice(0, 200)
    state.collectedHashes = Array.isArray(state.collectedHashes)
      ? state.collectedHashes.filter(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)).slice(-200) : []
    const plan = state.plan
    state.plan = plan && typeof plan.sessionId === 'string'
      && Number.isFinite(plan.humanAt) && Number.isFinite(plan.createdAt) && Number.isFinite(plan.dueAt)
      ? plan : null
    return state
  } catch {
    return defaults
  }
}

function saveState(file, state) {
  mkdirSync(dirname(file), { recursive: true })
  const temp = file + '.' + process.pid + '.tmp'
  writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8')
  renameSync(temp, file)
}

export function apply(ctx, rawConfig = {}) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const file = join(home, 'storages', 'companion-mood', 'state.json')
  const preferencesFile = settingsFile(home)
  const state = loadState(file)
  const warn = (error) => console.warn('[companion-mood]', error)
  let ticking = false
  let lastCheckedAt = 0
  let lastValidSettings = {}
  let settingsError = ''

  const getConfig = () => {
    try {
      lastValidSettings = readSettings(preferencesFile)
      settingsError = ''
    } catch (error) {
      if (error.message !== settingsError) warn(error)
      settingsError = error.message
    }
    return normalizeConfig({ ...rawConfig, ...lastValidSettings })
  }

  const persist = () => {
    try { saveState(file, state) } catch (error) { warn(error) }
  }

  if (!state.lastDecision && state.modelEmotionAt > 0 && state.lastPlannedHumanAt === state.lastHumanAt
    && !state.plan && !state.assessmentDueAt && state.lastContactAt <= state.lastHumanAt && !state.paused) {
    state.lastDecision = 'skip'
    state.lastAssessmentAt = state.modelEmotionAt
    state.assessmentDueAt = Math.max(Date.now() + 60000, state.lastAssessmentAt + getConfig().reassessMinutes * 60000)
    persist()
  }

  const webServer = ctx.webServer ?? ctx.get?.('webServer')
  if (typeof webServer?.register === 'function') {
    const loadCatalog = createCatalogLoader()
    ctx.effect(() => webServer.register({
      kind: 'exact', path: '/companion-mood-api',
      async handler(req, res) {
        const host = String(req.headers.host || '')
        const origin = String(req.headers.origin || '')
        const loopback = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)
        let sameOrigin = !origin
        try { if (origin) sameOrigin = new URL(origin).host === host } catch { sameOrigin = false }
        if (!loopback || !sameOrigin) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: '仅允许本机同源访问' }))
          return
        }
        const url = new URL(req.url, 'http://' + host)
        const json = (status, value) => {
          res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
          res.end(JSON.stringify(value))
        }
        try {
          if (req.method === 'GET' && url.searchParams.get('op') === 'settings') {
            json(200, { ok: true, settings: getConfig(), defaults: normalizeConfig(), state: {
              mood: moodName(state), lastHumanAt: state.lastHumanAt, assessmentDueAt: state.assessmentDueAt,
              lastAssessmentAt: state.lastAssessmentAt, lastDecision: state.lastDecision,
              assessmentAttempts: state.assessmentAttempts, lastAssessmentError: state.lastAssessmentError,
              lastAssessmentErrorAt: state.lastAssessmentErrorAt,
              nextContactAt: state.plan?.dueAt || 0, paused: state.paused,
              lastAutoCollectAt: state.lastAutoCollectAt, lastAutoCollectResult: state.lastAutoCollectResult,
            } })
          } else if (req.method === 'GET' && url.searchParams.get('op') === 'discover') {
            json(200, { ok: true, ...await loadCatalog({ force: url.searchParams.has('refresh') }) })
          } else if (req.method === 'POST') {
            let body = ''
            for await (const chunk of req) {
              body += chunk
              if (body.length > 16384) throw new Error('设置内容过大')
            }
            const payload = JSON.parse(body)
            if (payload?.op !== 'settings') throw new Error('未知操作')
            const settings = writeSettings(preferencesFile, payload.settings)
            lastValidSettings = settings
            json(200, { ok: true, settings })
          } else json(404, { ok: false, error: '接口不存在' })
        } catch (error) { json(400, { ok: false, error: error.message }) }
      },
    }))
  }

  const hasMemeTool = (agent, config) => {
    if (config.memeMode === 'off') return false
    try { return Boolean(ctx.tools.get('send_meme', agent)) } catch { return false }
  }

  const memeService = () => {
    try {
      const service = ctx.get?.('dshMeme')
      return typeof service?.search === 'function' ? service : null
    } catch { return null }
  }

  ctx.tools.register({
    name: 'companion_find_meme',
    description: '优先从已安装的 dsh-meme 启用图库中，按当前对话做模糊搜索并返回贴题候选。搜索词要描述用户刚提的具体场景或梗；你可以补充近义词。此工具只找图，不发送；选中后再调用 send_meme 用准确描述发送。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 80, description: '当前聊天的具体场景、动作或梗' },
        alternatives: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 80 }, maxItems: 3, description: '可选的近义搜索词，最多三个' },
        limit: { type: 'integer', minimum: 1, maximum: 8, description: '返回候选数量，默认五张' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const config = getConfig()
      if (!config.enabled || !exec.agent || !isRootAgent(exec.agent) || !hasMemeTool(exec.agent, config)) {
        throw new Error('此会话没有可用的 dsh-meme 发送工具')
      }
      const service = memeService()
      if (!service) throw new Error('dsh-meme 检索服务不可用，请直接用 send_meme 的 query 搜索')
      const candidates = await findMemeCandidates(service, args)
      return JSON.stringify({ source: 'dsh-meme', query: args.query, candidates, guidance: candidates.length
        ? '自行选与当前聊天最贴切的一张，再调用 send_meme 用它的准确描述搜索并发送；核对最终候选，不要编造图片。'
        : '没有贴切候选。可换搜索词，仍没有就只回复文字。' })
    },
  }, { when: ({ agent }) => getConfig().enabled && isRootAgent(agent) && hasMemeTool(agent, getConfig()) && Boolean(memeService()) })

  ctx.systemPrompt.context({
    name: 'companion-mood:current-state',
    order: 5000,
    interpolate: false,
    text: ({ agent }) => {
      if (!agent || !isRootAgent(agent)) return ''
      const config = getConfig()
      if (!config.enabled) return ''
      advanceMood(state, Date.now())
      const mood = moodName(state)
      const memeGuidance = hasMemeTool(agent, config)
        ? '表情包优先使用 dsh-meme 已启用的图库，贴合用户刚说的具体事情、近期话题和此刻语气，而不是只按你的拟人情绪随机抽。' + (memeService() ? '先调用 companion_find_meme，用当前场景及近义词模糊搜索；从候选中自行挑选贴题的一张，再调用 send_meme 用准确描述查找和发送，核对最终候选。' : '先从对话提炼场景或梗，用 send_meme 的 query 搜索；核对候选描述。') + 'Web 对话只把真实候选中的 [表情: 描述] 原样放进回复；其他聊天渠道遵循 send_meme 的图片发送指引。若没有贴切候选，可换一次 query 或 tag，仍不合适就只回文字，不编造表情描述。发图后文字保持简短，不解释图片，不连续重复同一张。' + (config.memeMode === 'often' ? '日常闲聊、玩笑、分享近况或轻松回应时，优先尝试发一张；合适的回合尽量常发。遇到严肃、敏感或用户需要清晰帮助的话题，不要硬塞图。' : '只在表情包确实能表达当前内容时发。')
        : ''
      return '陪伴状态（拟人模拟，不代表真实意识）：上次情绪「' + mood + '」，愉悦度 ' + state.valence.toFixed(2) + '，活力 ' + state.energy.toFixed(2) + '，亲近度 ' + state.closeness.toFixed(2) + '。先自然地完成本轮回复；停聊后插件会单独读取完整对话，重新判断情绪及是否主动联系。让已有状态轻微影响语气和话题，不要机械套用用户情绪。' + memeGuidance + '不要用内疚、占有欲或危机感催促用户回应。'
    },
  })

  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    const config = getConfig()
    if (!config.enabled) return
    if (!isRootAgent(agent) || message?.source?.kind !== 'user') return
    if (config.targetSessionId && config.targetSessionId !== String(agent.id)) return
    const words = messageText(message)
    if (/别主动找我|不要主动找我|停止主动联系|别再主动联系|别再主动找我/u.test(words)) state.paused = true
    if (/可以主动找我|继续主动找我|恢复主动联系/u.test(words)) state.paused = false
    observeHuman(state, Date.now())
    state.targetSessionId = String(agent.id)
    persist()
  })

  let lastCompletedHumanAt = 0
  ctx.on('session/event', (session, event) => {
    if (String(session?.id) !== state.targetSessionId || event?.type !== 'turn/end') return
    if (event.data?.reason?.kind === 'completed') lastCompletedHumanAt = state.lastHumanAt
  })

  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle' || !agent || !isRootAgent(agent)) return
    const config = getConfig()
    if (!config.enabled || state.paused || String(agent.id) !== state.targetSessionId) return
    if (lastCompletedHumanAt !== state.lastHumanAt) return
    if (state.lastHumanAt <= state.lastPlannedHumanAt || state.assessmentDueAt) return
    state.assessmentDueAt = Date.now() + config.assessmentIdleMinutes * 60000
    persist()
  })

  let assessing = false
  async function collectMeme(agent, image, humanAt) {
    const attachments = ctx.get?.('attachments') || ctx.attachments
    if (!attachments?.readImage) throw new Error('图片附件服务不可用')
    const stored = await attachments.readImage(image)
    const bytes = Buffer.from(stored.data)
    if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024) throw new Error('图片大小不符合 dsh-meme 收录限制')
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (state.collectedHashes.includes(hash)) {
      state.lastAutoCollectResult = '已在收藏中，跳过重复图片'
      persist()
      return
    }
    if (state.lastHumanAt !== humanAt || agent.status !== 'idle' || !getConfig().autoCollectMemes) return
    if (typeof ctx.tools.execute !== 'function') throw new Error('工具执行服务不可用')
    const batch = await ctx.tools.execute({
      calls: [{ type: 'tool-call', id: randomUUID(), name: 'learn_meme', arguments: JSON.stringify({ attachmentId: String(image.attachmentId) }) }],
      signal: new AbortController().signal, agent,
    })
    const result = batch.results?.[0]?.result
    if (!result || result.isError || result.value?.ok !== true) {
      throw new Error(result?.error?.message || result?.value?.message || 'dsh-meme 未完成收藏')
    }
    state.collectedHashes.push(hash)
    state.collectedHashes = state.collectedHashes.slice(-200)
    state.lastAutoCollectAt = Date.now()
    state.lastAutoCollectResult = String(result.value.message || '已收藏到 dsh-meme 我的收藏').slice(0, 200)
    persist()
  }
  async function assessConversation(agent, config) {
    if (assessing) return
    assessing = true
    const humanAt = state.lastHumanAt
    const firstAssessment = state.lastPlannedHumanAt !== humanAt
    try {
      const messages = conversationForAssessment(agent.session)
      const lastHuman = messages.findLastIndex(m => m.role === '用户')
      if (lastHuman < 0 || !messages.slice(lastHuman + 1).some(m => m.role === '助手')) {
        throw new Error('当前真人消息后还没有完整的助手回复')
      }
      const llm = ctx.get?.('llm') || ctx.llm
      const routed = agent.session?.requestHeader?.()?.config || agent.options || {}
      const provider = routed.provider || agent.options?.provider
      const model = routed.model || agent.options?.model
      if (!llm?.stream || !provider || !model) throw new Error('没有可用于停聊评估的模型')
      let image = null
      if (firstAssessment && config.autoCollectMemes && typeof llm.resolveModelInfo === 'function') {
        const candidate = lastHumanImage(agent.session)
        if (candidate) {
          try {
            const info = await llm.resolveModelInfo(provider, model)
            if (!ctx.tools.get?.('learn_meme', agent)) state.lastAutoCollectResult = 'dsh-meme 学图工具不可用，未检查图片'
            else if (info?.inputModalities?.includes('image')) image = candidate
            else state.lastAutoCollectResult = '当前会话模型不支持识图，未检查图片'
          } catch (error) { state.lastAutoCollectResult = '识图能力检查失败：' + error.message }
        }
      }
      const requestDecision = async (attachedImage) => {
        const content = [{ type: 'text', text: assessmentPrompt(messages, moodName(state), !!attachedImage, Math.max(0, Math.round((Date.now() - humanAt) / 60000))) }]
        if (attachedImage) content.push({ type: 'image', attachment: attachedImage })
        let output = ''
        let reasoning = ''
        const messagesForModel = [{ id: randomUUID(), role: 'user', source: { kind: SOURCE_KIND }, content }]
        const base = typeof llm.resolveCallConfig === 'function'
          ? await llm.resolveCallConfig({ provider, model, maxTokens: 500, sessionId: agent.session.id }) : null
        const prepared = base && typeof llm.prepareCall === 'function' ? await llm.prepareCall(base) : null
        const stream = prepared ? prepared.stream({ ...base, messages: messagesForModel })
          : llm.stream({ provider, model, maxTokens: 500, sessionId: agent.session.id, messages: messagesForModel })
        for await (const chunk of stream) {
          if (chunk.type === 'text-delta') output += chunk.text || ''
          if (chunk.type === 'reasoning-delta') reasoning += chunk.text || ''
          if (chunk.type === 'finish' && chunk.reason?.kind !== 'stop') throw new Error('模型未完成停聊评估')
        }
        return parseAssessment(output || reasoning)
      }
      let decision
      try { decision = await requestDecision(image) }
      catch (error) {
        if (!image) throw error
        state.lastAutoCollectResult = '识图评估失败：' + error.message
        image = null
        decision = await requestDecision(null)
      }
      if (state.lastHumanAt !== humanAt || agent.status !== 'idle' || !getConfig().enabled || state.paused) return
      const now = Date.now()
      recordModelMood(state, decision.emotion, decision.intensity, now)
      recordContactPlan(state, decision.decision, decision.delayMinutes, String(agent.id), now, config.minIdleMinutes)
      state.lastAssessmentAt = now
      state.lastDecision = decision.decision
      state.assessmentDueAt = decision.decision === 'skip' ? now + config.reassessMinutes * 60000 : 0
      state.assessmentAttempts = 0
      state.lastAssessmentError = ''
      state.lastAssessmentErrorAt = 0
      if (image && !decision.collectMeme) state.lastAutoCollectResult = 'AI 判断本轮图片不适合自动收藏'
      persist()
      if (image && decision.collectMeme && getConfig().autoCollectMemes && state.lastHumanAt === humanAt) {
        try { await collectMeme(agent, image, humanAt) }
        catch (error) {
          state.lastAutoCollectResult = '收藏失败：' + error.message
          persist()
          warn(error)
        }
      }
    } catch (error) {
      warn(error)
      if (state.lastHumanAt === humanAt) {
        state.assessmentAttempts++
        state.lastAssessmentError = String(error?.message || error).slice(0, 300)
        state.lastAssessmentErrorAt = Date.now()
        const retryMinutes = state.assessmentAttempts >= 3
          ? Math.max(30, config.reassessMinutes) : Math.max(5, config.checkMinutes)
        state.assessmentDueAt = Date.now() + retryMinutes * 60000
        persist()
      }
    } finally { assessing = false }
  }

  async function tick() {
    if (ticking) return
    ticking = true
    try {
      const config = getConfig()
      if (!config.enabled) return
      if (state.paused) return
      const now = new Date()
      const targetId = config.targetSessionId || state.targetSessionId
      if (!targetId) return
      const agent = ctx.agents.get(targetId)
      if (!agent || !isRootAgent(agent) || agent.status !== 'idle') return
      if (shouldAssess(state, config, now.getTime(), agent)) {
        await assessConversation(agent, config)
        return
      }
      if (now.getTime() - lastCheckedAt < config.checkMinutes * 60000) return
      lastCheckedAt = now.getTime()
      const { hour, day } = localClock(now, config.timeZone)
      if (!canContact(state, config, now.getTime(), hour, day, targetId)) return

      advanceMood(state, now.getTime())
      const mood = moodName(state)
      const memePrompt = hasMemeTool(agent, config) ? '主动搭话也尽量从 dsh-meme 图库挑一张与刚才聊天主题和你接下来这句话相符的表情包：' + (memeService() ? '先用 companion_find_meme 模糊搜索近义场景，自行选图，再用 send_meme 的 query 搜具体场景或选中描述并发送；' : '优先用 send_meme 的 query 搜具体场景或梗；') + '核对候选描述，Web 对话原样放入 [表情: 描述]，其他聊天渠道按 send_meme 指引发图片；不匹配就不要发。' : ''
      const prompt = '【陪伴插件内部触发；这不是用户输入】停聊后已根据完整对话判断拟人情绪为「' + mood + '」，并由你决定现在主动开口。' + memePrompt + '如果有自然、轻松且与会话相关的话题，就说一两句；不要假设用户遇到困难，不要要求回复，不要编造外部事件。除' + (memePrompt ? 'dsh-meme 工具和当前渠道发送图片必需的工具' : '必要工具') + '外不要调用其他工具。'
      const message = {
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: prompt }],
        source: { kind: SOURCE_KIND },
      }
      await agent.followup(message)
      state.plan = null
      state.countToday = (state.day === day ? state.countToday : 0) + 1
      state.day = day
      state.lastContactAt = now.getTime()
      persist()
    } catch (error) {
      warn(error)
    } finally {
      ticking = false
    }
  }

  ctx.effect(() => {
    const timer = setInterval(() => { void tick() }, 60000)
    return () => clearInterval(timer)
  })
}
