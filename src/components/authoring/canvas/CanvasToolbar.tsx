import { useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import { motion } from 'framer-motion'
import { Network, Maximize2, CheckCircle2, AlertTriangle, Rocket, Plus, Flag, Copy, SlidersHorizontal, Download, Upload } from 'lucide-react'
import type { FlowValidationResult } from '../../../lib/flowValidation'

export interface CanvasToolbarProps {
  flowName: string
  flowTypeLabel?: string
  validation: FlowValidationResult
  publishing?: boolean
  readOnly?: boolean
  isNew?: boolean
  onAutoLayout: () => void
  onAddTask: () => void
  onAddTerminal: () => void
  onPublish: () => void
  onRenameFlow?: (name: string) => void
  onDuplicate?: () => void
  onOpenSettings?: () => void
  // Download the current flow as a single-workflow JSON export.
  onExport?: () => void
  // Load a workflow JSON file onto the canvas (loads into the draft for review).
  onImport?: (file: File) => void
}

export function CanvasToolbar({
  flowName,
  flowTypeLabel,
  validation,
  publishing,
  readOnly,
  isNew,
  onAutoLayout,
  onAddTask,
  onAddTerminal,
  onPublish,
  onRenameFlow,
  onDuplicate,
  onOpenSettings,
  onExport,
  onImport,
}: CanvasToolbarProps) {
  const rf = useReactFlow()
  const importInputRef = useRef<HTMLInputElement>(null)
  const errorCount = validation.errors.length

  return (
    <motion.div
      initial={{ y: -12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="nopan nodrag node-glass absolute left-4 right-4 top-4 z-10 flex items-center gap-2 rounded-2xl px-3 py-2"
    >
      <div className="min-w-0 flex-1">
        {!readOnly && onRenameFlow ? (
          <input
            value={flowName}
            onChange={(e) => onRenameFlow(e.target.value)}
            placeholder="Name this flow…"
            className="w-full max-w-xs rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-fg outline-none transition hover:border-line focus:border-brand-edge focus:bg-fill-2"
          />
        ) : (
          <div className="truncate text-sm font-semibold text-fg">{flowName || 'Untitled flow'}</div>
        )}
        {flowTypeLabel && <div className="px-1 text-[11px] text-fg-subtle">{flowTypeLabel}</div>}
      </div>

      {!readOnly && (
        <>
          <ToolButton onClick={onAddTask} icon={<Plus size={15} />} label="Add task" />
          <ToolButton onClick={onAddTerminal} icon={<Flag size={15} />} label="Add ending" />
          {onOpenSettings && (
            <ToolButton
              onClick={onOpenSettings}
              icon={<SlidersHorizontal size={15} />}
              label="Fields & roles"
            />
          )}
          <span className="mx-1 h-5 w-px bg-line" />
        </>
      )}

      <ToolButton onClick={onAutoLayout} icon={<Network size={15} />} label="Auto-arrange" />
      <ToolButton
        onClick={() => rf.fitView({ padding: 0.25, duration: 400 })}
        icon={<Maximize2 size={15} />}
        label="Fit view"
      />

      {(onExport || (onImport && !readOnly)) && <span className="mx-1 h-5 w-px bg-line" />}
      {onExport && <ToolButton onClick={onExport} icon={<Download size={15} />} label="Export" />}
      {onImport && !readOnly && (
        <>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onImport(f)
              e.target.value = ''
            }}
          />
          <ToolButton
            onClick={() => importInputRef.current?.click()}
            icon={<Upload size={15} />}
            label="Import"
          />
        </>
      )}

      <span className="mx-1 h-5 w-px bg-line" />

      {/* Validation chip */}
      {errorCount === 0 ? (
        <span className="inline-flex items-center gap-1 rounded-md pill-success border-transparent px-2 py-1 text-xs font-medium">
          <CheckCircle2 size={13} /> Ready
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-md pill-danger border-transparent px-2 py-1 text-xs font-medium">
          <AlertTriangle size={13} /> {errorCount} issue{errorCount === 1 ? '' : 's'}
        </span>
      )}

      {readOnly && onDuplicate ? (
        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          onClick={onDuplicate}
          title="System flows are read-only — duplicate to edit on the canvas"
          className="ml-1 inline-flex items-center gap-1.5 rounded-lg bg-brand-gradient px-3.5 py-2 text-sm font-medium text-white shadow-md shadow-purple-900/30 transition hover-brand-gradient"
        >
          <Copy size={15} /> Duplicate to edit
        </motion.button>
      ) : (
        !readOnly && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            disabled={!validation.publishable || publishing}
            onClick={onPublish}
            title={
              validation.publishable
                ? 'Publish this flow'
                : validation.errors[0]?.message ?? 'Resolve the issues to publish'
            }
            className="ml-1 inline-flex items-center gap-1.5 rounded-lg bg-brand-gradient px-3.5 py-2 text-sm font-medium text-white shadow-md shadow-purple-900/30 transition hover-brand-gradient disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Rocket size={15} /> {publishing ? 'Publishing…' : isNew ? 'Create flow' : 'Publish'}
          </motion.button>
        )
      )}
    </motion.div>
  )
}

function ToolButton({
  onClick,
  icon,
  label,
}: {
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-fill-2 px-2.5 py-1.5 text-xs text-fg-muted transition hover:bg-fill-3 hover:text-fg"
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}
