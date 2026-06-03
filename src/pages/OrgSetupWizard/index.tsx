import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  serverTimestamp,
  Timestamp,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { tenantDoc } from '../../lib/firestore'
import { useAuth } from '../../contexts/AuthContext'
import {
  getOrgStructureSnapshot,
  useAppConfigContext,
  useOrgStructure,
} from '../../contexts/AppConfigContext'
import { useAllTeams } from '../../hooks/useAllTeams'
import type { OrgStructure } from '../../types/models'
import WizardShell from './components/WizardShell'
import Step1LeadRole from './Step1LeadRole'
import Step2TeamTypes from './Step2TeamTypes'
import Step3WorkTypes from './Step3WorkTypes'
import Step4TeamMapping, { type TeamMapping } from './Step4TeamMapping'
import Step5Allotment from './Step5Allotment'
import Step6Review from './Step6Review'
import Step6FinishingOverlay from './Step6FinishingOverlay'
import { useWizardState, clearWizardDraft } from './useWizardState'

const TOTAL_STEPS = 6

const FINISH_STEPS = [
  { key: 'config', label: 'Saving your organization settings' },
  { key: 'teams', label: 'Updating team roles' },
  { key: 'done', label: 'Finalizing' },
]

// Minimum overlay display time so the progressive loader doesn't flash.
const MIN_FINISH_DURATION_MS = 1200

