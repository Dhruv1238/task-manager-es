import { useEffect, useState } from 'react'
import { CloudOff, RefreshCw, UploadCloud } from 'lucide-react'
import { useFeature } from '../contexts/AppConfigContext'
import {
  useSyncHealth,
  type SyncHealthStatus,
} from '../hooks/useSyncHealth'

/**
 * Full-screen, non-dismissible guard shown when the connection is down or
 * locally-queued writes aren't reaching the server. Exists because of a real
 * incident: a project created mid-outage lived only in the local cache for
 * four days while its creator kept working on it; the queue flushed later
 * with server timestamps days after the embedded ones. Blocking beats
 * silently diverging.
 *
 * Mounted in App.tsx beside <Routes> — the only spot that covers /login too.
 * Gated by the org-wide `syncGuard` feature toggle (default off), which
 * doubles as the remote kill switch if it ever misfires. Sits at z-[110],
 * above every surface in the ladder (Modal 50 … CrossEnvGuard 90,
 * PrintingOverlay 100).
 */

const COPY: Record<
  Exclude<SyncHealthStatus, 'healthy'>,
  { title: string; body: string }
> = {
  offline: {
    title: "You're offline",
    body: 'Reconnect to keep working. Recent changes are saved on this device and will sync automatically when the connection returns.',
  },
  stalled: {
    title: "Your changes aren't reaching the server",
    body: "You appear online, but saves aren't being confirmed. Check your connection (VPN, hotel wifi login, firewall). Don't close this tab — unsynced changes are still waiting.",
  },
  flushing: {
    title: 'Syncing changes from your last session',
    body: 'Some changes saved on this device never reached the server. Hold on while they finish syncing — this keeps timestamps and project history consistent.',
  },
}

function elapsedLabel(sinceMs: number, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - sinceMs) / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

export default function SyncGuardOverlay() {
  const enabled = useFeature('syncGuard')
  const { status, sinceMs } = useSyncHealth(enabled)

  // 1s ticker for the elapsed label — runs only while the overlay is up.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (status === 'healthy') return
    const t = setInterval(() => setNowMs(Date.now()), 1_000)
    return () => clearInterval(t)
  }, [status])

  if (!enabled || status === 'healthy') return null

  const copy = COPY[status]
  const Icon = status === 'offline' ? CloudOff : UploadCloud

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-canvas/90 p-4 backdrop-blur-2xl backdrop-saturate-150"
      role="alertdialog"
      aria-modal="true"
      aria-live="assertive"
      aria-label={copy.title}
    >
      <div className="w-full max-w-md rounded-2xl border border-line bg-elevated p-6 shadow-2xl">
        <div className="flex items-start gap-4">
          <span
            className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-tone-warn-bd bg-tone-warn-bg text-tone-warn-fg"
            aria-hidden
          >
            <Icon size={20} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-fg">{copy.title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{copy.body}</p>
            {sinceMs !== null && (
              <p className="mt-3 font-mono text-xs text-fg-subtle" aria-hidden>
                {status === 'flushing' ? 'syncing' : status} for {elapsedLabel(sinceMs, nowMs)}
                <span className="ml-1 inline-block h-3 w-3 animate-spin rounded-full border-2 border-line-strong border-t-fg-strong align-[-2px] motion-reduce:animate-none" />
              </p>
            )}
            {status === 'stalled' && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-line bg-fill-2 px-3.5 py-2 text-sm font-medium text-fg transition hover:bg-fill-4"
              >
                <RefreshCw size={14} aria-hidden />
                Reload
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
