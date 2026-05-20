interface Props {
  onBack?: () => void
  onSkip?: () => void
  // Optional override for the "Skip" button label — used by the workflow
  // wizard's onboarding mode to read "I'll do this later — use Simple Project".
  skipLabel?: string
  onPrimary: () => void
  primaryLabel: string
  primaryDisabled?: boolean
  primarySubmitting?: boolean
}

// Footer row shown at the bottom of every step. Back is omitted on step 1;
// Skip is omitted on the review step. Primary is always the rightmost CTA.
export default function WizardFooter({
  onBack,
  onSkip,
  skipLabel = 'Skip',
  onPrimary,
  primaryLabel,
  primaryDisabled = false,
  primarySubmitting = false,
}: Props) {
  return (
    <div className="flex items-center justify-end gap-3 pt-1">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          disabled={primarySubmitting}
          className="rounded-full border border-line bg-fill-2 px-5 py-2.5 text-sm font-medium text-fg-muted transition hover:bg-fill-4 disabled:opacity-50"
        >
          Back
        </button>
      )}
      {onSkip && (
        <button
          type="button"
          onClick={onSkip}
          disabled={primarySubmitting}
          className="rounded-full border border-line bg-fill-2 px-5 py-2.5 text-sm font-medium text-fg-muted transition hover:bg-fill-4 disabled:opacity-50"
        >
          {skipLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onPrimary}
        disabled={primaryDisabled || primarySubmitting}
        className="rounded-full bg-brand-gradient px-6 py-2.5 text-sm font-medium text-white shadow-lg shadow-purple-900/30 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-50"
      >
        {primarySubmitting ? (
          <span className="inline-flex items-center gap-2">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            Saving…
          </span>
        ) : (
          primaryLabel
        )}
      </button>
    </div>
  )
}
