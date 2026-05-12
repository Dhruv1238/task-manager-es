import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

interface ThemeContextValue {
  mode: ThemeMode
  resolved: ResolvedTheme
  setMode: (m: ThemeMode) => void
  cycle: () => void
}

const STORAGE_KEY = 'theme'
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

function readStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system'
  const v = window.localStorage.getItem(STORAGE_KEY)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}

function systemPrefersLight(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-color-scheme: light)').matches
}

function resolveMode(mode: ThemeMode, sysLight: boolean): ResolvedTheme {
  if (mode === 'system') return sysLight ? 'light' : 'dark'
  return mode
}

function applyClass(resolved: ResolvedTheme) {
  const root = document.documentElement
  // Suspend transitions while we swap the theme so text/buttons don't fade
  // through intermediate colors (which reads as a flicker). Two rAFs lets the
  // browser paint the new theme without animation, then transitions resume
  // for normal hover/focus interactions.
  root.classList.add('theme-switching')
  if (resolved === 'light') root.classList.add('light')
  else root.classList.remove('light')
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove('theme-switching')
    })
  })
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode())
  const [sysLight, setSysLight] = useState<boolean>(() => systemPrefersLight())

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: light)')
    const handler = (e: MediaQueryListEvent) => setSysLight(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  const resolved = resolveMode(mode, sysLight)

  useEffect(() => {
    applyClass(resolved)
  }, [resolved])

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m)
    try {
      window.localStorage.setItem(STORAGE_KEY, m)
    } catch {
      // ignore quota / private-mode errors
    }
  }, [])

  const cycle = useCallback(() => {
    setMode(mode === 'dark' ? 'light' : mode === 'light' ? 'system' : 'dark')
  }, [mode, setMode])

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolved, setMode, cycle }),
    [mode, resolved, setMode, cycle],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
