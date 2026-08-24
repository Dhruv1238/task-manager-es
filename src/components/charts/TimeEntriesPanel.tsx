import { Link } from 'react-router-dom'
import { formatDateKey, formatDuration } from '../../lib/duration'
import type { TimeGroupRow } from '../../lib/timeReport'
import Modal from '../ui/Modal'

/**
 * Drill-down behind one row of the time report: the individual entries the
 * total is made of.
 *
 * The rows come from `row.entries` — the same array the pivot accumulated the
 * total from — so the detail can never disagree with the number that was
 * clicked. No second query, no second definition of the group.
 */
export default function TimeEntriesPanel({
  open,
  onClose,
  row,
  rangeLabel,
}: {
  open: boolean
  onClose: () => void
  row: TimeGroupRow | null
  rangeLabel: string
}) {
  if (!row) return null
  const title = row.sublabel ? `${row.label} · ${row.sublabel}` : row.label

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`${title} — ${formatDuration(row.minutes)}`}
      description={`${row.entryCount} ${row.entryCount === 1 ? 'entry' : 'entries'} · ${rangeLabel}`}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-fg-faint">
              <th className="pb-2 pr-3 font-medium">Day</th>
              <th className="pb-2 pr-3 font-medium">Person</th>
              <th className="pb-2 pr-3 font-medium">Task</th>
              <th className="pb-2 pr-3 font-medium">Project</th>
              <th className="pb-2 pr-3 text-right font-medium">Time</th>
              <th className="pb-2 font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            {row.entries.map((e) => (
              <tr key={e.id} className="border-b border-line/60 last:border-0">
                <td className="whitespace-nowrap py-2.5 pr-3 text-fg-subtle">
                  {formatDateKey(e.dateKey)}
                </td>
                <td className="py-2.5 pr-3 text-fg-muted">{e.userName || 'Unknown user'}</td>
                <td className="max-w-[16rem] truncate py-2.5 pr-3">
                  <Link
                    to={`/tasks/${e.taskId}`}
                    onClick={onClose}
                    className="text-fg transition hover:text-brand"
                  >
                    {e.taskTitle || 'Untitled task'}
                  </Link>
                </td>
                <td className="max-w-[12rem] truncate py-2.5 pr-3 text-fg-subtle">
                  {e.projectTitle || '—'}
                </td>
                <td className="whitespace-nowrap py-2.5 pr-3 text-right tabular-nums text-fg-strong">
                  {formatDuration(e.minutes)}
                </td>
                <td className="py-2.5 text-fg-subtle">{e.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}
