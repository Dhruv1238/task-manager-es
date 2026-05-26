/**
 * Shared loading visual. Used during sandbox boot Phase A/B and persona-switch
 * cinematics. Three-bar pulse with the sandbox accent.
 */

interface Props {
  message?: string
  fullscreen?: boolean
}

export default function SandboxLoader({ message, fullscreen = false }: Props) {
  const inner = (
    <div className="flex flex-col items-center gap-4">
      <div className="flex h-10 items-end gap-1.5" role="status" aria-live="polite">
        <span className="h-2 w-1.5 animate-[sandboxPulse_1s_ease-in-out_infinite] rounded-full bg-[var(--sandbox-accent,#a78bfa)]" />
        <span
          className="h-2 w-1.5 animate-[sandboxPulse_1s_ease-in-out_infinite] rounded-full bg-[var(--sandbox-accent,#a78bfa)]"
          style={{ animationDelay: '0.15s' }}
        />
        <span
          className="h-2 w-1.5 animate-[sandboxPulse_1s_ease-in-out_infinite] rounded-full bg-[var(--sandbox-accent,#a78bfa)]"
          style={{ animationDelay: '0.3s' }}
        />
      </div>
      {message ? (
        <div className="text-sm text-fg-muted" aria-hidden>
          {message}
        </div>
      ) : null}
    </div>
  )

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-canvas/95 backdrop-blur-sm">
        {inner}
      </div>
    )
  }
  return inner
}
