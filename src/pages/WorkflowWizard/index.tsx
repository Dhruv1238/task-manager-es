import { useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useAppConfigContext } from '../../contexts/AppConfigContext'
import { WizardShell } from '../../components/wizard'
import {
  buildSkeletonFromStageNames,
  cloneTemplate,
  type WorkflowDraft,
} from '../../lib/workflowAuthoring'
import { seedBasicWorkflow, BASIC_WORKFLOW_ID } from '../../lib/seedBasicWorkflow'
import { runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { tenantDoc } from '../../lib/firestore'
import { WORKFLOW_REGISTRY_ID, type WorkflowRegistry } from '../../types/workflow'
import TemplatePicker, { type TemplateChoice } from './TemplatePicker'
import Step1Name from './Step1Name'
import Step2FlowType from './Step2FlowType'
import Step3Stages from './Step3Stages'
import SideEditor from './SideEditor'
import ProjectRolesEditor from './SideEditor/ProjectRolesEditor'
import CustomFieldsEditor from './SideEditor/CustomFieldsEditor'
import StatusOptionsEditor from './SideEditor/StatusOptionsEditor'
import { SIMPLE_STATUS_OPTIONS, defaultStatusOptions } from '../../lib/projectStatus'
import type {
  CustomFieldDef,
  FlowType,
  ProjectRoleDef,
  WorkflowStatusOption,
} from '../../types/workflow'

interface WizardExtras {
  flowType: FlowType
  name: string
  description: string
  stages: string[]
}

type Phase =
  | { kind: 'picker' }
  | { kind: 'step1'; flowType: FlowType; name: string; description: string }
  | { kind: 'step2'; flowType: FlowType; name: string; description: string }
  | {
      kind: 'step3'
      flowType: FlowType
      name: string
      description: string
      stages: string[]
    }
  | { kind: 'step4'; extras: WizardExtras }
  | { kind: 'step5'; extras: WizardExtras }
  | { kind: 'step6'; extras: WizardExtras }
  | { kind: 'editor'; draft: WorkflowDraft }

// Phase 2c: workflow authoring wizard. Sub-route'd via internal state machine
// (no react-router nesting, so the back button + reload survive without
// a wizard-specific route). The `?onboarding=1` query flips header copy and
// the escape-hatch behaviour.
export default function WorkflowWizard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { refreshRegistry, setRegistryOptimistic } = useAppConfigContext()
  const onboardingMode = searchParams.get('onboarding') === '1'
  const [phase, setPhase] = useState<Phase>({ kind: 'picker' })
  const [skipping, setSkipping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Phase 2d: roles / fields / statuses collected across the new wizard steps.
  const [wizFields, setWizFields] = useState<CustomFieldDef[]>([])
  const [wizRoles, setWizRoles] = useState<ProjectRoleDef[]>([])
  const [wizStatuses, setWizStatuses] = useState<WorkflowStatusOption[]>([])

  const totalSteps = 7
  const stepNumber =
    phase.kind === 'picker'
      ? 1
      : phase.kind === 'step1'
        ? 2
        : phase.kind === 'step2'
          ? 3
          : phase.kind === 'step3'
            ? 4
            : phase.kind === 'step4'
              ? 5
              : phase.kind === 'step5'
                ? 6
                : phase.kind === 'step6'
                  ? 7
                  : 7

  function finishToEditor(extras: WizardExtras) {
    const draft = buildSkeletonFromStageNames(
      extras.name || 'Untitled Workflow',
      extras.description,
      extras.flowType,
      extras.stages,
      {
        projectRoles: wizRoles.length ? wizRoles : undefined,
        customFields: wizFields.length ? wizFields : undefined,
        statusOptions: wizStatuses.length ? wizStatuses : undefined,
      },
    )
    setPhase({ kind: 'editor', draft })
  }

  function handlePickerContinue(choice: TemplateChoice) {
    if (choice === 'blank') {
      setPhase({
        kind: 'step1',
        flowType: 'collaborative',
        name: '',
        description: '',
      })
      return
    }
    // Template path: clone and jump straight into the editor.
    const draft = cloneTemplate(choice)
    setPhase({ kind: 'editor', draft })
  }

  async function handleSkipWithBasic() {
    if (!user) return
    setSkipping(true)
    setError(null)
    try {
      // 1. Idempotent seed of /workflows/basic (no-op if already at latest).
      await seedBasicWorkflow(user.uid)
      // 2. Atomically add basic to /workflows/_registry.activeWorkflowIds.
      const registryRef = tenantDoc('workflows', WORKFLOW_REGISTRY_ID)
      const nextRegistry = await runTransaction(db, async (tx) => {
        const snap = await tx.get(registryRef)
        const existing: WorkflowRegistry = snap.exists()
          ? (snap.data() as WorkflowRegistry)
          : {
              version: 0,
              updatedAt: Timestamp.now(),
              updatedBy: user.uid,
              activeWorkflowIds: [],
              defaultWorkflowId: null,
            }
        const active = new Set(existing.activeWorkflowIds ?? [])
        if (active.has(BASIC_WORKFLOW_ID)) return existing
        const nextIds = [...(existing.activeWorkflowIds ?? []), BASIC_WORKFLOW_ID]
        const nextDefault = existing.defaultWorkflowId ?? BASIC_WORKFLOW_ID
        const next: WorkflowRegistry = {
          version: (existing.version ?? 0) + 1,
          updatedAt: Timestamp.now(),
          updatedBy: user.uid,
          activeWorkflowIds: nextIds,
          defaultWorkflowId: nextDefault,
        }
        tx.set(registryRef, {
          ...next,
          updatedAt: serverTimestamp(),
        })
        return next
      })
      // 3. Refresh local context so the home redirect logic sees the change.
      setRegistryOptimistic(nextRegistry)
      await refreshRegistry()
      navigate('/', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to seed Simple Project.')
    } finally {
      setSkipping(false)
    }
  }

  function handleCancel() {
    navigate(onboardingMode ? '/' : '/admin/config')
  }

  async function handleSaved(savedId: string) {
    // SideEditor has already pushed the just-saved workflow + registry into
    // local context optimistically. Awaiting a full registry re-fetch here
    // is belt-and-braces — it pulls any concurrent operator edits and
    // refreshes the localStorage TTL clock — but it doesn't gate navigation
    // anymore, so the user sees an instant transition.
    await refreshRegistry().catch(() => null)
    if (onboardingMode) {
      navigate('/', { replace: true })
    } else {
      navigate(`/admin/config?workflow=${savedId}`, { replace: true })
    }
  }

  const title = onboardingMode
    ? 'Final step — set up your first workflow'
    : 'Create a new workflow'

  if (phase.kind === 'editor') {
    return (
      <SideEditor
        initialDraft={phase.draft}
        mode={onboardingMode ? 'onboarding' : 'create'}
        onSaved={handleSaved}
      />
    )
  }

  return (
    <WizardShell title={title} step={stepNumber} totalSteps={totalSteps}>
      {phase.kind === 'picker' && (
        <TemplatePicker
          mode={onboardingMode ? 'onboarding' : 'standalone'}
          onContinue={handlePickerContinue}
          onCancel={handleCancel}
          onSkipWithBasic={handleSkipWithBasic}
        />
      )}

      {phase.kind === 'step1' && (
        <Step1Name
          initialName={phase.name}
          initialDescription={phase.description}
          onBack={() => setPhase({ kind: 'picker' })}
          onContinue={(name, description) =>
            setPhase({ kind: 'step2', flowType: phase.flowType, name, description })
          }
        />
      )}

      {phase.kind === 'step2' && (
        <Step2FlowType
          initialFlowType={phase.flowType}
          onBack={() =>
            setPhase({
              kind: 'step1',
              flowType: phase.flowType,
              name: phase.name,
              description: phase.description,
            })
          }
          onContinue={(flowType) => {
            // Flow type drives the default status set — clear any seeded
            // statuses so step6 re-seeds for the (possibly changed) flow type.
            setWizStatuses([])
            setPhase({
              kind: 'step3',
              flowType,
              name: phase.name,
              description: phase.description,
              stages: [],
            })
          }}
        />
      )}

      {phase.kind === 'step3' && (
        <Step3Stages
          initialStageNames={phase.stages}
          onBack={() =>
            setPhase({
              kind: 'step2',
              flowType: phase.flowType,
              name: phase.name,
              description: phase.description,
            })
          }
          onContinue={(stageNames) => {
            setPhase({
              kind: 'step4',
              extras: {
                flowType: phase.flowType,
                name: phase.name,
                description: phase.description,
                stages: stageNames,
              },
            })
          }}
        />
      )}

      {phase.kind === 'step4' && (
        <WizardStep
          heading="What details should every project capture?"
          subtitle="Optional. Add custom fields now, or skip and add them later in the editor."
          onBack={() =>
            setPhase({
              kind: 'step3',
              flowType: phase.extras.flowType,
              name: phase.extras.name,
              description: phase.extras.description,
              stages: phase.extras.stages,
            })
          }
          onContinue={() => setPhase({ kind: 'step5', extras: phase.extras })}
        >
          <CustomFieldsEditor fields={wizFields} onChange={setWizFields} />
        </WizardStep>
      )}

      {phase.kind === 'step5' && (
        <WizardStep
          heading="Who works on a project like this?"
          subtitle="Optional. Define the named roles people hold — assigned per project."
          onBack={() => setPhase({ kind: 'step4', extras: phase.extras })}
          onContinue={() => {
            if (wizStatuses.length === 0) {
              setWizStatuses(
                phase.extras.flowType === 'basic'
                  ? defaultStatusOptions(SIMPLE_STATUS_OPTIONS)
                  : defaultStatusOptions(),
              )
            }
            setPhase({ kind: 'step6', extras: phase.extras })
          }}
        >
          <ProjectRolesEditor roles={wizRoles} onChange={setWizRoles} />
        </WizardStep>
      )}

      {phase.kind === 'step6' && (
        <WizardStep
          heading="What outcomes can a project end in?"
          subtitle="These statuses appear on the status pill. Tweak the standard set or keep it."
          onBack={() => setPhase({ kind: 'step5', extras: phase.extras })}
          onContinue={() => finishToEditor(phase.extras)}
          continueLabel="Open editor"
        >
          <StatusOptionsEditor
            statusOptions={wizStatuses}
            canUpdateStatusActors={[]}
            projectRoles={wizRoles}
            leadRoleName=""
            onChangeStatuses={setWizStatuses}
            onChangeActors={() => {}}
            hideActorPicker
          />
        </WizardStep>
      )}

      {skipping && (
        <p className="mt-2 text-xs text-fg-subtle">Setting up Simple Project…</p>
      )}
      {error && (
        <p className="mt-2 text-xs text-tone-danger-fg" role="alert">
          {error}
        </p>
      )}
    </WizardShell>
  )
}

// Phase 2d: shared shell for the new optional wizard steps (fields / roles /
// statuses). Conversational heading + the editor body + a Back / Continue row.
function WizardStep({
  heading,
  subtitle,
  children,
  onBack,
  onContinue,
  continueLabel = 'Continue',
}: {
  heading: string
  subtitle?: string
  children: ReactNode
  onBack: () => void
  onContinue: () => void
  continueLabel?: string
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-fg">{heading}</h2>
        {subtitle && <p className="mt-1 text-sm text-fg-subtle">{subtitle}</p>}
      </div>
      {children}
      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-line bg-fill-2 px-4 py-2 text-sm font-medium text-fg-muted transition hover:bg-fill-4"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onContinue}
          className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white shadow hover-brand-gradient"
        >
          {continueLabel}
        </button>
      </div>
    </div>
  )
}
