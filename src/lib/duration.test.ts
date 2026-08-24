import { describe, it, expect } from 'vitest'
import {
  composeMinutes,
  formatDateKey,
  formatDuration,
  monthStartDateKey,
  parseDateKey,
  shiftDateKey,
  splitMinutes,
  toDateKey,
  todayDateKey,
} from './duration'

describe('composeMinutes', () => {
  it('adds hours and minutes into a canonical total', () => {
    expect(composeMinutes(0, 30)).toBe(30)
    expect(composeMinutes(4, 45)).toBe(285)
    expect(composeMinutes(1, 0)).toBe(60)
    expect(composeMinutes(0, 0)).toBe(0)
  })

  it('accepts hour counts beyond a day (no upper cap by design)', () => {
    expect(composeMinutes(30, 0)).toBe(1800)
  })

  it('clamps junk and fractional input instead of producing NaN', () => {
    expect(composeMinutes(NaN, 30)).toBe(30)
    expect(composeMinutes(-2, 15)).toBe(15)
    expect(composeMinutes(1, -5)).toBe(60)
    expect(composeMinutes(1.9, 30.7)).toBe(90)
  })
})

describe('splitMinutes', () => {
  it('is the inverse of composeMinutes', () => {
    expect(splitMinutes(285)).toEqual({ hours: 4, minutes: 45 })
    expect(splitMinutes(60)).toEqual({ hours: 1, minutes: 0 })
    expect(splitMinutes(30)).toEqual({ hours: 0, minutes: 30 })
    expect(splitMinutes(0)).toEqual({ hours: 0, minutes: 0 })
  })

  it('clamps negatives to zero', () => {
    expect(splitMinutes(-90)).toEqual({ hours: 0, minutes: 0 })
  })
})

describe('formatDuration', () => {
  it('renders hours, minutes, or both', () => {
    expect(formatDuration(95)).toBe('1h 35m')
    expect(formatDuration(60)).toBe('1h')
    expect(formatDuration(180)).toBe('3h')
    expect(formatDuration(45)).toBe('45m')
    expect(formatDuration(0)).toBe('0m')
  })

  it('treats missing counters as zero (legacy tasks have no timeSpentMinutes)', () => {
    expect(formatDuration(undefined)).toBe('0m')
    expect(formatDuration(null)).toBe('0m')
    expect(formatDuration(NaN)).toBe('0m')
    expect(formatDuration(-30)).toBe('0m')
  })
})

describe('dateKey helpers', () => {
  it('formats a local date without shifting the day', () => {
    // 23:30 local on the 24th must stay the 24th — the bug a UTC-based
    // toISOString().slice(0,10) would introduce east of UTC.
    expect(toDateKey(new Date(2026, 7, 24, 23, 30))).toBe('2026-08-24')
    expect(toDateKey(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01')
  })

  it('round-trips through parseDateKey as local midnight', () => {
    const parsed = parseDateKey('2026-08-24')
    expect(parsed).not.toBeNull()
    expect(parsed!.getFullYear()).toBe(2026)
    expect(parsed!.getMonth()).toBe(7)
    expect(parsed!.getDate()).toBe(24)
    expect(parsed!.getHours()).toBe(0)
    expect(toDateKey(parsed!)).toBe('2026-08-24')
  })

  it('rejects malformed and calendar-invalid keys', () => {
    expect(parseDateKey('')).toBeNull()
    expect(parseDateKey('2026-8-4')).toBeNull()
    expect(parseDateKey('24-08-2026')).toBeNull()
    expect(parseDateKey('2026-02-31')).toBeNull()
    expect(parseDateKey('2026-13-01')).toBeNull()
  })

  it('shifts across month and year boundaries', () => {
    expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDateKey('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDateKey('2026-08-24', 7)).toBe('2026-08-31')
    expect(shiftDateKey('2024-02-28', 1)).toBe('2024-02-29') // leap year
    expect(shiftDateKey('2026-08-24', 0)).toBe('2026-08-24')
  })

  it('returns a malformed key unchanged rather than inventing a date', () => {
    expect(shiftDateKey('nonsense', -1)).toBe('nonsense')
    expect(formatDateKey('nonsense')).toBe('nonsense')
  })

  it('produces keys that sort lexicographically in chronological order', () => {
    const keys = ['2026-08-24', '2025-12-31', '2026-01-01', '2026-08-03']
    expect(keys.slice().sort()).toEqual([
      '2025-12-31',
      '2026-01-01',
      '2026-08-03',
      '2026-08-24',
    ])
  })

  it('anchors today and the month start to the same local day', () => {
    const today = todayDateKey()
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(today).toBe(toDateKey(new Date()))
    expect(monthStartDateKey()).toBe(`${today.slice(0, 7)}-01`)
    expect(monthStartDateKey() <= today).toBe(true)
  })

  it('includes the year only when it differs from the current one', () => {
    const thisYear = new Date().getFullYear()
    expect(formatDateKey(`${thisYear}-08-24`)).not.toMatch(String(thisYear))
    expect(formatDateKey(`${thisYear - 1}-08-24`)).toMatch(String(thisYear - 1))
  })
})
