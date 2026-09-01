import type { TaskStatus } from '../../types/models'
import { resolveTaskStatusMeta } from '../../lib/taskStatus'

// The one status pill. Resolves label/classes through the safe accessor so an
// unknown or flag-inactive status still renders its true label (never crashes,
// never hides data). Replaces the previously-duplicated local STATUS_STYLES
// pills in TaskDetailContent / Me / TeamOnProject.
export default function TaskStatusPill({ status }: { status: TaskStatus | string }) {
  const meta = resolveTaskStatusMeta(status)
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.pillCls}`}
    >
      {meta.label}
    </span>
  )
}
