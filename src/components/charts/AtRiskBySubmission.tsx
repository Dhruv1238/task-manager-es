import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import ChartCard from './ChartCard'
import { STAGE_TONE, displayedPhase } from '../tender/stageStyle'
import { isProjectLive } from '../../lib/projectStatus'
import type { Project } from '../../types/models'

interface Props {
  projects: Project[]
}

// Tenders within 7 days of submission and not yet delivered (delta §6.5).
export default function AtRiskBySubmission({ projects }: Props) {
  const items = useMemo(() => {
    const now = Date.now()
    const horizon = 7 * 24 * 3600 * 1000
    return projects
      .filter((p) => isProjectLive(p.status) && p.stage !== 10 && p.submissionDate)
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
      <ul className="divide-y divide-white/5 overflow-y-auto pr-1">
        {items.map(({ p, days }) => {
          const phase = displayedPhase(p)
          const tone = STAGE_TONE[phase.toneStage]
          const overdue = days < 0
          return (
            <li key={p.id}>
              <Link
                to={`/projects/${p.id}`}
                className="flex items-center justify-between gap-3 px-2 py-3 transition hover:bg-white/2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white">{p.title}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-white/55">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${tone.pill}`}>
                      <span className={`h-1 w-1 rounded-full ${tone.dot}`} aria-hidden />
                      {phase.shortLabel}
                    </span>
                  </div>
                </div>
                <span className={`text-xs font-medium ${overdue ? 'text-red-300' : days < 3 ? 'text-amber-200' : 'text-white/60'}`}>
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
