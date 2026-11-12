import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canContact, initialState, isQuietHour, localClock, moodName, normalizeConfig, observeHuman, recordContactPlan, recordModelMood } from '../logic.js'

test('the model chooses mood after reading the conversation', () => {
  const state = initialState()
  const now = state.updatedAt + 1000
  observeHuman(state, now)
  assert.equal(state.lastHumanAt, now)
  assert.equal(state.modelEmotion, '')
  recordModelMood(state, '关切', 0.8, now + 1000)
  assert.equal(moodName(state, now + 1000), '关切')
  assert.equal(state.modelEmotionAt, now + 1000)
  assert.throws(() => recordModelMood(state, '凭关键词猜的', 0.5, now + 2000))
})

test('quiet hours span midnight and stop at the endpoint', () => {
  assert.equal(isQuietHour(23, 23, 8), true)
  assert.equal(isQuietHour(7, 23, 8), true)
  assert.equal(isQuietHour(8, 23, 8), false)
})

test('quiet hours use the configured time zone', () => {
  const clock = localClock(new Date('2026-11-11T16:30:00Z'), 'Asia/Shanghai')
  assert.deepEqual(clock, { hour: 0, day: '2026-11-12' })
  assert.equal(isQuietHour(clock.hour, 23, 8), true)
})

test('the model chooses whether and when to contact after a real conversation', () => {
  const config = normalizeConfig()
  const now = Date.UTC(2026, 10, 11, 10)
  const day = '2026-11-11'
  const state = initialState()
  state.lastHumanAt = now - 60 * 60000
  assert.equal(canContact(state, config, now, 10, day, 'session-one'), false)
  recordContactPlan(state, 'skip', undefined, 'session-one', now - 40 * 60000, config.minIdleMinutes)
  assert.equal(state.plan, null)
  recordContactPlan(state, 'send', 35, 'session-one', now - 40 * 60000, config.minIdleMinutes)
  assert.equal(canContact(state, config, now, 10, day, 'session-one'), true)
  assert.equal(canContact(state, config, now, 10, day, 'session-two'), false)
  assert.equal(canContact(state, config, now, 23, day, 'session-one'), false)
  state.lastContactAt = now - 5 * 60000
  assert.equal(canContact(state, config, now, 10, day, 'session-one'), false)
  state.lastContactAt = 0
  state.day = day
  state.countToday = 2
  assert.equal(canContact(state, config, now, 10, day, 'session-one'), false)
  state.countToday = 0
  state.paused = true
  assert.equal(canContact(state, config, now, 10, day, 'session-one'), false)
  state.paused = false
  observeHuman(state, now + 1000)
  assert.equal(state.plan, null)
  assert.equal(canContact(state, config, now + 2000, 10, day, 'session-one'), false)
})
