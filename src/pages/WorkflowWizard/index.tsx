import { useState } from 'react'
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
import { runTransaction, doc, serverTimestamp, Timestamp } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { WORKFLOW_REGISTRY_ID, type WorkflowRegistry } from '../../types/workflow'
import TemplatePicker, { type TemplateChoice } from './TemplatePicker'
import Step1Name from './Step1Name'
import Step2FlowType from './Step2FlowType'
import Step3Stages from './Step3Stages'
import SideEditor from './SideEditor'
import type { FlowType } from '../../types/workflow'

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

  const totalSteps = phase.kind === 'editor' ? 4 : 4
  const stepNumber =
    phase.kind === 'picker'
      ? 1
      : phase.kind === 'step1'
        ? 2
        : phase.kind === 'step2'
          ? 3
          : phase.kind === 'step3'
            ? 4
            : 4

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
      const registryRef = doc(db, 'workflows', WORKFLOW_REGISTRY_ID)
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

  function handleSaved(savedId: string) {
    // refresh registry so the new active workflow shows up everywhere
    void refreshRegistry()
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
          onContinue={(flowType) =>
            setPhase({
              kind: 'step3',
              flowType,
              name: phase.name,
              description: phase.description,
              stages: [],
            })
          }
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
            const draft = buildSkeletonFromStageNames(
              phase.name || 'Untitled Workflow',
              phase.description,
              phase.flowType,
              stageNames,
            )
            setPhase({ kind: 'editor', draft })
          }}
        />
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
