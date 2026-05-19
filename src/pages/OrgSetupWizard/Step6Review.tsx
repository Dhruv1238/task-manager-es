import AssistantBubble from './components/AssistantBubble'
import WizardFooter from './components/WizardFooter'
import type { TeamMapping } from './Step4TeamMapping'

interface Props {
  leadRoleName: string
  teamRoles: { hasCoordinator: boolean; hasValidator: boolean; hasSpecialist: boolean }
  workTypes: string[]
  teamMappings: Record<string, TeamMapping>
  // Used to render readable team names beside the mapping rows.
  teamNameById: Record<string, string>
  onEdit: (step: number) => void
  onFinish: () => void
  onBack: () => void
  submitting?: boolean
  errorMessage?: string | null
}

function buildTeamsSummary(roles: Props['teamRoles']): string {
  const parts: string[] = []
  if (roles.hasCoordinator) parts.push('a coordination team')
  if (roles.hasValidator) parts.push('a review team')
  if (roles.hasSpecialist) parts.push('specialist teams')
  if (parts.length === 0) return 'No team roles configured'
  if (parts.length === 1) return parts[0].replace(/^a /, 'A ')
  return parts
    .map((p, i) => (i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .join(', ')
    .replace(/,([^,]*)$/, ', and$1')
}

// Step 6 — Review. Summary card with four sections, each with an Edit link.
// Mirrors screenshot 2's "Auto-filled" review card aesthetic; we render an
// "Your answers" badge instead of "AI-filled" since we're manual-entry.
export default function Step6Review({
  leadRoleName,
  teamRoles,
  workTypes,
  teamMappings,
  teamNameById,
  onEdit,
  onFinish,
  onBack,
  submitting = false,
  errorMessage = null,
}: Props) {
  const mappedTeams = Object.entries(teamMappings).filter(([, m]) => m.roleId !== null)

  return (
    <>
      <AssistantBubble
        text={
          <>Here's how we'll set up your organization. Anything you want to change?</>
        }
      >
        <div className="overflow-hidden rounded-2xl border border-brand-edge/40 bg-fill-2/50">
          <div className="flex items-center justify-between gap-2 border-b border-line bg-brand-soft/30 px-4 py-2.5">
            <span className="rounded-full bg-brand-gradient px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
              Your answers
            </span>
            <span className="text-[11px] text-fg-subtle">Click any section to edit</span>
          </div>

          <ReviewSection
            label="Leadership"
            value={`You call them: ${leadRoleName}`}
            onEdit={() => onEdit(1)}
          />
          <ReviewSection
            label="Teams"
            value={`You have: ${buildTeamsSummary(teamRoles)}`}
            onEdit={() => onEdit(2)}
          />
          {teamRoles.hasSpecialist && (
            <ReviewSection
              label="Work types"
              value={
                workTypes.length > 0
                  ? `Your specialists do: ${workTypes.join(', ')}`
                  : 'No work types yet'
              }
              onEdit={() => onEdit(3)}
            />
          )}
          {mappedTeams.length > 0 && (
            <ReviewSection
              label="Team mapping"
              value={
                <ul className="space-y-0.5 text-xs">
                  {mappedTeams.map(([teamId, m]) => (
                    <li key={teamId}>
                      <span className="text-fg">{teamNameById[teamId] ?? '(team)'}</span>
                      <span className="text-fg-subtle">
                        {' '}
                        — {labelFor(m.roleId)}
                        {m.roleId === 'specialist' && m.workTypes.length > 0
                          ? ` (${m.workTypes.join(', ')})`
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              }
              onEdit={() => onEdit(4)}
            />
          )}
          <ReviewSection
            label="Project assignment"
            value="Manual — someone picks the lead when creating each project"
            onEdit={() => onEdit(5)}
            isLast
          />
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg"
          >
            {errorMessage}
          </div>
        )}
      </AssistantBubble>

      <WizardFooter
        onBack={onBack}
        onPrimary={onFinish}
        primaryLabel="Finish setup"
        primarySubmitting={submitting}
      />
    </>
  )
}

function ReviewSection({
  label,
  value,
  onEdit,
  isLast = false,
}: {
  label: string
  value: React.ReactNode
  onEdit: () => void
  isLast?: boolean
}) {
  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 ${isLast ? '' : 'border-b border-line'}`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          {label}
        </div>
        <div className="mt-0.5 text-sm text-fg">{value}</div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-brand transition hover:bg-brand-soft"
      >
        Edit
      </button>
    </div>
  )
}

function labelFor(roleId: string | null): string {
  if (roleId === 'coordinator') return 'Client coordination'
  if (roleId === 'validator') return 'Reviews work'
  if (roleId === 'specialist') return 'Specialist team'
  return 'Skipped'
}
