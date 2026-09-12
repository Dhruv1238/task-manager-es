import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret, defineString } from 'firebase-functions/params'
import * as logger from 'firebase-functions/logger'
import { getFirestore } from 'firebase-admin/firestore'
import { FieldValue } from 'firebase-admin/firestore'
import { timingSafeEqual } from 'node:crypto'

import { buildProjectDoc, type WorkflowLike } from './project-doc'

/**
 * Create a project from a won sales lead.
 *
 * The sales portal calls this when a rep closes a deal. It is deliberately an
 * HTTP endpoint rather than a callable: the caller is another Firebase project
 * with its own auth, so there is no shared identity to verify — and the portal
 * reaches us from ITS Cloud Function, never from a browser.
 *
 * WHY A SHARED SECRET AND NOT "no creds":
 * this writes to the projects collection. An open endpoint would let anyone who
 * ever sees the URL — a devtools Network tab, a log line, a pasted link — mint
 * unlimited projects with no attribution. The secret cannot live in the portal's
 * web bundle either (every VITE_* value ships to the browser), which is exactly
 * why the portal calls us server-to-server.
 *
 * The task manager owns what a valid project IS. The portal sends facts about a
 * deal; this function decides how those become a project — which workflow, which
 * entry stage, which access keys. See project-doc.ts.
 */

/** Shared with the portal's own TASK_MANAGER_SECRET. Set on both sides. */
const SALES_PORTAL_SECRET = defineSecret('SALES_PORTAL_SECRET')

/**
 * The identity every hand-over is created under.
 *
 * Always this uid, never the rep's — a project that arrived from the sales
 * portal was created by the integration, and attributing it uniformly is what
 * makes that legible. It must be an existing `/users/{uid}` document, because
 * the UI renders a creator as `userById.get(createdBy)?.displayName ?? '—'`:
 * a uid with no user doc shows an em-dash instead of a name. Give it a
 * `displayName` like "Sales Portal" and the lowest `globalRole` ('user') —
 * nothing ever signs in as it.
 *
 * It is also the only guaranteed member of `accessKeys`, so an unset value is
 * a hard failure rather than a project nobody but a super admin can open.
 */
const CREATOR_UID = defineString('SALES_PORTAL_CREATOR_UID', { default: '' })

/** Used only to hand a deep link back to the portal. Cosmetic. */
const APP_BASE_URL = defineString('TASK_MANAGER_BASE_URL', { default: '' })

/**
 * Workflow aliases the portal is allowed to ask for.
 *
 * The portal sends a stable name; we map it to whichever document currently
 * implements it. That keeps workflow ids — which the authoring UI can slugify
 * and rename — out of the other codebase entirely. Adding the sales or basic
 * workflow later is one line here and needs no portal release.
 */
const WORKFLOW_BY_ALIAS: Record<string, string> = {
  tender: 'collab-default',
}

const DEFAULT_WORKFLOW_ALIAS = 'tender'

