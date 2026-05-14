import type { User } from '../../types/models'

interface Props {
  user?: Pick<User, 'displayName' | 'email'> | null
  // Backup props for when a full user doc isn't on hand (e.g., the author's
  // profile was evicted from the cache). Either `user` or `name` is required.
  name?: string
  email?: string
  size?: number
  className?: string
}

function initials(name: string | undefined, email: string | undefined): string {
  const src = name || email || '?'
  const parts = src.split(/[\s@._-]+/).filter(Boolean)
  return (
    parts
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
}

export default function Avatar({ user, name, email, size = 32, className }: Props) {
  const resolvedName = user?.displayName ?? name
  const resolvedEmail = user?.email ?? email
  return (
    <div
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-brand-gradient-br font-semibold text-white ${
        className ?? ''
      }`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden
    >
      {initials(resolvedName, resolvedEmail)}
    </div>
  )
}
