import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X, ListChecks, Users, Flag } from 'lucide-react'
import type { ActorRef, CustomFieldDef, ProjectRoleDef, Workflow, WorkflowStatusOption } from '../../../types/workflow'
import CustomFieldsEditor from '../../../pages/WorkflowWizard/SideEditor/CustomFieldsEditor'
import ProjectRolesEditor from '../../../pages/WorkflowWizard/SideEditor/ProjectRolesEditor'
import StatusOptionsEditor from '../../../pages/WorkflowWizard/SideEditor/StatusOptionsEditor'

// Canvas-side drawer hosting the workflow-level config the canvas can't reach
// otherwise — reuses the legacy SideEditor editors verbatim. Project Fields are
// the create-time dynamic fields (create form / sidebar / list column / filter);
// People & Roles are the per-project named roles (assigned on the project
// screen); Statuses feed the close-outcome dropdown.

type Tab = 'fields' | 'roles' | 'statuses'

const TABS: { id: Tab; label: string; icon: typeof ListChecks }[] = [
  { id: 'fields', label: 'Project Fields', icon: ListChecks },
  { id: 'roles', label: 'People & Roles', icon: Users },
  { id: 'statuses', label: 'Statuses', icon: Flag },
]

export interface WorkflowSettingsDrawerProps {
  open: boolean
  workflow: Workflow
  leadRoleName: string
  disabled?: boolean
  onChange: (patch: Partial<Workflow>) => void
  onClose: () => void
}

export function WorkflowSettingsDrawer({
  open,
  workflow,
  leadRoleName,
  disabled,
  onChange,
  onClose,
}: WorkflowSettingsDrawerProps) {
  const reduce = useReducedMotion()
  const [tab, setTab] = useState<Tab>('fields')

  const customFields = workflow.projectFields?.customFields ?? []
  const projectRoles = workflow.projectRoles ?? []
  const statusOptions = workflow.statusOptions ?? []

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="wf-settings"
          initial={reduce ? false : { x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { x: '100%', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          className="nopan nodrag scrollbar-themed node-glass absolute right-0 top-0 z-30 flex h-full w-[30rem] max-w-[92vw] flex-col overflow-y-auto overflow-x-hidden border-l border-line shadow-2xl"
        >
          <div className="pointer-events-none absolute -right-20 -top-20 h-44 w-44 rounded-full bg-orb-b blur-3xl" />

          {/* Header + tabs */}
          <div className="sticky top-0 z-10 border-b border-line bg-[var(--color-node-header)] px-4 pt-3 backdrop-blur">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-fg">Workflow settings</span>
              <button
                type="button"
                onClick={onClose}
                className="-mr-1 rounded-md p-1 text-fg-subtle transition hover:bg-fill-2 hover:text-fg-strong"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mt-2 flex gap-1">
              {TABS.map((t) => {
                const Icon = t.icon
                const active = tab === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`inline-flex items-center gap-1.5 rounded-t-lg border-b-2 px-2.5 py-1.5 text-xs font-medium transition ${
                      active
                        ? 'border-brand text-fg'
                        : 'border-transparent text-fg-subtle hover:text-fg'
                    }`}
                  >
                    <Icon size={13} /> {t.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="relative p-4">
            {/* Project lead label — the built-in pipeline lead's display name
                (workflow.leadRoleName). Distinct from the Project roles below;
                surfaced in stage banners and the actor picker's "Special" group. */}
            <div className="mb-4 space-y-1.5 border-b border-line pb-4">
              <label htmlFor="wf-lead-label" className="block text-sm font-medium text-fg">
                What you call the project lead / owner
              </label>
              <input
                id="wf-lead-label"
                type="text"
                value={workflow.leadRoleName ?? ''}
                maxLength={50}
                onChange={(e) => onChange({ leadRoleName: e.target.value })}
                disabled={disabled}
                placeholder={'Defaults to "Project Lead"'}
                className="w-full rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring disabled:cursor-not-allowed disabled:opacity-60"
              />
              <p className="text-xs text-fg-subtle">
                The person who owns and runs each project from start to finish.
              </p>

              <label htmlFor="wf-create-desc" className="block pt-1 text-sm font-medium text-fg">
                New-project modal description
              </label>
              <textarea
                id="wf-create-desc"
                value={workflow.creationModalDescription ?? ''}
                rows={2}
                onChange={(e) => onChange({ creationModalDescription: e.target.value })}
                disabled={disabled}
                placeholder="Falls back to a flow-type sentence when blank"
                className="w-full rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg placeholder:text-fg-faint outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring disabled:cursor-not-allowed disabled:opacity-60"
              />
              <p className="text-xs text-fg-subtle">
                Shown under the title when someone creates a project with this workflow.
              </p>
            </div>
            {tab === 'fields' && (
              <CustomFieldsEditor
                fields={customFields}
                disabled={disabled}
                onChange={(next: CustomFieldDef[]) =>
                  onChange({ projectFields: { ...workflow.projectFields, customFields: next } })
                }
              />
            )}
            {tab === 'roles' && (
              <ProjectRolesEditor
                roles={projectRoles}
                disabled={disabled}
                onChange={(next: ProjectRoleDef[]) => onChange({ projectRoles: next })}
              />
            )}
            {tab === 'statuses' && (
              <StatusOptionsEditor
                statusOptions={statusOptions}
                canUpdateStatusActors={workflow.canUpdateStatusActors ?? []}
                projectRoles={projectRoles}
                leadRoleName={leadRoleName}
                disabled={disabled}
                onChangeStatuses={(next: WorkflowStatusOption[]) => onChange({ statusOptions: next })}
                onChangeActors={(next: ActorRef[]) => onChange({ canUpdateStatusActors: next })}
              />
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
