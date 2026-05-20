import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { collection, doc, getDoc, getDocs, onSnapshot, Timestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { AppConfig, OrgStructure } from '../types/models'
import { DEFAULT_ORG_STRUCTURE } from '../types/models'
import type { Workflow, WorkflowRegistry } from '../types/workflow'
import { WORKFLOW_REGISTRY_ID } from '../types/workflow'

const STORAGE_KEY = 'appConfig:v1'
const ORG_STORAGE_KEY = 'orgStructure:v1'
const REGISTRY_STORAGE_KEY = 'workflowRegistry:v1'
const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

// Default config — used when no Firestore doc exists yet AND no localStorage
// snapshot has been captured.
export const DEFAULT_APP_CONFIG: AppConfig = {
  version: 0,
  updatedAt: Timestamp.fromMillis(0),
  updatedBy: '',
  features: {
    chat: false,
  },
}

// Phase 2b: every tenant has the `basic` workflow implicitly available. When
// the registry doc is missing (fresh tenant, brand-new env), this shape is
// what callers see — the new-project form auto-pins basic, the dashboard
// shows a single basic tab, no picker is rendered.
export const COLLAB_DEFAULT_WORKFLOW_ID = 'collab-default'
export const BASIC_WORKFLOW_ID = 'basic'

export const DEFAULT_WORKFLOW_REGISTRY: WorkflowRegistry = {
  version: 0,
  updatedAt: Timestamp.fromMillis(0),
  updatedBy: '',
  activeWorkflowIds: [BASIC_WORKFLOW_ID],
  defaultWorkflowId: BASIC_WORKFLOW_ID,
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
// e.g. lib/firestore.ts addProject() needs the cached config without threading
// it through every call site.
export function getAppConfigSnapshot(): AppConfig {
  const cached = readCache()
  return cached?.config ?? DEFAULT_APP_CONFIG
}

// ─── Org structure: parallel cache, independent storage key ───────────────

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

// ─── Workflow registry cache ──────────────────────────────────────────────
// Phase 2b: singleton at /workflows/_registry. Same 24h localStorage TTL +
// cross-tab StorageEvent sync pattern as appConfig / orgStructure. When the
// doc is missing, callers get DEFAULT_WORKFLOW_REGISTRY (basic-only).

interface CachedRegistryEntry {
  registry: WorkflowRegistry
  fetchedAt: number
}

interface SerializedRegistry extends Omit<WorkflowRegistry, 'updatedAt'> {
  updatedAt: SerializedTimestamp
}

function serializeRegistry(r: WorkflowRegistry): SerializedRegistry {
  return {
    ...r,
    updatedAt: { seconds: r.updatedAt.seconds, nanoseconds: r.updatedAt.nanoseconds },
  }
}

function hydrateRegistry(s: SerializedRegistry): WorkflowRegistry {
  return {
    ...s,
    updatedAt: new Timestamp(s.updatedAt.seconds, s.updatedAt.nanoseconds),
  }
}

function readRegistryCache(): CachedRegistryEntry | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(REGISTRY_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { registry: SerializedRegistry; fetchedAt: number }
    if (!parsed?.registry || typeof parsed.fetchedAt !== 'number') return null
    return { registry: hydrateRegistry(parsed.registry), fetchedAt: parsed.fetchedAt }
  } catch {
    return null
  }
}

function writeRegistryCache(r: WorkflowRegistry) {
  if (typeof window === 'undefined') return
  try {
    const payload = { registry: serializeRegistry(r), fetchedAt: Date.now() }
    window.localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // ignore quota / private-mode errors
  }
}

export function getWorkflowRegistrySnapshot(): WorkflowRegistry {
  const cached = readRegistryCache()
  return cached?.registry ?? DEFAULT_WORKFLOW_REGISTRY
}

// ─── Per-workflow cache ───────────────────────────────────────────────────
// Each workflow doc cached under its own localStorage key with the same TTL.
// Phase 2b populates the in-memory map eagerly for active workflows at boot,
// and lazily for inactive workflows referenced by historical projects.

function workflowStorageKey(id: string): string {
  return `workflow:${id}:v1`
}

interface SerializedWorkflow extends Omit<Workflow, 'updatedAt' | 'lastEditedAt'> {
  updatedAt: SerializedTimestamp
  // Phase 2c added lastEditedAt as an optional Timestamp on Workflow. It needs
  // the same serialize/hydrate dance as updatedAt, or readers get a plain
  // {seconds, nanoseconds} object with no `.toDate()` method.
  lastEditedAt?: SerializedTimestamp
}

function serializeWorkflow(w: Workflow): SerializedWorkflow {
  return {
    ...w,
    updatedAt: { seconds: w.updatedAt.seconds, nanoseconds: w.updatedAt.nanoseconds },
    ...(w.lastEditedAt
      ? {
          lastEditedAt: {
            seconds: w.lastEditedAt.seconds,
            nanoseconds: w.lastEditedAt.nanoseconds,
          },
        }
      : {}),
  }
}

function hydrateWorkflow(s: SerializedWorkflow): Workflow {
  // Pull the serialized timestamps off explicitly so the spread doesn't carry
  // their incompatible types into the Workflow shape.
  const { updatedAt: rawUpdatedAt, lastEditedAt: rawLastEditedAt, ...rest } = s
  return {
    ...rest,
    updatedAt: new Timestamp(rawUpdatedAt.seconds, rawUpdatedAt.nanoseconds),
    ...(rawLastEditedAt
      ? {
          lastEditedAt: new Timestamp(
            rawLastEditedAt.seconds,
            rawLastEditedAt.nanoseconds,
          ),
        }
      : {}),
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

// Non-React snapshot for lib/ code (firestore.ts addProject, workflowEvaluator
// runs outside React). Returns null when the doc isn't cached yet.
export function getWorkflowSnapshot(workflowId: string): Workflow | null {
  return readWorkflowCache(workflowId)?.workflow ?? null
}

// ─── Context ──────────────────────────────────────────────────────────────

interface AppConfigContextValue {
  config: AppConfig
  orgStructure: OrgStructure
  workflowRegistry: WorkflowRegistry
  // Loaded workflows keyed by id. Populated eagerly for active workflows at
  // boot; populated lazily for inactive workflows when a caller asks via
  // useWorkflow(id). Lookups are O(1) once present.
  workflowsById: Record<string, Workflow>
  // True while the initial Firestore refresh is in flight. UI doesn't need
  // to wait — the cached / default value is rendered synchronously.
  refreshing: boolean
  refresh: () => Promise<void>
  refreshOrg: () => Promise<void>
  refreshRegistry: () => Promise<void>
  refreshWorkflow: (id: string) => Promise<Workflow | null>
  // Lazy-fetch helper. Returns the workflow from the map if present, otherwise
  // kicks off a fetch and caches both in localStorage and the in-memory map.
  ensureWorkflow: (id: string) => Promise<Workflow | null>
  // One-shot scan of /workflows/ that pulls every doc into the in-memory
  // map regardless of whether it's in the registry. Admin-only surfaces
  // (WorkflowsSection) call this on mount so seeded-but-inactive workflows
  // appear in the activation list.
  discoverWorkflows: () => Promise<void>
  setConfigOptimistic: (next: AppConfig) => void
  setOrgStructureOptimistic: (next: OrgStructure) => void
  setRegistryOptimistic: (next: WorkflowRegistry) => void
  setWorkflowOptimistic: (next: Workflow) => void
}

const AppConfigContext = createContext<AppConfigContextValue | undefined>(undefined)

export function AppConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(() => readCache()?.config ?? DEFAULT_APP_CONFIG)
  const [orgStructure, setOrgStructure] = useState<OrgStructure>(
    () => readOrgCache()?.org ?? DEFAULT_ORG_STRUCTURE,
  )
  const [workflowRegistry, setWorkflowRegistry] = useState<WorkflowRegistry>(
    () => readRegistryCache()?.registry ?? DEFAULT_WORKFLOW_REGISTRY,
  )
  // Seed the in-memory map from localStorage so caches survive a reload.
  // Each active workflow doc lives in its own localStorage key.
  const [workflowsById, setWorkflowsById] = useState<Record<string, Workflow>>(() => {
    const seed: Record<string, Workflow> = {}
    const registry = readRegistryCache()?.registry ?? DEFAULT_WORKFLOW_REGISTRY
    for (const id of registry.activeWorkflowIds) {
      const cached = readWorkflowCache(id)
      if (cached) seed[id] = cached.workflow
    }
    return seed
  })
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

  // Fetch a single workflow doc, normalise id from doc path so the in-memory
  // shape always matches the storage key, and write through both caches.
  const refreshWorkflow = useCallback(async (id: string): Promise<Workflow | null> => {
    const snap = await getDoc(doc(db, 'workflows', id))
    if (!snap.exists()) return null
    const data = snap.data() as Workflow
    const normalised: Workflow = { ...data, id }
    writeWorkflowCache(normalised)
    setWorkflowsById((prev) => ({ ...prev, [id]: normalised }))
    return normalised
  }, [])

  // Fetch the registry doc + every active workflow in parallel. Default to the
  // basic-only registry when no doc exists so a fresh tenant still gets a
  // usable system.
  const refreshRegistry = useCallback(async () => {
    const snap = await getDoc(doc(db, 'workflows', WORKFLOW_REGISTRY_ID))
    let next: WorkflowRegistry
    if (snap.exists()) {
      next = snap.data() as WorkflowRegistry
    } else {
      next = DEFAULT_WORKFLOW_REGISTRY
    }
    setWorkflowRegistry(next)
    writeRegistryCache(next)
    // Eager-load every active workflow.
    await Promise.all(next.activeWorkflowIds.map((id) => refreshWorkflow(id).catch(() => null)))
  }, [refreshWorkflow])

  const ensureWorkflow = useCallback(
    async (id: string): Promise<Workflow | null> => {
      if (workflowsById[id]) return workflowsById[id]
      const cached = readWorkflowCache(id)?.workflow
      if (cached) {
        setWorkflowsById((prev) => (prev[id] ? prev : { ...prev, [id]: cached }))
        return cached
      }
      return refreshWorkflow(id)
    },
    [workflowsById, refreshWorkflow],
  )

  // One-shot scan of /workflows/. Pulls every doc (other than the registry
  // sentinel) into the in-memory map so admin surfaces can see seeded-but-
  // inactive workflows without waiting for a registry toggle.
  const discoverWorkflows = useCallback(async () => {
    const snap = await getDocs(collection(db, 'workflows'))
    await Promise.all(
      snap.docs
        .filter((d) => d.id !== WORKFLOW_REGISTRY_ID)
        .map((d) => refreshWorkflow(d.id).catch(() => null)),
    )
  }, [refreshWorkflow])

  // Boot: refresh every doc whose cache is missing or stale. Run in parallel
  // so the UI's first render isn't blocked by a single slow doc.
  useEffect(() => {
    const cached = readCache()
    if (!cached || Date.now() - cached.fetchedAt > TTL_MS) {
      void refresh()
    }
    const cachedOrg = readOrgCache()
    if (!cachedOrg || Date.now() - cachedOrg.fetchedAt > TTL_MS) {
      void refreshOrg()
    }
    const cachedRegistry = readRegistryCache()
    if (!cachedRegistry || Date.now() - cachedRegistry.fetchedAt > TTL_MS) {
      void refreshRegistry()
    } else {
      // Even if the registry cache is fresh, individual workflow caches may
      // be stale or missing — refresh each in the background.
      for (const id of cachedRegistry.registry.activeWorkflowIds) {
        const wfCache = readWorkflowCache(id)
        if (!wfCache || Date.now() - wfCache.fetchedAt > TTL_MS) {
          void refreshWorkflow(id)
        }
      }
    }
  }, [refresh, refreshOrg, refreshRegistry, refreshWorkflow])

  // Cross-tab sync. One listener handles every cache: storage events fire on
  // peer tabs when this tab writes through its optimistic setter.
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
      } else if (e.key === REGISTRY_STORAGE_KEY) {
        const cachedRegistry = readRegistryCache()
        if (cachedRegistry) setWorkflowRegistry(cachedRegistry.registry)
      } else if (e.key && e.key.startsWith('workflow:') && e.key.endsWith(':v1')) {
        const id = e.key.slice('workflow:'.length, -':v1'.length)
        if (id && id !== WORKFLOW_REGISTRY_ID) {
          const cached = readWorkflowCache(id)
          if (cached) setWorkflowsById((prev) => ({ ...prev, [id]: cached.workflow }))
        }
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

  const setRegistryOptimistic = useCallback((next: WorkflowRegistry) => {
    setWorkflowRegistry(next)
    writeRegistryCache(next)
  }, [])

  const setWorkflowOptimistic = useCallback((next: Workflow) => {
    writeWorkflowCache(next)
    setWorkflowsById((prev) => ({ ...prev, [next.id]: next }))
  }, [])

  const value = useMemo<AppConfigContextValue>(
    () => ({
      config,
      orgStructure,
      workflowRegistry,
      workflowsById,
      refreshing,
      refresh,
      refreshOrg,
      refreshRegistry,
      refreshWorkflow,
      ensureWorkflow,
      discoverWorkflows,
      setConfigOptimistic,
      setOrgStructureOptimistic,
      setRegistryOptimistic,
      setWorkflowOptimistic,
    }),
    [
      config,
      orgStructure,
      workflowRegistry,
      workflowsById,
      refreshing,
      refresh,
      refreshOrg,
      refreshRegistry,
      refreshWorkflow,
      ensureWorkflow,
      discoverWorkflows,
      setConfigOptimistic,
      setOrgStructureOptimistic,
      setRegistryOptimistic,
      setWorkflowOptimistic,
    ],
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

export function useChatEnabled(): boolean {
  return useAppConfigContext().config.features.chat
}

// Live-onSnapshot variant for the admin screen ONLY. Mounts a listener while
// the screen is open so multi-editor edits show up in realtime.
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

// ─── Workflow registry + workflow hooks (Phase 2b) ────────────────────────

export function useWorkflowRegistry(): WorkflowRegistry {
  return useAppConfigContext().workflowRegistry
}

// All workflows in `registry.activeWorkflowIds`, in registry order. Filters
// out ids whose docs haven't loaded yet so callers can iterate safely.
export function useActiveWorkflows(): { workflows: Workflow[]; loading: boolean } {
  const { workflowRegistry, workflowsById, refreshing } = useAppConfigContext()
  const workflows = useMemo(() => {
    const out: Workflow[] = []
    for (const id of workflowRegistry.activeWorkflowIds) {
      const wf = workflowsById[id]
      if (wf) out.push(wf)
    }
    return out
  }, [workflowRegistry, workflowsById])
  // Loading when the registry expects a workflow we haven't loaded yet.
  const allLoaded = workflowRegistry.activeWorkflowIds.every((id) => workflowsById[id])
  return { workflows, loading: refreshing || !allLoaded }
}

// The workflow set as `defaultWorkflowId`, falling back to the first active
// workflow when default is null. Returns null when no workflow is loaded yet.
export function useDefaultWorkflow(): Workflow | null {
  const { workflowRegistry, workflowsById } = useAppConfigContext()
  const id =
    workflowRegistry.defaultWorkflowId ?? workflowRegistry.activeWorkflowIds[0] ?? null
  return id ? (workflowsById[id] ?? null) : null
}

// Resolve a workflow by id. Returns the loaded doc when present, otherwise
// kicks off a lazy fetch and returns null until it resolves. Use for projects
// pinned to inactive (but seeded) workflows — the active set is preloaded at
// boot so callers on active projects get a non-null return immediately.
export function useWorkflow(workflowId: string | null | undefined): Workflow | null {
  const { workflowsById, ensureWorkflow } = useAppConfigContext()
  const cached = workflowId ? workflowsById[workflowId] : null

  useEffect(() => {
    if (!workflowId) return
    if (workflowsById[workflowId]) return
    void ensureWorkflow(workflowId)
  }, [workflowId, workflowsById, ensureWorkflow])

  return cached ?? null
}

// Phase 2c: resolve the workflow a project should render against. Prefers the
// snapshot pinned at creation (workflow edits never affect in-flight projects)
// and falls back to a live lookup for legacy projects that pre-date the
// snapshot-pin migration. Once the dev backfill (lib/migratePinnedWorkflow.ts)
// has been run across all tenants, the fallback path is dead code — keep it
// during the rollout window so unbackfilled projects still render.
export function useProjectWorkflow(
  project: { workflowId?: string; pinnedWorkflow?: Workflow } | null | undefined,
): Workflow | null {
  const liveWorkflow = useWorkflow(project?.pinnedWorkflow ? null : project?.workflowId)
  if (project?.pinnedWorkflow) return project.pinnedWorkflow
  return liveWorkflow
}

// Derived label for project-creation CTAs. Reads the default workflow's
// displayName so a Sales tenant sees "New Sales Project" and a Tender tenant
// sees "New Tender". When no default is set yet, falls back to "New Project".
export function useCreateProjectLabel(): string {
  const defaultWorkflow = useDefaultWorkflow()
  if (!defaultWorkflow) return 'New Project'
  return `New ${defaultWorkflow.displayName}`
}
