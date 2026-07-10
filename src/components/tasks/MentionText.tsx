import { Fragment, useMemo } from 'react'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface Segment {
  text: string
  mention: boolean
}

// Split `text` into plain / mention segments. A mention is '@<name>' for any of
// the given display names, requiring a following whitespace or end-of-string so
// "@Jon" doesn't match inside "@Jonathan". Names are matched longest-first so
// the longer name wins when one is a prefix of another.
function buildSegments(text: string, names: string[]): Segment[] {
  const unique = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length)
  if (unique.length === 0) return [{ text, mention: false }]
  const pattern = unique.map(escapeRegExp).join('|')
  const re = new RegExp(`@(?:${pattern})(?=\\s|$)`, 'g')
  const segs: Segment[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0
    if (start > last) segs.push({ text: text.slice(last, start), mention: false })
    segs.push({ text: m[0], mention: true })
    last = start + m[0].length
  }
  if (last < text.length) segs.push({ text: text.slice(last), mention: false })
  return segs
}

interface Props {
  text: string
  names: string[]
  chipClassName: string
}

// Renders text with @mention tokens wrapped in a styled chip. Used both for the
// live composer highlight overlay and for displayed comments — the caller passes
// the chip styling. IMPORTANT for the overlay: chip styling must not change text
// metrics (no padding/margin/font-weight), or it desyncs from the textarea.
export default function MentionText({ text, names, chipClassName }: Props) {
  const segments = useMemo(() => buildSegments(text, names), [text, names])
  return (
    <>
      {segments.map((s, i) =>
        s.mention ? (
          <span key={i} className={chipClassName}>
            {s.text}
          </span>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        ),
      )}
    </>
  )
}
