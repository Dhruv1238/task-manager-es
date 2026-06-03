import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Timestamp } from 'firebase/firestore'
import { ReactFlowProvider } from '@xyflow/react'
import { ArrowLeft, FilePlus2, Layers, ShoppingBag, Upload, Users } from 'lucide-react'
import './../components/authoring/canvas/canvas.css'
import { FlowCanvas } from '../components/authoring/canvas/FlowCanvas'
import { CanvasToolbar } from '../components/authoring/canvas/CanvasToolbar'
import { NodeInspector } from '../components/authoring/canvas/NodeInspector'
import { WorkflowSettingsDrawer } from '../components/authoring/canvas/WorkflowSettingsDrawer'
import { ValidationSummary } from '../components/authoring/canvas/ValidationSummary'
import { autoLayout, deriveCanvasEdges } from '../components/authoring/canvas/autoLayout'
import { useAuth } from '../contexts/AuthContext'
import { useWorkflow, useOrgStructure, useAppConfigContext } from '../contexts/AppConfigContext'
import {
  cloneTemplate,
  duplicateSystemWorkflow,
  emptyDraft,
  saveWorkflowAndMaybeActivate,
  type WorkflowDraft,
} from '../lib/workflowAuthoring'
import { validateFlowForPublish } from '../lib/flowValidation'
import { downloadJson, parseWorkflowImport, serializeWorkflow } from '../lib/configTransfer'
import { slugifyWorkflowId } from '../lib/workflowAuthoring'
import { readOutcomes } from '../lib/rules/outcomeAdapter'
import type { Stage, Workflow } from '../types/workflow'
import type { CanvasLayout } from '../types/v2'

function freshTaskId(): string {
  return `task-${Date.now().toString(36)}`
}

// Turn an authoring Draft (no server-stamped fields) into a Workflow-shaped
// object for local canvas state. The real id is derived from displayName on
// publish (workflowId left undefined for new flows).
function draftToWorkflow(draft: WorkflowDraft): Workflow {
  return {
    ...draft,
    id: draft.id ?? '__draft__',
    version: 1,
    updatedAt: Timestamp.now(),
    updatedBy: '',
  }
}

type TemplateChoice = 'blank' | 'basic' | 'sales-default' | 'collab-default'

