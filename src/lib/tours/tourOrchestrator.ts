/**
 * Thin orchestration layer the TourOverlay calls between steps. Wraps
 * `performAction` from the workflow engine so the tour can advance project
 * stages programmatically without the visitor clicking through every UI affordance.
 *
 * On error: log + signal a "skip ahead" fallback. The overlay surfaces a soft
 * "Continuing…" toast rather than dead-locking.
 */

import { performAction } from '../workflowEvaluator'
import { tenantDoc } from '../firestore'
import { getDoc } from 'firebase/firestore'
import type { Project, User } from '../../types/models'
import type { Workflow } from '../../types/workflow'

interface RunOpts {
  actionId: string
  projectId: string
  user: User
  inputs?: Record<string, unknown>
}

export async function runTourAction(opts: RunOpts): Promise<{ ok: boolean; error?: string }> {
  try {
    const projSnap = await getDoc(tenantDoc('projects', opts.projectId))
    if (!projSnap.exists()) return { ok: false, error: 'Project not found' }
    const project = { id: projSnap.id, ...projSnap.data() } as Project

    let workflow = project.pinnedWorkflow as Workflow | undefined
    if (!workflow && project.workflowId) {
      const wfSnap = await getDoc(tenantDoc('workflows', project.workflowId))
      if (wfSnap.exists()) workflow = wfSnap.data() as Workflow
    }
    if (!workflow) return { ok: false, error: 'Workflow not loaded' }

    await performAction({
      project,
      workflow,
      user: opts.user,
      actionId: opts.actionId,
      inputs: opts.inputs ?? {},
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
