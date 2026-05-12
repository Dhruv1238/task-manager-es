import { useTheme, type ThemeMode } from '../contexts/ThemeContext'

const NEXT_LABEL: Record<ThemeMode, string> = {
  dark: 'Switch to light theme',
  light: 'Switch to system theme',
  system: 'Switch to dark theme',
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

function MonitorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="14" rx="2" />
      <path d="M8 22h8M12 18v4" />
    </svg>
  )
}

export default function ThemeToggle() {
  const { mode, cycle } = useTheme()
  const icon = mode === 'system' ? <MonitorIcon /> : mode === 'light' ? <SunIcon /> : <MoonIcon />

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={NEXT_LABEL[mode]}
      title={NEXT_LABEL[mode]}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-fill-2 text-fg-muted transition hover:bg-fill-3 hover:text-fg focus:border-brand-edge focus:outline-none focus:ring-2 focus:ring-brand-ring"
    >
      {icon}
    </button>
  )
}
