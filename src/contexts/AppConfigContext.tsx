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
import type { AppConfig, OrgStructure } from '../types/models'
import { DEFAULT_ORG_STRUCTURE } from '../types/models'
import type { Workflow } from '../types/workflow'

const STORAGE_KEY = 'appConfig:v1'
const ORG_STORAGE_KEY = 'orgStructure:v1'
const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

// Default config — used when no Firestore doc exists yet AND no localStorage
// snapshot has been captured. Preserves Client A (tender pipeline on) behavior.
export const DEFAULT_APP_CONFIG: AppConfig = {
  version: 0,
  updatedAt: Timestamp.fromMillis(0),
  updatedBy: '',
  pipeline: {
    enabled: true,
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

// ─── Org structure: parallel cache, independent storage key ───────────────
// Mirrors the AppConfig cache pattern above. Lives at /config/orgStructure
// and is read by every authenticated client. Tenants configure their org
// shape (lead role name, team roles, work types, allotment) here; the rest
// of the code reads it via the hooks below and the lib/orgResolver helpers.

interface CachedOrgEntry {
  org: OrgStructure
  fetchedAt: number
}

interface SerializedOrgStructure extends Omit<OrgStructure, 'updatedAt'> {
  updatedAt: SerializedTimestamp
}

function serializeOrg(o: OrgStructure): SerializedOrgStructure {
  return {
    ...o,
    updatedAt: { seconds: o.updatedAt.seconds, nanoseconds: o.updatedAt.nanoseconds },
  }
}

function hydrateOrg(s: SerializedOrgStructure): OrgStructure {
  return {
    ...s,
    updatedAt: new Timestamp(s.updatedAt.seconds, s.updatedAt.nanoseconds),
  }
}

function readOrgCache(): CachedOrgEntry | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(ORG_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { org: SerializedOrgStructure; fetchedAt: number }
    if (!parsed?.org || typeof parsed.fetchedAt !== 'number') return null
    return { org: hydrateOrg(parsed.org), fetchedAt: parsed.fetchedAt }
  } catch {
    return null
  }
}

function writeOrgCache(org: OrgStructure) {
  if (typeof window === 'undefined') return
  try {
    const payload = { org: serializeOrg(org), fetchedAt: Date.now() }
    window.localStorage.setItem(ORG_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // ignore quota / private-mode errors
  }
}

export function getOrgStructureSnapshot(): OrgStructure {
  const cached = readOrgCache()
  return cached?.org ?? DEFAULT_ORG_STRUCTURE
}

interface AppConfigContextValue {
  config: AppConfig
  orgStructure: OrgStructure
  // True while the initial Firestore refresh is in flight. UI generally doesn't
  // need to wait for this — the cached/default value is rendered synchronously.
  refreshing: boolean
  // Forces a Firestore fetch regardless of TTL. Used by the admin screen.
  refresh: () => Promise<void>
  refreshOrg: () => Promise<void>
  // Used by the admin screen after a successful save to update other open tabs
  // and the current tab's render without waiting on a server round-trip.
  setConfigOptimistic: (next: AppConfig) => void
  setOrgStructureOptimistic: (next: OrgStructure) => void
}

const AppConfigContext = createContext<AppConfigContextValue | undefined>(undefined)

export function AppConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(() => readCache()?.config ?? DEFAULT_APP_CONFIG)
  const [orgStructure, setOrgStructure] = useState<OrgStructure>(
    () => readOrgCache()?.org ?? DEFAULT_ORG_STRUCTURE,
  )
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

  const refreshOrg = useCallback(async () => {
    const snap = await getDoc(doc(db, 'config', 'orgStructure'))
    if (snap.exists()) {
      const next = snap.data() as OrgStructure
      setOrgStructure(next)
      writeOrgCache(next)
    } else {
      writeOrgCache(DEFAULT_ORG_STRUCTURE)
    }
  }, [])

  // Boot: refresh both docs if their respective caches are missing or stale.
  useEffect(() => {
    const cached = readCache()
    if (!cached || Date.now() - cached.fetchedAt > TTL_MS) {
      void refresh()
    }
    const cachedOrg = readOrgCache()
    if (!cachedOrg || Date.now() - cachedOrg.fetchedAt > TTL_MS) {
      void refreshOrg()
    }
  }, [refresh, refreshOrg])

  // Cross-tab sync: handle both keys in one listener. The admin tab writes
  // the cache after a save; every other open tab catches the storage event
  // and updates its own state without making a Firestore read.
  useEffect(() => {
    if (typeof window === 'undefined') return
    function handler(e: StorageEvent) {
      if (!e.newValue) return
      if (e.key === STORAGE_KEY) {
        const cached = readCache()
        if (cached) setConfig(cached.config)
      } else if (e.key === ORG_STORAGE_KEY) {
        const cachedOrg = readOrgCache()
        if (cachedOrg) setOrgStructure(cachedOrg.org)
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  const setConfigOptimistic = useCallback((next: AppConfig) => {
    setConfig(next)
    writeCache(next)
  }, [])

  const setOrgStructureOptimistic = useCallback((next: OrgStructure) => {
    setOrgStructure(next)
    writeOrgCache(next)
  }, [])

  const value = useMemo<AppConfigContextValue>(
    () => ({
      config,
      orgStructure,
      refreshing,
      refresh,
      refreshOrg,
      setConfigOptimistic,
      setOrgStructureOptimistic,
    }),
    [config, orgStructure, refreshing, refresh, refreshOrg, setConfigOptimistic, setOrgStructureOptimistic],
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

// ─── Org structure hooks ──────────────────────────────────────────────────

export function useOrgStructure(): OrgStructure {
  return useAppConfigContext().orgStructure
}

export function useLeadRoleName(): string {
  return useAppConfigContext().orgStructure.leadRoleName
}

export function useHasCoordinator(): boolean {
  return useAppConfigContext().orgStructure.teamRoles.hasCoordinator
}

export function useHasValidator(): boolean {
  return useAppConfigContext().orgStructure.teamRoles.hasValidator
}

export function useHasSpecialist(): boolean {
  return useAppConfigContext().orgStructure.teamRoles.hasSpecialist
}

export function useWorkTypes(): string[] {
  return useAppConfigContext().orgStructure.workTypes
}

export function useSetupCompleted(): boolean {
  return useAppConfigContext().orgStructure.setupCompleted
}

// Live-onSnapshot variant of useOrgStructure for the admin screen only.
// Mounts a listener so multi-editor edits propagate in realtime.
export function useOrgStructureLive(): { org: OrgStructure | null; loading: boolean } {
  const [org, setOrg] = useState<OrgStructure | null>(null)
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    return onSnapshot(doc(db, 'config', 'orgStructure'), (snap) => {
      if (snap.exists()) {
        setOrg(snap.data() as OrgStructure)
      } else {
        setOrg(null)
      }
      setLoading(false)
    })
  }, [])

  return { org, loading }
}

// ─── Workflow cache (Phase 2a) ────────────────────────────────────────────
// Per-workflow cache keyed by id. localStorage key: workflow:{id}:v1.
// Same 24h TTL as appConfig/orgStructure. The "active" workflow id is derived
// from appConfig.pipeline.enabled: enabled → 'collab-default', else → 'basic'.

export const COLLAB_DEFAULT_WORKFLOW_ID = 'collab-default'
export const BASIC_WORKFLOW_ID = 'basic'

function workflowStorageKey(id: string): string {
  return `workflow:${id}:v1`
}

interface SerializedWorkflow extends Omit<Workflow, 'updatedAt'> {
  updatedAt: SerializedTimestamp
}

function serializeWorkflow(w: Workflow): SerializedWorkflow {
  return {
    ...w,
    updatedAt: { seconds: w.updatedAt.seconds, nanoseconds: w.updatedAt.nanoseconds },
  }
}

function hydrateWorkflow(s: SerializedWorkflow): Workflow {
  return {
    ...s,
    updatedAt: new Timestamp(s.updatedAt.seconds, s.updatedAt.nanoseconds),
  }
}

interface CachedWorkflowEntry {
  workflow: Workflow
  fetchedAt: number
}

function readWorkflowCache(id: string): CachedWorkflowEntry | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(workflowStorageKey(id))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { workflow: SerializedWorkflow; fetchedAt: number }
    if (!parsed?.workflow || typeof parsed.fetchedAt !== 'number') return null
    return { workflow: hydrateWorkflow(parsed.workflow), fetchedAt: parsed.fetchedAt }
  } catch {
    return null
  }
}

function writeWorkflowCache(w: Workflow) {
  if (typeof window === 'undefined') return
  try {
    const payload = { workflow: serializeWorkflow(w), fetchedAt: Date.now() }
    window.localStorage.setItem(workflowStorageKey(w.id), JSON.stringify(payload))
  } catch {
    // ignore quota / private-mode errors
  }
}

// The "active" workflow id, derived from pipelineEnabled. Centralised so the
// snapshot reader and the React hook agree.
export function getActiveWorkflowId(): string {
  return getAppConfigSnapshot().pipeline.enabled
    ? COLLAB_DEFAULT_WORKFLOW_ID
    : BASIC_WORKFLOW_ID
}

// Non-React snapshot. Returns null when the workflow doc hasn't been seeded
// yet (or the cache hasn't been populated). Callers in lib/ should handle null
// by falling back to legacy behaviour during the Sprint 2 transition.
export function getActiveWorkflowSnapshot(): Workflow | null {
  return readWorkflowCache(getActiveWorkflowId())?.workflow ?? null
}

export function getWorkflowSnapshot(workflowId: string): Workflow | null {
  return readWorkflowCache(workflowId)?.workflow ?? null
}

// Hook: returns the active workflow, fetching it on mount if the cache is
// missing or stale. Re-fetches when `pipelineEnabled` flips (which swaps the
// active id between collab-default and basic).
export function useActiveWorkflow(): {
  workflow: Workflow | null
  loading: boolean
  refresh: () => Promise<void>
} {
  const pipelineEnabled = usePipelineEnabled()
  const activeId = pipelineEnabled ? COLLAB_DEFAULT_WORKFLOW_ID : BASIC_WORKFLOW_ID
  const [workflow, setWorkflow] = useState<Workflow | null>(
    () => readWorkflowCache(activeId)?.workflow ?? null,
  )
  const [loading, setLoading] = useState<boolean>(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const snap = await getDoc(doc(db, 'workflows', activeId))
      if (snap.exists()) {
        const next = snap.data() as Workflow
        // Ensure id matches doc id even if the doc has it wrong.
        const normalised: Workflow = { ...next, id: activeId }
        setWorkflow(normalised)
        writeWorkflowCache(normalised)
      } else {
        setWorkflow(null)
      }
    } finally {
      setLoading(false)
    }
  }, [activeId])

  // Boot / id-change: refresh if cache for this id is missing or stale.
  useEffect(() => {
    const cached = readWorkflowCache(activeId)
    if (!cached || Date.now() - cached.fetchedAt > TTL_MS) {
      void refresh()
    } else {
      setWorkflow(cached.workflow)
    }
  }, [activeId, refresh])

  // Cross-tab sync: when another tab writes the workflow cache (e.g. after a
  // seed run), pick up the new value without a round-trip to Firestore.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const key = workflowStorageKey(activeId)
    function handler(e: StorageEvent) {
      if (e.key !== key || !e.newValue) return
      const cached = readWorkflowCache(activeId)
      if (cached) setWorkflow(cached.workflow)
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [activeId])

  return { workflow, loading, refresh }
}
