import { afterEach, describe, expect, it } from 'vitest'
import {
  __resetInflightForTests,
  inflightWriteCount,
  oldestInflightWriteMs,
  writeSettled,
  writeStarted,
} from './inflightWrites'

const T0 = 1_700_000_000_000

afterEach(() => {
  __resetInflightForTests()
})

describe('inflightWrites', () => {
  it('tracks issue → settle lifecycle', () => {
    expect(oldestInflightWriteMs()).toBeNull()
    const a = writeStarted(T0)
    const b = writeStarted(T0 + 1_000)
    expect(inflightWriteCount()).toBe(2)
    expect(oldestInflightWriteMs()).toBe(T0)
    writeSettled(a)
    expect(oldestInflightWriteMs()).toBe(T0 + 1_000)
    writeSettled(b)
    expect(oldestInflightWriteMs()).toBeNull()
    expect(inflightWriteCount()).toBe(0)
  })

  it('oldest survives out-of-order settlement', () => {
    const a = writeStarted(T0)
    const b = writeStarted(T0 + 500)
    const c = writeStarted(T0 + 900)
    writeSettled(b)
    expect(oldestInflightWriteMs()).toBe(T0)
    writeSettled(a)
    expect(oldestInflightWriteMs()).toBe(T0 + 900)
    writeSettled(c)
    expect(oldestInflightWriteMs()).toBeNull()
  })

  it('settling an unknown id is a no-op', () => {
    writeStarted(T0)
    writeSettled(999_999)
    expect(inflightWriteCount()).toBe(1)
  })

  it('rejection counts as settled (via the same writeSettled path)', async () => {
    // Mirrors fsIntercept.trackWrite: both promise branches call writeSettled.
    const id = writeStarted(T0)
    const p = Promise.reject(new Error('permission-denied'))
    await p.then(
      () => writeSettled(id),
      () => writeSettled(id),
    )
    expect(inflightWriteCount()).toBe(0)
  })
})
