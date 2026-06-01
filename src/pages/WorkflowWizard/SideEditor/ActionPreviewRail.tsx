import { useState } from 'react'
import Dropdown, { type DropdownOption } from '../../../components/ui/Dropdown'
import { useOrgStructure } from '../../../contexts/AppConfigContext'
import { describeActorShort } from '../../../lib/actorRefs'
import { previewMatches } from '../../../lib/actorPreview'
import type { ActorRef, ProjectRoleDef, Stage, StageAction } from '../../../types/workflow'

interface Props {
  stage: Stage
  projectRoles: ProjectRoleDef[]
  leadRoleName: string
}

const intentClass: Record<NonNullable<StageAction['intent']>, string> = {
  primary: 'bg-brand-gradient text-white shadow hover-brand-gradient',
  success: 'border border-tone-success-bd bg-tone-success-bg text-tone-success-fg',
  danger: 'border border-tone-danger-bd bg-tone-danger-bg text-tone-danger-fg',
  neutral: 'border border-line bg-fill-2 text-fg-muted',
}

// Phase 2d: live preview — pick a viewer archetype and see the actual buttons
// they'd get at this stage. Updates instantly as permission pills toggle
// (derives purely from the in-memory draft; no Firestore).
export default function ActionPreviewRail({ stage, projectRoles, leadRoleName }: Props) {
  const org = useOrgStructure()

  const viewers: { key: string; actor: ActorRef; label: string }[] = []
  for (const r of [...projectRoles].sort((a, b) => a.order - b.order)) {
    viewers.push({ key: `project_role:${r.id}`, actor: { kind: 'project_role', roleId: r.id }, label: r.label || 'Role' })
  }
  viewers.push({ key: 'pipeline_role:lead', actor: { kind: 'pipeline_role', role: 'lead' }, label: leadRoleName || 'Project lead' })
  if (org.teamRoles.hasCoordinator) viewers.push({ key: 'team_role:coordinator/lead', actor: { kind: 'team_role', role: 'coordinator', member: 'lead' }, label: 'Coordinator Team Lead' })
  if (org.teamRoles.hasValidator) viewers.push({ key: 'team_role:validator/lead', actor: { kind: 'team_role', role: 'validator', member: 'lead' }, label: 'Validator Team Lead' })
  if (org.teamRoles.hasSpecialist) viewers.push({ key: 'team_role:specialist/any', actor: { kind: 'team_role', role: 'specialist', member: 'any' }, label: 'A Specialist Team member' })
  viewers.push({ key: 'creator', actor: { kind: 'creator' }, label: 'The project creator' })
  viewers.push({ key: 'global_role:admin', actor: { kind: 'global_role', role: 'admin' }, label: 'A global admin' })
  viewers.push({ key: 'global_role:super_admin', actor: { kind: 'global_role', role: 'super_admin' }, label: 'A super-admin' })

  const [viewerKey, setViewerKey] = useState(viewers[0]?.key ?? 'global_role:super_admin')
  const viewer = viewers.find((v) => v.key === viewerKey) ?? viewers[viewers.length - 1]

  const options: DropdownOption[] = viewers.map((v) => ({ value: v.key, label: v.label }))

  if (stage.isTerminal) {
    return (
      <div className="rounded-2xl border border-line bg-card p-5 text-sm text-fg-subtle">
        This stage is terminal — projects here are finished, so there are no buttons to preview.
      </div>
    )
  }

  const visible = stage.actions.filter((a) =>
    previewMatches(viewer.actor, [a.actor, ...(a.alsoAllow ?? [])]),
  )

  return (
    <div className="rounded-2xl border border-line bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-fg-muted">Live preview · viewing as</span>
        <Dropdown value={viewerKey} onChange={setViewerKey} options={options} className="w-56" />
        <span className="text-sm text-fg-subtle">at {stage.displayName}</span>
      </div>
      <div className="mt-4">
        {visible.length === 0 ? (
          <p className="text-sm text-fg-subtle">This person sees a read-only banner — no actions here.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {visible.map((a) => (
              <span
                key={a.id}
                className={`inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium ${
                  intentClass[(a.intent ?? 'primary') as NonNullable<StageAction['intent']>]
                }`}
              >
                {a.label || 'Button'}
              </span>
            ))}
          </div>
        )}
      </div>
      {/* Footnote: other roles who'd also see the first visible action. */}
      {visible.length > 0 && (
        <p className="mt-3 text-xs text-fg-subtle">
          Others who can act here:{' '}
          {(() => {
            const others = viewers
              .filter((v) => v.key !== viewer.key)
              .filter((v) => stage.actions.some((a) => previewMatches(v.actor, [a.actor, ...(a.alsoAllow ?? [])])))
              .map((v) => describeActorShort(v.actor, { leadRoleName, projectRoles }))
            return others.length ? others.slice(0, 5).join(', ') : 'no one else'
          })()}
        </p>
      )}
    </div>
  )
}
