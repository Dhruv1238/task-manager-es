import { useState } from 'react'
import type { ValidationIssue, ValidationResult } from '../../../lib/workflowValidation'

interface Props {
  result: ValidationResult
  // Click-to-jump: tells the parent to select a stage / action in the panel.
  onJump: (issue: ValidationIssue) => void
}

// Phase 2c: sticky bottom-of-editor validation surface.
// - When there are no issues, render a quiet inline status pill — explicitly
//   NOT button-shaped so it doesn't read as "click me to proceed."
// - When there are issues, render an expandable panel with per-issue rows that
//   click-jump into the stage editor.
export default function ValidationPanel({ result, onJump }: Props) {
  const { errors, warnings } = result
  const ok = errors.length === 0 && warnings.length === 0
  const [expanded, setExpanded] = useState(errors.length > 0)

  if (ok) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="sticky bottom-0 z-10 flex items-center justify-center gap-2 rounded-full border border-tone-success-bd/40 bg-tone-success-bg/30 px-4 py-2 text-xs text-fg-subtle"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-tone-success-fg"
          aria-hidden
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span>
          <span className="text-tone-success-fg">No issues.</span> Save & Activate when
          you're ready.
        </span>
      </div>
    )
  }

  return (
    <div
      className={`sticky bottom-0 z-10 rounded-2xl border bg-card shadow-lg ${
        errors.length > 0 ? 'border-tone-danger-bd' : 'border-tone-warn-bd'
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-fg">
          {errors.length > 0 ? (
            <span className="text-tone-danger-fg">
              ⚠ {errors.length} error{errors.length === 1 ? '' : 's'}
              {warnings.length > 0
                ? ` · ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`
                : ''}
            </span>
          ) : (
            <span className="text-tone-warn-fg">
              ⚠ {warnings.length} warning{warnings.length === 1 ? '' : 's'}
            </span>
          )}
        </span>
        <span className="text-xs text-fg-subtle">{expanded ? 'Hide' : 'Show details'}</span>
      </button>
      {expanded && (
        <ul className="space-y-1 border-t border-line px-4 py-3 text-sm">
          {[...errors, ...warnings].map((issue, idx) => (
            <li key={idx}>
              <button
                type="button"
                onClick={() => onJump(issue)}
                className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-fg-muted transition hover:bg-fill-2 hover:text-fg"
              >
                <span
                  className={`mr-2 inline-block h-2 w-2 rounded-full align-middle ${
                    issue.severity === 'error' ? 'bg-tone-danger-fg' : 'bg-tone-warn-fg'
                  }`}
                  aria-hidden
                />
                {issue.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
