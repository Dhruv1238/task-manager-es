import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import ChartCard from './ChartCard'
import { stageTone } from '../workflow/stageStyle'
import { isProjectLive } from '../../lib/projectStatus'
import { useActiveWorkflow } from '../../contexts/AppConfigContext'
import type { Project } from '../../types/models'

interface Props {
  projects: Project[]
}

// Tenders within 7 days of submission and not yet delivered (delta §6.5).
export default function AtRiskBySubmission({ projects }: Props) {
  const { workflow } = useActiveWorkflow()
  const items = useMemo(() => {
    const now = Date.now()
    const horizon = 7 * 24 * 3600 * 1000
    return projects
      .filter(
        (p) =>
          isProjectLive(p.status) &&
          p.currentStageId !== 'delivered' &&
          p.stage !== 10 &&
          p.submissionDate,
      )
      .map((p) => ({
        p,
        days: Math.round(((p.submissionDate!.toDate().getTime() - now) / (24 * 3600 * 1000)) * 10) / 10,
      }))
      .filter((x) => x.days < horizon / (24 * 3600 * 1000))
      .sort((a, b) => a.days - b.days)
      .slice(0, 8)
  }, [projects])

  return (
    <ChartCard
      title="At-risk by submission date"
      subtitle="Tenders within 7 days of deadline that haven't shipped"
      height={280}
      empty={items.length === 0}
      emptyLabel="Nothing's on fire — all submissions are comfortably ahead."
    >
      <ul className="divide-y divide-line-subtle overflow-y-auto pr-1">
        {items.map(({ p, days }) => {
          const stage = workflow?.stages.find(
            (s) => s.id === p.currentStageId,
          ) ?? workflow?.stages[0]
          const tone = stageTone(stage?.order ?? 1, stage?.isTerminal ?? false)
          const overdue = days < 0
          return (
            <li key={p.id}>
              <Link
                to={`/projects/${p.id}`}
                className="flex items-center justify-between gap-3 px-2 py-3 transition hover:bg-fill-1"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-fg">{p.title}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-subtle">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${tone.pill}`}>
                      <span className={`h-1 w-1 rounded-full ${tone.dot}`} aria-hidden />
                      {stage?.displayName ?? '—'}
                    </span>
                  </div>
                </div>
                <span className={`text-xs font-medium ${overdue ? 'text-tone-danger-fg' : days < 3 ? 'text-tone-warn-fg' : 'text-fg-muted'}`}>
                  {overdue ? `${Math.abs(days)}d overdue` : `${days}d to go`}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </ChartCard>
  )
}
