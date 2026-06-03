import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, AlertTriangle, ChevronRight } from 'lucide-react'
import type { FlowValidationResult } from '../../../lib/flowValidation'
import type { ValidationIssue } from '../../../lib/workflowValidation'

export interface ValidationSummaryProps {
  validation: FlowValidationResult
  onJump: (stageId: string | null) => void
}

// Max rows rendered per group before collapsing to a "+N more" line, so the
// panel never silently hides issues.
const GROUP_CAP = 10

function issueStageId(issue: ValidationIssue): string | null {
  if (issue.scope.kind === 'stage') return issue.scope.stageId
  if (issue.scope.kind === 'action') return issue.scope.stageId
  return null
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// One titled group ("Must fix" / "Suggestions"). Errors block publish; warnings
// never do — the title + tone make that explicit so a non-zero warning count is
// never mistaken for required work.
function IssueGroup({
  title,
  count,
  tone,
  issues,
  onJump,
}: {
  title: string
  count: number
  tone: 'error' | 'warn'
  issues: ValidationIssue[]
  onJump: (stageId: string | null) => void
}) {
  const shown = issues.slice(0, GROUP_CAP)
  const extra = issues.length - shown.length
  const headCls = tone === 'error' ? 'text-tone-danger-fg' : 'text-tone-warn-fg'
  const dotCls = tone === 'error' ? 'bg-[var(--color-danger-dot)]' : 'bg-[var(--color-warn-dot)]'

  return (
    <div className="space-y-1">
      <div
        className={`flex items-center gap-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wider ${headCls}`}
      >
        {title}
        <span className="font-normal normal-case tracking-normal text-fg-faint">· {count}</span>
      </div>
      {shown.map((issue, i) => {
        const sid = issueStageId(issue)
        return (
          <button
            key={i}
            type="button"
            onClick={() => onJump(sid)}
            className="flex w-full items-start gap-1.5 rounded-md border border-line bg-fill-1 px-2 py-1.5 text-left text-[11px] transition hover:bg-fill-2"
          >
            <span className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotCls}`} />
            <span className="flex-1 text-fg-muted">{issue.message}</span>
            {sid && <ChevronRight size={12} className="mt-0.5 shrink-0 text-fg-faint" />}
          </button>
        )
      })}
      {extra > 0 && <div className="px-2 text-[10px] text-fg-faint">+{extra} more</div>}
    </div>
  )
}

export function ValidationSummary({ validation, onJump }: ValidationSummaryProps) {
  const { errors, warnings } = validation
  const total = errors.length + warnings.length

  return (
    <AnimatePresence>
      <motion.div
        key={`${errors.length}-${warnings.length}`}
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="nopan nodrag node-glass absolute bottom-4 left-4 z-10 w-[20rem] max-w-[80vw] rounded-2xl p-3"
      >
        {total === 0 ? (
          <div className="flex items-center gap-2 text-sm text-tone-success-fg">
            <CheckCircle2 size={15} /> No issues — ready to publish.
          </div>
        ) : (
          <div className="space-y-2">
            {/* Adaptive headline: flips from "must fix" (blocks publish) to
                "Ready to publish" the moment errors hit zero, so leftover
                warnings never read as required work. */}
            {errors.length > 0 ? (
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider">
                <AlertTriangle size={13} className="shrink-0 text-tone-danger-fg" />
                <span className="text-tone-danger-fg">{errors.length} must fix</span>
                {warnings.length > 0 && (
                  <span className="normal-case tracking-normal text-fg-subtle">
                    · {plural(warnings.length, 'suggestion')}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs font-medium">
                <CheckCircle2 size={13} className="shrink-0 text-tone-success-fg" />
                <span className="uppercase tracking-wider text-tone-success-fg">
                  Ready to publish
                </span>
                <span className="text-fg-subtle">
                  · {plural(warnings.length, 'optional suggestion')}
                </span>
              </div>
            )}

            <div className="scrollbar-themed max-h-44 space-y-2 overflow-y-auto">
              {errors.length > 0 && (
                <IssueGroup
                  title="Must fix"
                  count={errors.length}
                  tone="error"
                  issues={errors}
                  onJump={onJump}
                />
              )}
              {warnings.length > 0 && (
                <IssueGroup
                  title="Suggestions (optional)"
                  count={warnings.length}
                  tone="warn"
                  issues={warnings}
                  onJump={onJump}
                />
              )}
            </div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
