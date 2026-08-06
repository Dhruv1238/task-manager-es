import { describe, expect, it } from 'vitest'
import { getTag, normalizePath, tagQuery } from './normalizePath'

describe('normalizePath', () => {
  it('keeps a bare collection', () => {
    expect(normalizePath('projects')).toBe('projects')
  })

  it('collapses a doc path to its parent collection', () => {
    expect(normalizePath('projects/p1')).toBe('projects')
  })

  it('stars doc ids in nested paths', () => {
    expect(normalizePath('projects/p1/chat')).toBe('projects/*/chat')
    expect(normalizePath('projects/p1/chat/m1')).toBe('projects/*/chat')
    expect(normalizePath('projects/p1/subtasks/s9')).toBe('projects/*/subtasks')
  })

  it('strips the sandbox visitor prefix', () => {
    expect(normalizePath('sandbox/u1/projects')).toBe('projects')
    expect(normalizePath('sandbox/u1/projects/p1')).toBe('projects')
    expect(normalizePath('sandbox/u1/projects/p1/chat/m1')).toBe('projects/*/chat')
  })

  it('does not strip a literal two-segment sandbox doc path', () => {
    // 'sandbox/u1' alone is a doc in a real collection named sandbox.
    expect(normalizePath('sandbox/u1')).toBe('sandbox')
  })

  it('handles config-style single docs and slashes', () => {
    expect(normalizePath('config/orgStructure')).toBe('config')
    expect(normalizePath('/projects/p1/')).toBe('projects')
    expect(normalizePath('')).toBe('(root)')
  })
})

describe('getTag', () => {
  it('reads a public .path off refs', () => {
    expect(getTag({ path: 'projects/p1' })).toBe('projects')
  })

  it('falls back to the WeakMap for queries and to (unknown) otherwise', () => {
    const q = {}
    tagQuery(q, 'projects')
    expect(getTag(q)).toBe('projects')
    expect(getTag({})).toBe('(unknown)')
    expect(getTag(null)).toBe('(unknown)')
    expect(getTag(undefined)).toBe('(unknown)')
  })
})