interface SalesLeadPayload {
  leadId: string
  title: string
  workflow: string
  description: string
  actorEmail?: string
  actorName?: string
  deadline?: string
  dealValue?: number
  leadUrl?: string
  pocName?: string
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Throws a message safe to return to the caller. */
class BadRequest extends Error {}

function parsePayload(body: unknown): SalesLeadPayload {
  if (typeof body !== 'object' || body === null) {
    throw new BadRequest('Body must be a JSON object')
  }
  const raw = body as Record<string, unknown>

  const leadId = str(raw.leadId)
  if (!leadId) throw new BadRequest('leadId is required')

  const title = str(raw.title)
  if (!title) throw new BadRequest('title is required')

  const workflow = str(raw.workflow) ?? DEFAULT_WORKFLOW_ALIAS
  if (!(workflow in WORKFLOW_BY_ALIAS)) {
    throw new BadRequest(
      `Unknown workflow "${workflow}". Known: ${Object.keys(WORKFLOW_BY_ALIAS).join(', ')}`,
    )
  }

  return {
    leadId,
    title,
    workflow,
    // Never undefined — the app's own create form treats description as
    // required-but-possibly-empty, and the type is a plain string.
    description: str(raw.description) ?? '',
    actorEmail: str(raw.actorEmail)?.toLowerCase(),
    actorName: str(raw.actorName),
    deadline: str(raw.deadline),
    dealValue: num(raw.dealValue),
    leadUrl: str(raw.leadUrl),
    pocName: str(raw.pocName),
  }
}

/**
 * Constant-time secret comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself leak the
 * expected length, so the lengths are compared first and a mismatch is reported
 * as a plain failure.
 */
function secretMatches(presented: string | undefined, expected: string): boolean {
  if (!presented || !expected) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * A project id derived from the lead it came from.
 *
 * Deterministic on purpose: `create()` on a fixed id is atomically idempotent,
 * so a portal retry or a double-click cannot mint a second project for one
 * deal. A "query for an existing sourceLeadId first" check would still race
 * two concurrent requests.
 */
function projectIdForLead(leadId: string): string {
  const safe = leadId.replace(/[^A-Za-z0-9_-]/g, '')
  return `sp_${safe}`.slice(0, 1400)
}

/**
 * The closing rep's uid HERE, when they happen to have an account.
 *
 * Used only to add them to `accessKeys` so they can watch the deal they
 * closed. It never affects `createdBy`, ownership, or any role — a rep with no
 * account here simply does not see the project, which is fine because
 * allocation is an admin's job either way.
 */
async function resolveActorUid(
  db: ReturnType<typeof getFirestore>,
  actorEmail: string | undefined,
): Promise<string | null> {
  if (!actorEmail) return null
  const match = await db.collection('users').where('email', '==', actorEmail).limit(1).get()
  return match.empty ? null : match.docs[0].id
}

export const createProjectFromSales = onRequest(
  { region: 'us-central1', secrets: [SALES_PORTAL_SECRET], cors: false, maxInstances: 5 },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ ok: false, error: 'Use POST' })
      return
    }

    if (!secretMatches(request.get('x-portal-secret'), SALES_PORTAL_SECRET.value())) {
      // Deliberately says nothing about which part failed.
      logger.warn('createProjectFromSales rejected an unauthenticated call')
      response.status(401).json({ ok: false, error: 'Unauthorised' })
      return
    }

    let payload: SalesLeadPayload
    try {
      payload = parsePayload(request.body)
    } catch (error) {
      const message = error instanceof BadRequest ? error.message : 'Malformed body'
      response.status(400).json({ ok: false, error: message })
      return
    }

    const db = getFirestore()
    const workflowId = WORKFLOW_BY_ALIAS[payload.workflow]
    const projectId = projectIdForLead(payload.leadId)
    const baseUrl = APP_BASE_URL.value().trim().replace(/\/+$/, '')
    const projectUrl = baseUrl ? `${baseUrl}/projects/${projectId}` : undefined

    try {
      const workflowSnapshot = await db.doc(`workflows/${workflowId}`).get()
      if (!workflowSnapshot.exists) {
        // A misconfigured tenant, not a bad request — the portal can't fix this.
        logger.error('workflow missing; cannot create project', { workflowId })
        response.status(503).json({
          ok: false,
          error: `This workspace has no "${payload.workflow}" workflow set up yet`,
        })
        return
      }

      const workflow = { ...workflowSnapshot.data(), id: workflowSnapshot.id } as WorkflowLike

      const createdBy = CREATOR_UID.value().trim()
      if (!createdBy) {
        logger.error('SALES_PORTAL_CREATOR_UID is unset; refusing to create an unowned project')
        response.status(503).json({
          ok: false,
          error: 'This workspace has no sales-portal identity configured yet',
        })
        return
      }
      const actorUid = await resolveActorUid(db, payload.actorEmail)

      const projectDoc = buildProjectDoc({
        title: payload.title,
        description: payload.description,
        createdBy,
        workflow,
        deadline: payload.deadline,
        extraViewers: actorUid ? [actorUid] : [],
        // The tender workflow carries a `lead_poc_name` text field; filling it
        // saves the delivery team re-typing what the deal already knew.
        fields: payload.pocName ? { lead_poc_name: payload.pocName } : undefined,
        source: {
          portal: 'sales-portal',
          leadId: payload.leadId,
          leadUrl: payload.leadUrl,
          actorEmail: payload.actorEmail,
          actorName: payload.actorName,
          dealValue: payload.dealValue,
        },
      })

      const batch = db.batch()
      // create(), not set(): this is the idempotency guarantee.
      batch.create(db.doc(`projects/${projectId}`), projectDoc)
      // Mirrors recordAuditEvent() in src/lib/firestore.ts — the app writes one
      // of these on every create, and the audit trail should not have a hole
      // where the integration made projects.
      batch.set(db.collection('auditEvents').doc(), {
        actorId: createdBy,
        actorName: payload.actorName ?? 'Sales portal',
        action: 'project.created',
        targetType: 'project',
        targetId: projectId,
        targetTitle: payload.title,
        projectId,
        payload: {
          workflowId,
          source: 'sales-portal',
          leadId: payload.leadId,
          ...(payload.actorEmail ? { actorEmail: payload.actorEmail } : {}),
        },
        createdAt: FieldValue.serverTimestamp(),
      })

      await batch.commit()

      logger.info('project created from sales lead', {
        projectId,
        leadId: payload.leadId,
        workflowId,
        createdBy,
        actorCanSee: actorUid !== null,
      })

      response.status(201).json({
        ok: true,
        projectId,
        ...(projectUrl ? { url: projectUrl } : {}),
        workflowId,
        createdBy,
        // NOT ownership — nothing is ever assigned here, and the creator is
        // always the integration's own identity. This says only whether the
        // closing rep has an account here and was therefore added to
        // accessKeys, i.e. whether they can see the project at all.
        actorCanSee: actorUid !== null,
        deduped: false,
      })
    } catch (error) {
      // ALREADY_EXISTS (code 6) means this lead already has its project. That
      // is a success from the caller's point of view, not a failure — it is the
      // retry path working as intended.
      if (typeof error === 'object' && error !== null && (error as { code?: number }).code === 6) {
        logger.info('project already existed for lead', { projectId, leadId: payload.leadId })
        response.status(200).json({
          ok: true,
          projectId,
          ...(projectUrl ? { url: projectUrl } : {}),
          deduped: true,
        })
        return
      }

      logger.error('createProjectFromSales failed', {
        leadId: payload.leadId,
        error: error instanceof Error ? error.message : String(error),
      })
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Project creation failed',
      })
    }
  },
)