export default function FlowAuthoring() {
  const { id } = useParams<{ id: string }>()
  const [search] = useSearchParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const org = useOrgStructure()
  const { setWorkflowOptimistic, setRegistryOptimistic } = useAppConfigContext()

  // No :id param (the /admin/workflows/new route) → new-flow creation mode.
  const isNew = !id
  const loaded = useWorkflow(isNew ? undefined : id)

  const [wf, setWf] = useState<Workflow | null>(null)
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Bumped whenever the graph is (re)laid-out so the canvas reframes the view.
  const [fitSignal, setFitSignal] = useState(0)

  // Build a new draft from a chosen template / blank, then auto-lay-out.
  const startFrom = useCallback(async (choice: TemplateChoice) => {
    const draft = choice === 'blank' ? emptyDraft('Untitled flow') : cloneTemplate(choice)
    const base = draftToWorkflow(draft)
    const nodes = await autoLayout(base.stages)
    setWf({ ...base, displayName: choice === 'blank' ? '' : base.displayName, canvasLayout: { nodes, edges: deriveCanvasEdges(base.stages) } })
    setFitSignal((n) => n + 1)
  }, [])

  // Edit mode: seed local draft from the loaded workflow; auto-lay-out legacy flows.
  useEffect(() => {
    if (isNew || !loaded || wf) return
    let cancelled = false
    ;(async () => {
      let layout: CanvasLayout | undefined = loaded.canvasLayout
      if (!layout) {
        const nodes = await autoLayout(loaded.stages)
        layout = { nodes, edges: deriveCanvasEdges(loaded.stages) }
      }
      if (!cancelled) {
        setWf({ ...loaded, canvasLayout: layout })
        setFitSignal((n) => n + 1)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isNew, loaded, wf])

  // New mode: auto-seed from ?template= when provided (e.g. deep links).
  useEffect(() => {
    if (!isNew || wf) return
    const t = search.get('template') as TemplateChoice | null
    if (t && ['basic', 'sales-default', 'collab-default'].includes(t)) void startFrom(t)
  }, [isNew, wf, search, startFrom])

  const roles = useMemo(() => org.roleHierarchy ?? [], [org.roleHierarchy])
  const validation = useMemo(
    () =>
      wf
        ? validateFlowForPublish(wf, org, roles)
        : { errors: [], warnings: [], nodeValidity: {}, nodeReason: {}, publishable: false },
    [wf, org, roles],
  )

  const readOnly = Boolean(wf?.isSystemDefined) && !isNew

  const updateStage = useCallback((stage: Stage) => {
    setWf((prev) =>
      prev ? { ...prev, stages: prev.stages.map((s) => (s.id === stage.id ? stage : s)) } : prev,
    )
  }, [])

  const moveNode = useCallback((stageId: string, x: number, y: number) => {
    setWf((prev) => {
      if (!prev) return prev
      const nodes = (prev.canvasLayout?.nodes ?? []).filter((n) => n.taskId !== stageId)
      nodes.push({ taskId: stageId, x, y })
      return { ...prev, canvasLayout: { nodes, edges: prev.canvasLayout?.edges ?? [] } }
    })
  }, [])

  const connectOutcome = useCallback((fromStageId: string, outcomeId: string, toStageId: string) => {
    setWf((prev) => {
      if (!prev) return prev
      const stages = prev.stages.map((s) => {
        if (s.id !== fromStageId) return s
        const actions = s.actions.map((a) => {
          const outs = readOutcomes(a)
          if (!outs.some((o) => o.id === outcomeId)) return a
          return { ...a, outcomes: outs.map((o) => (o.id === outcomeId ? { ...o, toStageId } : o)) }
        })
        return { ...s, actions }
      })
      return { ...prev, stages, canvasLayout: { nodes: prev.canvasLayout?.nodes ?? [], edges: deriveCanvasEdges(stages) } }
    })
  }, [])

  const addTask = useCallback((terminal: boolean) => {
    setWf((prev) => {
      if (!prev) return prev
      const order = Math.max(0, ...prev.stages.map((s) => s.order)) + 1
      const stage: Stage = {
        id: freshTaskId(),
        displayName: terminal ? 'New ending' : 'New task',
        order,
        isTerminal: terminal,
        actions: [],
      }
      const nodes = [...(prev.canvasLayout?.nodes ?? []), { taskId: stage.id, x: 80, y: 80 + order * 40 }]
      return { ...prev, stages: [...prev.stages, stage], canvasLayout: { nodes, edges: prev.canvasLayout?.edges ?? [] } }
    })
  }, [])

  const handleAutoLayout = useCallback(async () => {
    if (!wf) return
    const nodes = await autoLayout(wf.stages)
    setWf((prev) => (prev ? { ...prev, canvasLayout: { nodes, edges: deriveCanvasEdges(prev.stages) } } : prev))
    setFitSignal((n) => n + 1)
  }, [wf])

  // Remove a task: drop it, clear any outcomes that pointed at it, and re-derive
  // edges + the entry pointer.
  const deleteStage = useCallback((stageId: string) => {
    setWf((prev) => {
      if (!prev) return prev
      const stages = prev.stages
        .filter((s) => s.id !== stageId)
        .map((s) => {
          const actions = s.actions.map((a) => {
            const outs = readOutcomes(a)
            if (!outs.some((o) => o.toStageId === stageId)) return a
            return { ...a, outcomes: outs.map((o) => (o.toStageId === stageId ? { ...o, toStageId: undefined } : o)) }
          })
          return { ...s, actions }
        })
      const nodes = (prev.canvasLayout?.nodes ?? []).filter((n) => n.taskId !== stageId)
      return {
        ...prev,
        entryStageId: prev.entryStageId === stageId ? undefined : prev.entryStageId,
        stages,
        canvasLayout: { nodes, edges: deriveCanvasEdges(stages) },
      }
    })
    setSelectedStageId((sel) => (sel === stageId ? null : sel))
  }, [])

  // Clear a single outcome's target (the × on an edge or Delete on a selected edge).
  const disconnectOutcome = useCallback((fromStageId: string, outcomeId: string) => {
    setWf((prev) => {
      if (!prev) return prev
      const stages = prev.stages.map((s) => {
        if (s.id !== fromStageId) return s
        const actions = s.actions.map((a) => {
          const outs = readOutcomes(a)
          if (!outs.some((o) => o.id === outcomeId)) return a
          return { ...a, outcomes: outs.map((o) => (o.id === outcomeId ? { ...o, toStageId: undefined } : o)) }
        })
        return { ...s, actions }
      })
      return { ...prev, stages, canvasLayout: { nodes: prev.canvasLayout?.nodes ?? [], edges: deriveCanvasEdges(stages) } }
    })
  }, [])

  const handleDuplicate = useCallback(async () => {
    if (!wf || !user) return
    setPublishing(true)
    try {
      const res = await duplicateSystemWorkflow(wf, user.uid)
      setWorkflowOptimistic(res.workflow)
      navigate(`/admin/flow/${res.workflowId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not duplicate the flow.')
    } finally {
      setPublishing(false)
    }
  }, [wf, user, setWorkflowOptimistic, navigate])

  const handlePublish = useCallback(async () => {
    if (!wf || !user || !validation.publishable) return
    setPublishing(true)
    setError(null)
    try {
      const res = await saveWorkflowAndMaybeActivate({
        draft: { ...wf, canvasLayout: { nodes: wf.canvasLayout?.nodes ?? [], edges: deriveCanvasEdges(wf.stages) } },
        adminUid: user.uid,
        activate: true,
        // New flows derive their id from displayName; edits keep the existing id.
        workflowId: isNew ? undefined : wf.id,
      })
      setWorkflowOptimistic(res.workflow)
      if (res.registry) setRegistryOptimistic(res.registry)
      navigate('/admin/config')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not publish the flow.')
    } finally {
      setPublishing(false)
    }
  }, [wf, user, validation.publishable, isNew, setWorkflowOptimistic, setRegistryOptimistic, navigate])

  // Download the current flow as a single-workflow JSON export.
  const handleExport = useCallback(() => {
    if (!wf) return
    const envelope = serializeWorkflow(wf, Date.now())
    console.log('[workflowExport]', envelope)
    const slug =
      wf.id && wf.id !== '__draft__' && wf.id !== '__imported__'
        ? wf.id
        : slugifyWorkflowId(wf.displayName || 'workflow')
    downloadJson(`workflow-${slug}.json`, envelope)
  }, [wf])

  // Load a workflow JSON onto the canvas (into the draft — review then Publish).
  // Never writes Firestore directly; publishing runs the normal validated path.
  const handleImport = useCallback(
    (file: File) => {
      const reader = new FileReader()
      reader.onload = () => {
        void (async () => {
          try {
            const parsed = parseWorkflowImport(typeof reader.result === 'string' ? reader.result : '')
            const imported: Workflow = {
              ...parsed,
              // New-flow route: fresh draft (publish derives an id from the name);
              // edit route: keep the current id so publish updates this flow.
              id: isNew ? '__draft__' : wf?.id ?? parsed.id,
              isSystemDefined: isNew ? false : wf?.isSystemDefined ?? false,
            }
            let layout = imported.canvasLayout
            if (!layout) {
              const nodes = await autoLayout(imported.stages)
              layout = { nodes, edges: deriveCanvasEdges(imported.stages) }
            }
            setWf({ ...imported, canvasLayout: layout })
            setSelectedStageId(null)
            setError(null)
            setFitSignal((n) => n + 1)
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not import that workflow file.')
          }
        })()
      }
      reader.onerror = () => setError('Could not read that file.')
      reader.readAsText(file)
    },
    [isNew, wf],
  )

  // New mode, nothing chosen yet → the template chooser.
  if (isNew && !wf) {
    return (
      <TemplateChooser
        onPick={startFrom}
        onImportFile={handleImport}
        onCancel={() => navigate('/admin/config')}
      />
    )
  }

  if (!wf) {
    return <div className="flex h-[70vh] items-center justify-center text-sm text-fg-subtle">Loading flow…</div>
  }

  const flowTypeLabel = `${wf.flowType} flow · ${wf.stages.length} task${wf.stages.length === 1 ? '' : 's'}${
    readOnly ? ' · read-only (system flow)' : ''
  }`

  return (
    <ReactFlowProvider>
      <div className="fixed inset-0 top-16 flex flex-col">
        {error && (
          <div className="absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-lg pill-danger border px-3 py-1.5 text-xs">
            {error}
          </div>
        )}
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="absolute left-4 top-20 z-30 hidden items-center gap-1 rounded-md border border-line bg-fill-2 px-2 py-1 text-xs text-fg-muted transition hover:text-fg lg:inline-flex"
        >
          <ArrowLeft size={13} /> Back
        </button>

        <div className="relative flex-1">
          <FlowCanvas
            workflow={wf}
            validation={validation}
            selectedStageId={selectedStageId}
            leadRoleName={wf.leadRoleName || org.leadRoleName}
            fitSignal={fitSignal}
            onSelectStage={setSelectedStageId}
            onMoveNode={moveNode}
            onConnectOutcome={connectOutcome}
            onDeleteStage={deleteStage}
            onDisconnectOutcome={disconnectOutcome}
            readOnly={readOnly}
          />
          <CanvasToolbar
            flowName={wf.displayName}
            flowTypeLabel={flowTypeLabel}
            validation={validation}
            publishing={publishing}
            readOnly={readOnly}
            isNew={isNew}
            onAutoLayout={handleAutoLayout}
            onAddTask={() => addTask(false)}
            onAddTerminal={() => addTask(true)}
            onPublish={handlePublish}
            onRenameFlow={readOnly ? undefined : (name) => setWf((p) => (p ? { ...p, displayName: name } : p))}
            onDuplicate={readOnly ? handleDuplicate : undefined}
            onOpenSettings={readOnly ? undefined : () => setSettingsOpen(true)}
            onExport={handleExport}
            onImport={readOnly ? undefined : handleImport}
          />
          <ValidationSummary validation={validation} onJump={setSelectedStageId} />
          <NodeInspector
            workflow={wf}
            stageId={selectedStageId}
            roles={roles}
            org={org}
            leadRoleName={wf.leadRoleName || org.leadRoleName}
            onChangeStage={updateStage}
            onDeleteStage={deleteStage}
            onChangeWorkflowMeta={readOnly ? undefined : (patch) => setWf((p) => (p ? { ...p, ...patch } : p))}
            onClose={() => setSelectedStageId(null)}
            readOnly={readOnly}
          />
          <WorkflowSettingsDrawer
            open={settingsOpen}
            workflow={wf}
            leadRoleName={wf.leadRoleName || org.leadRoleName}
            disabled={readOnly}
            onChange={(patch) => setWf((p) => (p ? { ...p, ...patch } : p))}
            onClose={() => setSettingsOpen(false)}
          />
        </div>
      </div>
    </ReactFlowProvider>
  )
}

// First screen for a brand-new flow — start blank or from a system template.
// Replaces the old WorkflowWizard's template-picker step.
function TemplateChooser({
  onPick,
  onImportFile,
  onCancel,
}: {
  onPick: (c: TemplateChoice) => void
  onImportFile?: (file: File) => void
  onCancel: () => void
}) {
  const importInputRef = useRef<HTMLInputElement>(null)
  const cards: { id: TemplateChoice; title: string; sub: string; icon: React.ReactNode }[] = [
    { id: 'blank', title: 'Blank flow', sub: 'Start from two tasks and build out', icon: <FilePlus2 size={20} /> },
    { id: 'basic', title: 'Basic', sub: 'A simple linear flow', icon: <Layers size={20} /> },
    { id: 'sales-default', title: 'Sales', sub: 'Lead → qualify → win/lose', icon: <ShoppingBag size={20} /> },
    { id: 'collab-default', title: 'Collaborative', sub: 'Multi-role tender pipeline', icon: <Users size={20} /> },
  ]
  return (
    <div className="relative mx-auto max-w-3xl px-4 py-16">
      <div className="pointer-events-none absolute -left-20 top-10 h-64 w-64 rounded-full bg-orb-a blur-3xl" />
      <div className="pointer-events-none absolute -right-16 top-32 h-56 w-56 rounded-full bg-orb-b blur-3xl" />
      <div className="relative">
        <h1 className="text-xl font-semibold tracking-tight text-fg">Create a flow</h1>
        <p className="mt-1 text-sm text-fg-subtle">
          Pick a starting point — you&rsquo;ll wire it together visually on the canvas.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {cards.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onPick(c.id)}
              className="group flex items-start gap-3 rounded-2xl border border-line bg-card p-4 text-left transition hover:border-brand-edge hover:bg-fill-2"
            >
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand transition group-hover:bg-brand-gradient group-hover:text-white">
                {c.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-fg">{c.title}</span>
                <span className="block text-xs text-fg-subtle">{c.sub}</span>
              </span>
            </button>
          ))}
        </div>
        {onImportFile && (
          <>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onImportFile(f)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="mt-3 inline-flex items-center gap-2 rounded-2xl border border-dashed border-line bg-card px-4 py-3 text-left text-sm text-fg-muted transition hover:border-brand-edge hover:text-fg"
            >
              <Upload size={16} /> Import from file
              <span className="text-xs text-fg-subtle">— start from a workflow JSON export</span>
            </button>
          </>
        )}
        <div>
          <button
            type="button"
            onClick={onCancel}
            className="mt-6 text-xs text-fg-subtle transition hover:text-fg"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
