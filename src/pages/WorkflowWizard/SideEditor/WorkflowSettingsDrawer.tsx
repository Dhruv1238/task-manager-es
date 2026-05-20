import { useOrgStructure } from '../../../contexts/AppConfigContext'
import type { Workflow } from '../../../types/workflow'
import Dropdown, { type DropdownOption } from '../../../components/ui/Dropdown'

interface Props {
  draft: Pick<
    Workflow,
    | 'displayName'
    | 'flowType'
    | 'leadRoleName'
    | 'description'
    | 'creationModalCardSubtitle'
    | 'creationModalDescription'
  >
  onChange: (
    patch: Partial<Pick<
      Workflow,
      | 'displayName'
      | 'flowType'
      | 'leadRoleName'
      | 'description'
      | 'creationModalCardSubtitle'
      | 'creationModalDescription'
    >>,
  ) => void
  hasStages: boolean
  disabled?: boolean
}

// Phase 2c: workflow-level settings drawer. Surfaced behind the cog button on
// the editor header. Everything in here is optional — display name has a
// default ("Untitled Workflow") and the lead-role override placeholder shows
// the org's value to make clear that no override is needed for parity.
export default function WorkflowSettingsDrawer({
  draft,
  onChange,
  hasStages,
  disabled,
}: Props) {
  const org = useOrgStructure()
  const inputCls =
    'w-full scheme-dark rounded-lg border border-line bg-fill-2 px-3 py-2 text-sm text-fg outline-none transition focus:border-brand-edge focus:bg-fill-3 focus:ring-2 focus:ring-brand-ring disabled:opacity-60'

  const flowTypeOptions: DropdownOption[] = [
    { value: 'collaborative', label: 'Multi-team collaborative' },
    { value: 'individual', label: 'Individual pipeline' },
    { value: 'basic', label: 'Owner-driven' },
  ]

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-card p-4">
      <h3 className="text-sm font-medium uppercase tracking-wider text-fg-subtle">
        Workflow settings
      </h3>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
          Display name
        </label>
        <input
          type="text"
          value={draft.displayName}
          onChange={(e) => onChange({ displayName: e.target.value })}
          className={inputCls}
          disabled={disabled}
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
          Description (optional)
        </label>
        <textarea
          value={draft.description ?? ''}
          rows={2}
          onChange={(e) => onChange({ description: e.target.value || undefined })}
          placeholder="What kind of work does this workflow track?"
          className={`${inputCls} resize-none`}
          disabled={disabled}
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
          Flow type
        </label>
        <Dropdown
          value={draft.flowType}
          onChange={(v) => onChange({ flowType: v as Workflow['flowType'] })}
          options={flowTypeOptions}
          disabled={disabled}
        />
        {hasStages && (
          <p className="text-xs text-fg-subtle">
            Changing flow type after stages exist may invalidate some action settings.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
          Lead role override (optional)
        </label>
        <input
          type="text"
          value={draft.leadRoleName ?? ''}
          onChange={(e) => onChange({ leadRoleName: e.target.value })}
          placeholder={`Defaults to your org: "${org.leadRoleName || 'Project Lead'}"`}
          className={inputCls}
          disabled={disabled}
        />
        <p className="text-xs text-fg-subtle">
          Only fill in to use a different lead title for this workflow (e.g. "Sales Rep").
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
          Picker card subtitle (optional)
        </label>
        <input
          type="text"
          value={draft.creationModalCardSubtitle ?? ''}
          onChange={(e) =>
            onChange({ creationModalCardSubtitle: e.target.value || undefined })
          }
          placeholder='e.g. "Multi-team flow"'
          className={inputCls}
          disabled={disabled}
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium uppercase tracking-wider text-fg-subtle">
          New-project modal description (optional)
        </label>
        <input
          type="text"
          value={draft.creationModalDescription ?? ''}
          onChange={(e) =>
            onChange({ creationModalDescription: e.target.value || undefined })
          }
          placeholder="Shown beneath the modal title."
          className={inputCls}
          disabled={disabled}
        />
      </div>
    </div>
  )
}
