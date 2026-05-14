import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { doc, getDoc, onSnapshot, Timestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { AppConfig, Stage } from '../types/models'

const STORAGE_KEY = 'appConfig:v1'
const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const ALL_STAGES: Stage[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

// Default config — used when no Firestore doc exists yet AND no localStorage
// snapshot has been captured. Preserves Client A (tender pipeline on) behavior.
export const DEFAULT_APP_CONFIG: AppConfig = {
  version: 0,
  updatedAt: Timestamp.fromMillis(0),
  updatedBy: '',
  pipeline: {
    enabled: true,
    enabledStages: ALL_STAGES,
  },
  features: {
    chat: false,
  },
}

interface CachedEntry {
  config: AppConfig
  fetchedAt: number
}

// localStorage holds an opaque JSON blob. Timestamp instances don't survive
// JSON.stringify, so we serialize via { seconds, nanoseconds } and rehydrate.
interface SerializedTimestamp {
  seconds: number
  nanoseconds: number
}

interface SerializedConfig extends Omit<AppConfig, 'updatedAt'> {
  updatedAt: SerializedTimestamp
}

function serializeConfig(c: AppConfig): SerializedConfig {
  return {
    ...c,
    updatedAt: { seconds: c.updatedAt.seconds, nanoseconds: c.updatedAt.nanoseconds },
  }
}

function hydrateConfig(s: SerializedConfig): AppConfig {
  return {
    ...s,
    updatedAt: new Timestamp(s.updatedAt.seconds, s.updatedAt.nanoseconds),
  }
}

function readCache(): CachedEntry | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { config: SerializedConfig; fetchedAt: number }
    if (!parsed?.config || typeof parsed.fetchedAt !== 'number') return null
    return { config: hydrateConfig(parsed.config), fetchedAt: parsed.fetchedAt }
  } catch {
    return null
  }
}

function writeCache(config: AppConfig) {
  if (typeof window === 'undefined') return
  try {
    const payload = { config: serializeConfig(config), fetchedAt: Date.now() }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // ignore quota / private-mode errors
  }
}

// Non-React snapshot reader. Used by callers outside the component tree —
// e.g. lib/firestore.ts addProject() needs to know whether to write stage fields
// without threading the config through every call site.
export function getAppConfigSnapshot(): AppConfig {
  const cached = readCache()
  return cached?.config ?? DEFAULT_APP_CONFIG
}

interface AppConfigContextValue {
  config: AppConfig
  // True while the initial Firestore refresh is in flight. UI generally doesn't
  // need to wait for this — the cached/default value is rendered synchronously.
  refreshing: boolean
  // Forces a Firestore fetch regardless of TTL. Used by the admin screen.
  refresh: () => Promise<void>
  // Used by the admin screen after a successful save to update other open tabs
  // and the current tab's render without waiting on a server round-trip.
  setConfigOptimistic: (next: AppConfig) => void
}

const AppConfigContext = createContext<AppConfigContextValue | undefined>(undefined)

export function AppConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(() => readCache()?.config ?? DEFAULT_APP_CONFIG)
  const [refreshing, setRefreshing] = useState<boolean>(false)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const snap = await getDoc(doc(db, 'config', 'appConfig'))
      if (snap.exists()) {
        const next = snap.data() as AppConfig
        setConfig(next)
        writeCache(next)
      } else {
        // Doc missing — seed localStorage with the default so we don't refetch
        // on every page load looking for a doc that won't exist until the admin
        // saves for the first time.
        writeCache(DEFAULT_APP_CONFIG)
      }
    } finally {
      setRefreshing(false)
    }
  }, [])

  // Boot: refresh from Firestore if cache is missing or older than TTL.
  useEffect(() => {
    const cached = readCache()
    const stale = !cached || Date.now() - cached.fetchedAt > TTL_MS
    if (stale) {
      void refresh()
    }
  }, [refresh])

  // Cross-tab sync: when another tab writes the cache (typically the admin tab
  // after a save), update our copy without making any Firestore reads.
  useEffect(() => {
    if (typeof window === 'undefined') return
    function handler(e: StorageEvent) {
      if (e.key !== STORAGE_KEY || !e.newValue) return
      const cached = readCache()
      if (cached) setConfig(cached.config)
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  const setConfigOptimistic = useCallback((next: AppConfig) => {
    setConfig(next)
    writeCache(next)
  }, [])

  const value = useMemo<AppConfigContextValue>(
    () => ({ config, refreshing, refresh, setConfigOptimistic }),
    [config, refreshing, refresh, setConfigOptimistic],
  )

  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>
}

export function useAppConfigContext(): AppConfigContextValue {
  const ctx = useContext(AppConfigContext)
  if (!ctx) throw new Error('useAppConfig must be used inside <AppConfigProvider>')
  return ctx
}

export function useAppConfig(): AppConfig {
  return useAppConfigContext().config
}

export function usePipelineEnabled(): boolean {
  return useAppConfigContext().config.pipeline.enabled
}

export function useStageEnabled(stage: Stage | undefined): boolean {
  const { config } = useAppConfigContext()
  if (!stage) return false
  if (!config.pipeline.enabled) return false
  return config.pipeline.enabledStages.includes(stage)
}

export function useChatEnabled(): boolean {
  return useAppConfigContext().config.features.chat
}

// Derived label for project-creation CTAs. When the tender pipeline is on we
// surface "New Tender"; otherwise the simple-Jira-mode "New Project". Keeps
// the rest of the UI ("Projects" headings, etc.) consistent with the data
// model name — only the creation entry point flips.
export function useCreateProjectLabel(): string {
  return usePipelineEnabled() ? 'New Tender' : 'New Project'
}

// Live-onSnapshot variant for the admin screen ONLY. Mounts a listener while
// the screen is open so multi-editor edits show up in realtime. Regular users
// don't use this — they read the cached snapshot via useAppConfig().
export function useAppConfigLive(): { config: AppConfig | null; loading: boolean } {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    return onSnapshot(doc(db, 'config', 'appConfig'), (snap) => {
      if (snap.exists()) {
        setConfig(snap.data() as AppConfig)
      } else {
        setConfig(null)
      }
      setLoading(false)
    })
  }, [])

  return { config, loading }
}
