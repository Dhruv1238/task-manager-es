import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOrgStructure } from '../../../contexts/AppConfigContext'
import { actorRefKey, describeActorShort } from '../../../lib/actorRefs'
import type { ActorRef, ProjectRoleDef } from '../../../types/workflow'

interface Props {
  // The allowed actor SET. In action mode the FIRST entry is canonical (owns
  // /me inbox routing). super-admin is kept as a locked baseline in action mode.
  value: ActorRef[]
  onChange: (next: ActorRef[]) => void
  projectRoles: ProjectRoleDef[]
  leadRoleName: string
  // Include the "person who created the project" option (default true). The
  // status-permission picker passes false.
  includeCreator?: boolean
  // Action mode: show the locked super-admin baseline + the canonical marker.
  // The status picker (flat ActorRef[]) passes false.
  actionMode?: boolean
  disabled?: boolean
}

interface Choice {
  key: string
  actor: ActorRef
  label: string
}

const SUPER: ActorRef = { kind: 'global_role', role: 'super_admin' }
const isSuper = (a: ActorRef) => a.kind === 'global_role' && a.role === 'super_admin'

// Phase 2d: the plain-English "who can do this" checklist. Ticks write ActorRefs
// into the action's allowed set (canonical = first); the word "permission" never
// appears. Reused by the stage-action sentence and the status-permission picker.
export default function ActionActorsPopover({
  value,
  onChange,
  projectRoles,
  leadRoleName,
  includeCreator = true,
  actionMode = true,
  disabled,
}: Props) {
  const org = useOrgStructure()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // Menu rendered in a portal with fixed positioning so it escapes the editor
  // card's clipping and flips above the trigger when there's no room below.
  const [pos, setPos] = useState<
    | { mode: 'below'; top: number; left: number }
    | { mode: 'above'; bottom: number; left: number }
    | null
  >(null)

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const measure = () => {
      const t = wrapRef.current
      if (!t) return
      const r = t.getBoundingClientRect()
      const est = 330 // header + checklist (max-h-64) + baseline footer
      const spaceBelow = window.innerHeight - r.bottom
      const flip = spaceBelow < est + 8 && r.top > spaceBelow
      setPos(
        flip
          ? { mode: 'above', bottom: window.innerHeight - r.top, left: r.left }
          : { mode: 'below', top: r.bottom, left: r.left },
      )
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onMouse = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouse)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouse)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // The selectable choices (super-admin handled separately as a baseline).
  const choices: Choice[] = []
  for (const role of [...projectRoles].sort((a, b) => a.order - b.order)) {
    choices.push({ key: `project_role:${role.id}`, actor: { kind: 'project_role', roleId: role.id }, label: role.label })
  }
  choices.push({
    key: 'pipeline_role:lead',
    actor: { kind: 'pipeline_role', role: 'lead' },
    label: `The project's ${leadRoleName || 'lead'}`,
  })
  if (org.teamRoles.hasCoordinator) {
    choices.push({ key: 'team_role:coordinator/lead', actor: { kind: 'team_role', role: 'coordinator', member: 'lead' }, label: 'Coordinator Team Lead' })
    choices.push({ key: 'team_role:coordinator/any', actor: { kind: 'team_role', role: 'coordinator', member: 'any' }, label: 'Any Coordinator Team member' })
  }
  if (org.teamRoles.hasValidator) {
    choices.push({ key: 'team_role:validator/lead', actor: { kind: 'team_role', role: 'validator', member: 'lead' }, label: 'Validator Team Lead' })
    choices.push({ key: 'team_role:validator/any', actor: { kind: 'team_role', role: 'validator', member: 'any' }, label: 'Any Validator Team member' })
  }
  if (org.teamRoles.hasSpecialist) {
    choices.push({ key: 'team_role:specialist/lead', actor: { kind: 'team_role', role: 'specialist', member: 'lead' }, label: 'Specialist Team Lead' })
    choices.push({ key: 'team_role:specialist/any', actor: { kind: 'team_role', role: 'specialist', member: 'any' }, label: 'Any Specialist Team member' })
  }
  if (includeCreator) {
    choices.push({ key: 'creator', actor: { kind: 'creator' }, label: 'The person who created the project' })
  }
  choices.push({ key: 'global_role:admin', actor: { kind: 'global_role', role: 'admin' }, label: 'Any global admin' })

  // Non-super entries, in order; super-admin is appended as a baseline in action mode.
  const nonSuper = value.filter((a) => !isSuper(a))
  const compose = (next: ActorRef[]): ActorRef[] => (actionMode ? [...next, SUPER] : next)
  const keyed = new Set(nonSuper.map(actorRefKey))

  function toggle(choice: Choice) {
    if (disabled) return
    const next = keyed.has(choice.key)
      ? nonSuper.filter((a) => actorRefKey(a) !== choice.key)
      : [...nonSuper, choice.actor]
    onChange(compose(next))
  }
  function makeCanonical(choice: Choice) {
    if (disabled || !actionMode) return
    const without = nonSuper.filter((a) => actorRefKey(a) !== choice.key)
    onChange(compose([choice.actor, ...without]))
  }

  const canonicalKey = actionMode && nonSuper[0] ? actorRefKey(nonSuper[0]) : null
  const ctx = { leadRoleName, projectRoles }

  // Trigger pills: the ticked non-super actors (canonical first).
  const pillActors = nonSuper

  return (
    <div ref={wrapRef} className="relative inline-flex flex-wrap items-center gap-1.5">
      {pillActors.length === 0 ? (
        <span className="text-xs italic text-fg-faint">no one yet</span>
      ) : (
        pillActors.map((a, i) => (
          <span
            key={actorRefKey(a)}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              a.kind === 'project_role' ? 'pill-brandtone border' : 'pill-neutral border'
            }`}
            title={actionMode && i === 0 ? 'Gets this in their inbox' : undefined}
          >
            {actionMode && i === 0 && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                <path d="M4 4h16v12H5.17L4 17.17z" />
              </svg>
            )}
            {describeActorShort(a, ctx)}
          </span>
        ))
      )}
      {!disabled && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2 py-0.5 text-xs font-medium text-fg-subtle transition hover:border-brand-edge hover:text-fg"
        >
          + who
        </button>
      )}

      {open && pos &&
        createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            left: pos.left,
            zIndex: 60,
            ...(pos.mode === 'above'
              ? { bottom: pos.bottom + 6 }
              : { top: pos.top + 6 }),
          }}
          className="w-72 overflow-hidden rounded-xl border border-line bg-elevated shadow-2xl"
        >
          <div className="border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Who does this part of the work?
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {choices.map((c) => {
              const on = keyed.has(c.key)
              const isCanonical = canonicalKey === c.key
              return (
                <div
                  key={c.key}
                  className={`flex items-center gap-2 px-3 py-2 text-sm transition ${
                    on ? 'bg-brand-soft text-fg' : 'text-fg-strong hover:bg-fill-2'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(c)}
                    className="flex flex-1 items-center gap-2 text-left"
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        on ? 'border-brand-edge bg-brand-gradient-br' : 'border-line-strong bg-fill-2'
                      }`}
                    >
                      {on && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </span>
                    <span className="flex-1">{c.label}</span>
                  </button>
                  {actionMode && on && (
                    <button
                      type="button"
                      onClick={() => makeCanonical(c)}
                      title="Notify this person in their inbox"
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium transition ${
                        isCanonical
                          ? 'bg-brand-soft text-brand'
                          : 'text-fg-subtle hover:bg-fill-3 hover:text-fg'
                      }`}
                    >
                      {isCanonical ? '● notified' : '○ notify'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          {actionMode && (
            <div className="flex items-center gap-2 border-t border-line bg-fill-1 px-3 py-2 text-xs text-fg-subtle">
              <span className="flex h-4 w-4 items-center justify-center rounded border border-line-strong bg-fill-3 opacity-70">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-fg-subtle">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              Super-admins can always step in
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