// Wizard parent. Owns the step index and the in-progress draft (persisted to
// localStorage via useWizardState). Renders the current step's component
// inside the shared shell.
export default function OrgSetupWizard() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const orgSnapshot = useOrgStructure()
  const { setOrgStructureOptimistic } = useAppConfigContext()
  const { teams } = useAllTeams()
  // Seed the draft with the live org structure so re-runs pre-fill values.
  const { draft, update } = useWizardState(profile?.uid, {
    leadRoleName: orgSnapshot.leadRoleName,
    teamRoles: orgSnapshot.teamRoles,
    workTypes: orgSnapshot.workTypes,
  })
  const [step, setStep] = useState<number>(draft.step || 1)
  const [finishing, setFinishing] = useState(false)
  const [finishIndex, setFinishIndex] = useState(0)
  const [finishError, setFinishError] = useState<string | null>(null)

  const teamNameById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const t of teams) m[t.id] = t.name
    return m
  }, [teams])

  function setStepBoth(next: number) {
    setStep(next)
    update({ step: next })
  }

  function goBack() {
    // Skip step 3 going backward when specialist toggle is off.
    if (step === 4 && !draft.teamRoles.hasSpecialist) {
      setStepBoth(2)
      return
    }
    setStepBoth(Math.max(1, step - 1))
  }

  function handleCancel() {
    navigate('/')
  }

  function step1SummaryText(): string {
    return draft.leadRoleName
  }

  function step2SummaryText(): string {
    const roleNames: string[] = []
    if (draft.teamRoles.hasCoordinator) roleNames.push('Coordination')
    if (draft.teamRoles.hasValidator) roleNames.push('Review')
    if (draft.teamRoles.hasSpecialist) roleNames.push('Specialists')
    return roleNames.length > 0 ? roleNames.join(' · ') : 'No team roles'
  }

  function step3SummaryText(): string {
    return draft.workTypes.length > 0 ? draft.workTypes.join(', ') : 'No work types'
  }

  function step4SummaryText(): string {
    const mapped = Object.values(draft.teamMappings).filter((m) => m.roleId !== null)
    return mapped.length === 0 ? 'No team mappings yet' : `${mapped.length} team(s) mapped`
  }

  async function handleFinish() {
    if (!profile?.uid) {
      setFinishError('You must be signed in to finish setup.')
      return
    }
    setFinishing(true)
    setFinishIndex(0)
    setFinishError(null)

    const startedAt = Date.now()

    try {
      // Phase 1: build the new org-structure shape from the draft. Single
      // writeBatch covers the singleton doc + per-team mapping updates.
      const previous = getOrgStructureSnapshot()
      const newVersion = (previous.version ?? 0) + 1
      const nextOrg: Omit<OrgStructure, 'updatedAt'> & { updatedAt: ReturnType<typeof serverTimestamp> } = {
        version: newVersion,
        updatedAt: serverTimestamp(),
        updatedBy: profile.uid,
        leadRoleName: draft.leadRoleName.trim() || 'Project Lead',
        teamRoles: draft.teamRoles,
        workTypes: draft.teamRoles.hasSpecialist ? draft.workTypes : [],
        allotment: { mode: 'manual' },
        setupCompleted: true,
      }

      setFinishIndex(0) // saving config
      const batch = writeBatch(db)
      batch.set(tenantDoc('config', 'orgStructure'), nextOrg)

      // Step 2 of the batch: per-team teamRoleId / workTypes updates.
      setFinishIndex(1)
      const mappedEntries = Object.entries(draft.teamMappings).filter(
        ([, m]) => m.roleId !== null,
      )
      for (const [teamId, mapping] of mappedEntries) {
        batch.update(tenantDoc('teams', teamId), {
          teamRoleId: mapping.roleId,
          workTypes: mapping.workTypes,
        })
      }

      await batch.commit()

      // Optimistic context update so other parts of the app see the new
      // labels immediately (no Firestore round-trip required).
      setOrgStructureOptimistic({
        ...nextOrg,
        updatedAt: Timestamp.now(),
      })

      setFinishIndex(2) // finalizing
      const elapsed = Date.now() - startedAt
      const remaining = Math.max(0, MIN_FINISH_DURATION_MS - elapsed)
      await new Promise((resolve) => window.setTimeout(resolve, remaining))
      setFinishIndex(FINISH_STEPS.length)

      // Clear the in-progress draft now that the doc is committed.
      clearWizardDraft(profile.uid)

      // Small breath before redirect so the user sees the "all done" state.
      await new Promise((resolve) => window.setTimeout(resolve, 350))
      // Phase 3: the org wizard now chains into Roles & Hierarchy (which then
      // hands off to flow authoring). Home's first-run logic routes the same
      // way on reload; navigating directly avoids the home-screen flash.
      navigate('/admin/roles?onboarding=1', { replace: true })
    } catch (err) {
      setFinishError(err instanceof Error ? err.message : 'Something went wrong saving setup.')
      setFinishing(false)
    }
  }

  if (finishing) {
    return (
      <WizardShell title="Set up your organization" step={TOTAL_STEPS} totalSteps={TOTAL_STEPS}>
        <Step6FinishingOverlay steps={FINISH_STEPS} currentIndex={finishIndex} />
      </WizardShell>
    )
  }

  return (
    <WizardShell title="Set up your organization" step={step} totalSteps={TOTAL_STEPS}>
      {step === 1 && (
        <Step1LeadRole
          initialValue={draft.leadRoleName}
          onSubmit={(value) => {
            update({ leadRoleName: value })
            setStepBoth(2)
          }}
          onSkip={handleCancel}
        />
      )}

      {step === 2 && (
        <Step2TeamTypes
          leadRoleName={draft.leadRoleName}
          initialRoles={draft.teamRoles}
          onSubmit={(roles) => {
            update({ teamRoles: roles })
            setStepBoth(roles.hasSpecialist ? 3 : 4)
          }}
          onBack={goBack}
          onSkip={handleCancel}
        />
      )}

      {step === 3 && (
        <Step3WorkTypes
          initialWorkTypes={draft.workTypes}
          summary={`${step1SummaryText()} · ${step2SummaryText()}`}
          onSubmit={(workTypes) => {
            update({ workTypes })
            setStepBoth(4)
          }}
          onBack={goBack}
          onSkip={handleCancel}
        />
      )}

      {step === 4 && (
        <Step4TeamMapping
          hasCoordinator={draft.teamRoles.hasCoordinator}
          hasValidator={draft.teamRoles.hasValidator}
          hasSpecialist={draft.teamRoles.hasSpecialist}
          workTypes={draft.workTypes}
          mappings={draft.teamMappings}
          onMappingsChange={(mappings: Record<string, TeamMapping>) =>
            update({ teamMappings: mappings })
          }
          recommendedMappings={draft.recommendedMappings}
          onRecommendedMappingsChange={(next) =>
            update({ recommendedMappings: next })
          }
          summary={step3SummaryText()}
          onContinue={() => setStepBoth(5)}
          onBack={goBack}
          onSkip={handleCancel}
        />
      )}

      {step === 5 && (
        <Step5Allotment
          summary={step4SummaryText()}
          onSubmit={() => setStepBoth(6)}
          onBack={goBack}
          onSkip={handleCancel}
        />
      )}

      {step === 6 && (
        <Step6Review
          leadRoleName={draft.leadRoleName}
          teamRoles={draft.teamRoles}
          workTypes={draft.workTypes}
          teamMappings={draft.teamMappings}
          teamNameById={teamNameById}
          onEdit={(s) => setStepBoth(s)}
          onFinish={handleFinish}
          onBack={goBack}
          errorMessage={finishError}
        />
      )}

    </WizardShell>
  )
}
