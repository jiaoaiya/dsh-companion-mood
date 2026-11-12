export const SOURCE_KIND = 'companion-mood'
export const EMOTIONS = ['好奇', '愉快', '雀跃', '安静', '低落', '关切']

const EMOTION_TARGETS = {
  好奇: { valence: 0.1, energy: 0.55 },
  愉快: { valence: 0.45, energy: 0.65 },
  雀跃: { valence: 0.75, energy: 0.85 },
  安静: { valence: 0.05, energy: 0.25 },
  低落: { valence: -0.45, energy: 0.3 },
  关切: { valence: -0.05, energy: 0.6 },
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function normalizeConfig(raw = {}) {
  const number = (key, fallback, min, max) => {
    const value = Number(raw[key])
    return Number.isFinite(value) ? clamp(value, min, max) : fallback
  }
  let timeZone = String(raw.timeZone || 'Asia/Shanghai')
  try { new Intl.DateTimeFormat('en-US', { timeZone }) } catch { timeZone = 'Asia/Shanghai' }
  return {
    enabled: raw.enabled !== false,
    targetSessionId: String(raw.targetSessionId || '').trim(),
    checkMinutes: number('checkMinutes', 5, 1, 1440),
    assessmentIdleMinutes: number('assessmentIdleMinutes', 3, 1, 60),
    reassessMinutes: number('reassessMinutes', 240, 30, 1440),
    minIdleMinutes: number('minIdleMinutes', 30, 1, 10080),
    cooldownMinutes: number('cooldownMinutes', 180, 1, 10080),
    maxPerDay: number('maxPerDay', 2, 0, 24),
    timeZone,
    memeMode: ['off', 'natural', 'often'].includes(raw.memeMode) ? raw.memeMode : 'often',
    autoCollectMemes: raw.autoCollectMemes === true,
    quietStartHour: number('quietStartHour', 23, 0, 23),
    quietEndHour: number('quietEndHour', 8, 0, 23),
  }
}

export function initialState() {
  return {
    valence: 0.1,
    energy: 0.55,
    closeness: 0.35,
    updatedAt: Date.now(),
    lastHumanAt: 0,
    lastContactAt: 0,
    targetSessionId: '',
    day: '',
    countToday: 0,
    paused: false,
    modelEmotion: '',
    modelEmotionAt: 0,
    lastPlannedHumanAt: 0,
    assessmentDueAt: 0,
    assessmentAttempts: 0,
    lastAssessmentAt: 0,
    lastDecision: '',
    collectedHashes: [],
    lastAutoCollectResult: '',
    lastAutoCollectAt: 0,
    plan: null,
  }
}

export function advanceMood(state, now) {
  const elapsedHours = clamp((now - state.updatedAt) / 3600000, 0, 168)
  const fade = Math.exp(-elapsedHours / 24)
  const restingValence = 0.08 * Math.sin(now / 21600000)
  const restingEnergy = 0.5 + 0.1 * Math.sin(now / 43200000)
  state.valence = clamp(restingValence + (state.valence - restingValence) * fade, -1, 1)
  state.energy = clamp(restingEnergy + (state.energy - restingEnergy) * fade, 0, 1)
  state.updatedAt = now
  return state
}

export function observeHuman(state, now) {
  advanceMood(state, now)
  state.closeness = clamp(state.closeness + 0.015, 0, 1)
  state.lastHumanAt = now
  state.plan = null
  state.lastPlannedHumanAt = 0
  state.assessmentDueAt = 0
  state.assessmentAttempts = 0
  state.lastDecision = ''
  state.lastAssessmentAt = 0
  return state
}

export function recordContactPlan(state, decision, delayMinutes, sessionId, now, minIdleMinutes) {
  if (!state.lastHumanAt || !sessionId) throw new Error('没有可规划的真人会话')
  if (decision !== 'send' && decision !== 'skip') throw new Error('invalid decision')
  if (decision === 'send' && (!Number.isInteger(delayMinutes) || delayMinutes < 1 || delayMinutes > 1440)) {
    throw new Error('invalid delayMinutes')
  }
  state.lastPlannedHumanAt = state.lastHumanAt
  state.plan = decision === 'send' && !state.paused
    ? {
        sessionId,
        humanAt: state.lastHumanAt,
        createdAt: now,
        dueAt: now + Math.max(delayMinutes, minIdleMinutes) * 60000,
      }
    : null
  return state.plan
}

export function recordModelMood(state, emotion, intensity, now) {
  if (!EMOTION_TARGETS[emotion]) throw new Error('unknown emotion')
  const strength = clamp(Number(intensity), 0, 1)
  if (!Number.isFinite(strength)) throw new Error('invalid intensity')
  advanceMood(state, now)
  const target = EMOTION_TARGETS[emotion]
  state.valence = clamp(state.valence * (1 - strength) + target.valence * strength, -1, 1)
  state.energy = clamp(state.energy * (1 - strength) + target.energy * strength, 0, 1)
  state.modelEmotion = emotion
  state.modelEmotionAt = now
  return state
}

export function moodName(state, now = Date.now()) {
  if (EMOTION_TARGETS[state.modelEmotion] && now - state.modelEmotionAt < 36 * 3600000) {
    return state.modelEmotion
  }
  if (state.valence < -0.25) return '低落'
  if (state.energy < 0.35) return '安静'
  if (state.valence > 0.38 && state.energy > 0.6) return '雀跃'
  if (state.valence > 0.18) return '愉快'
  return '好奇'
}

export function isQuietHour(hour, start, end) {
  if (start === end) return false
  return start < end ? hour >= start && hour < end : hour >= start || hour < end
}

export function localClock(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const pick = (type) => parts.find((part) => part.type === type)?.value
  return {
    hour: Number(pick('hour')),
    day: pick('year') + '-' + pick('month') + '-' + pick('day'),
  }
}

export function canContact(state, config, now, hour, day, sessionId) {
  if (!config.enabled || state.paused || !state.lastHumanAt || now < state.lastHumanAt) return false
  const plan = state.plan
  if (!plan || plan.sessionId !== sessionId || plan.humanAt !== state.lastHumanAt) return false
  if (now < plan.dueAt || now < plan.createdAt) return false
  if (isQuietHour(hour, config.quietStartHour, config.quietEndHour)) return false
  if (now - state.lastHumanAt < config.minIdleMinutes * 60000) return false
  if (now - state.lastContactAt < config.cooldownMinutes * 60000) return false
  if ((state.day === day ? state.countToday : 0) >= config.maxPerDay) return false
  return true
}
