import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { assessmentPrompt, conversationForAssessment, lastHumanImage, parseAssessment, shouldAssess } from '../after-chat.js'

test('post-chat assessment sees the final assistant reply and ignores internal triggers', () => {
  const events = new Map([
    [1, { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '今天加班很累' }] } }],
    [2, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '辛苦了，先休息一下。' }] } } }],
    [3, { type: 'user/message', data: { source: { kind: 'companion-mood' }, content: [{ type: 'text', text: '内部触发' }] } }],
  ])
  const messages = conversationForAssessment({ surface: { nodes: [1, 2, 3] }, eventAt: seq => events.get(seq) })
  assert.deepEqual(messages.map(m => m.role), ['用户', '助手'])
  assert.match(assessmentPrompt(messages, '安静'), /辛苦了，先休息一下/)
  assert.doesNotMatch(assessmentPrompt(messages, '安静'), /内部触发/)
})

test('post-chat assessment validates the model decision and idle boundary', () => {
  assert.deepEqual(parseAssessment('{"emotion":"关切","intensity":0.7,"decision":"send","delayMinutes":30}'), {
    emotion: '关切', intensity: 0.7, decision: 'send', delayMinutes: 30, collectMeme: false,
  })
  assert.equal(parseAssessment('{"emotion":"安静","intensity":0.2,"decision":"skip","collectMeme":true}').collectMeme, true)
  assert.throws(() => parseAssessment('{"emotion":"安静","intensity":0.2,"decision":"skip","collectMeme":"yes"}'), /收藏判断/)
  assert.equal(parseAssessment('{"emotion":"安静","intensity":0.2,"decision":"skip"}').delayMinutes, undefined)
  assert.throws(() => parseAssessment('{"emotion":"愉快","intensity":2,"decision":"send","delayMinutes":30}'), /强度/)
  const state = { paused: false, lastHumanAt: 100, lastPlannedHumanAt: 0, assessmentDueAt: 200, targetSessionId: 'a' }
  assert.equal(shouldAssess(state, { enabled: true }, 199, { id: 'a', status: 'idle' }), false)
  assert.equal(shouldAssess(state, { enabled: true }, 200, { id: 'a', status: 'idle' }), true)
  assert.equal(shouldAssess(state, { enabled: true }, 200, { id: 'a', status: 'running' }), false)
  state.lastPlannedHumanAt = state.lastHumanAt
  assert.equal(shouldAssess(state, { enabled: true }, 200, { id: 'a', status: 'idle' }), true)
  assert.match(assessmentPrompt([{ role: '用户', text: '明天再聊' }], '安静', false, 240), /240 分钟/)
})

test('only the latest real user message supplies an image to review', () => {
  const image = { attachmentId: 'image-1', mediaType: 'image/png' }
  const events = new Map([
    [1, { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'image', attachment: { attachmentId: 'older' } }, { type: 'image', attachment: image }] } }],
    [2, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '好图' }] } } }],
    [3, { type: 'user/message', data: { source: { kind: 'companion-mood' }, content: [{ type: 'image', attachment: { attachmentId: 'internal' } }] } }],
  ])
  const session = { surface: { nodes: [1, 2, 3] }, eventAt: seq => events.get(seq) }
  assert.deepEqual(lastHumanImage(session), image)
  assert.match(assessmentPrompt([{ role: '用户', text: '看看这个' }], '愉快', true), /collectMeme/)
  events.set(4, { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '换个话题' }] } })
  session.surface.nodes.push(4)
  assert.equal(lastHumanImage(session), null)
})

test('DSH client bundle registers a visible settings section', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  let loaded
  const head = { append() {} }
  const document = { currentScript: { src: `http://localhost/plugins/${pkg.name}/client.js` }, createElement: () => ({ dataset: {}, remove() {} }), head }
  runInNewContext(source, { window: { __ModuleLoader__: { load: value => { loaded = value } } }, document, URL })
  assert.equal(loaded.id, pkg.name)
  const module = loaded.factory(name => {
    assert.equal(name, 'react')
    return { createElement: () => ({}) }
  })
  const registered = []
  const slots = { inject: (_name, callback) => callback(), register: options => { registered.push(options) } }
  module.apply({ get: () => slots, effect: callback => callback() })
  assert.ok(registered.some(row => row.name === 'settings.section' && row.label === '陪伴'))
  assert.ok(registered.some(row => row.name === 'plugins.bundle.config' && row.key === pkg.name))
})
