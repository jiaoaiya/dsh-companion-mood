import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { normalizeConfig } from './logic.js'

export const SETTINGS_KEYS = Object.freeze([
  'enabled', 'checkMinutes', 'assessmentIdleMinutes', 'reassessMinutes', 'minIdleMinutes', 'cooldownMinutes', 'maxPerDay',
  'timeZone', 'quietStartHour', 'quietEndHour', 'memeMode', 'autoCollectMemes', 'targetSessionId',
])

const LIMITS = {
  checkMinutes: [1, 1440], assessmentIdleMinutes: [1, 60], reassessMinutes: [30, 1440], minIdleMinutes: [1, 10080],
  cooldownMinutes: [1, 10080], maxPerDay: [0, 24],
  quietStartHour: [0, 23], quietEndHour: [0, 23],
}

export function settingsFile(home = process.env.DSH_HOME || join(homedir(), '.dsh')) {
  return join(home, 'storages', 'companion-mood', 'settings.json')
}

export function validateSettings(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('设置必须是对象')
  const result = {}
  for (const key of Object.keys(input)) {
    if (!SETTINGS_KEYS.includes(key)) throw new Error('未知设置：' + key)
  }
  if (!partial && SETTINGS_KEYS.some((key) => !Object.hasOwn(input, key))) throw new Error('缺少设置项')
  for (const key of SETTINGS_KEYS) {
    if (!Object.hasOwn(input, key)) continue
    const value = input[key]
    if (key === 'enabled' || key === 'autoCollectMemes') {
      if (typeof value !== 'boolean') throw new Error(key + ' 必须是开关')
      result[key] = value
    } else if (key in LIMITS) {
      const [min, max] = LIMITS[key]
      if (!Number.isInteger(value) || value < min || value > max) throw new Error(key + ' 必须是 ' + min + '–' + max + ' 的整数')
      result[key] = value
    } else if (key === 'memeMode') {
      if (!['off', 'natural', 'often'].includes(value)) throw new Error('表情包模式无效')
      result[key] = value
    } else if (key === 'targetSessionId') {
      if (typeof value !== 'string' || value.length > 200) throw new Error('会话 ID 无效')
      result[key] = value.trim()
    } else if (key === 'timeZone') {
      if (typeof value !== 'string' || !value.trim() || value.length > 100) throw new Error('时区无效')
      try { new Intl.DateTimeFormat('en-US', { timeZone: value.trim() }) } catch { throw new Error('时区无效') }
      result[key] = value.trim()
    }
  }
  return result
}

export function readSettings(file = settingsFile()) {
  if (!existsSync(file)) return {}
  return validateSettings(JSON.parse(readFileSync(file, 'utf8')), { partial: true })
}

export function effectiveSettings(file = settingsFile(), base = {}) {
  return normalizeConfig({ ...base, ...readSettings(file) })
}

export function writeSettings(file, input) {
  const settings = validateSettings(input)
  mkdirSync(dirname(file), { recursive: true })
  const temp = file + '.' + process.pid + '.tmp'
  writeFileSync(temp, JSON.stringify(settings, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  renameSync(temp, file)
  return settings
}
