/**
 * Deterministic initials-based avatar generator. Used by the persona switcher
 * and seeded persona docs. Pure function; no network.
 */

const PALETTE = [
  ['#fcd34d', '#92400e'], // amber
  ['#a7f3d0', '#065f46'], // emerald
  ['#bfdbfe', '#1e40af'], // sky
  ['#f5d0fe', '#86198f'], // fuchsia
  ['#fecaca', '#991b1b'], // rose
  ['#c7d2fe', '#3730a3'], // indigo
  ['#fde68a', '#854d0e'], // yellow
  ['#bbf7d0', '#14532d'], // green
  ['#fed7aa', '#9a3412'], // orange
] as const

export interface AvatarSwatch {
  bg: string
  fg: string
  initials: string
}

export function initialsFor(name: string): string {
  const parts = name.split(/[\s@._-]+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function hash(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function sandboxAvatar(seed: string, name?: string): AvatarSwatch {
  const [bg, fg] = PALETTE[hash(seed) % PALETTE.length]
  return { bg, fg, initials: initialsFor(name ?? seed) }
}
