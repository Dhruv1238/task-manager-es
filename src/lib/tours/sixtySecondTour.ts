/**
 * The 60-second tour script. Six beats that hit the platform's most
 * differentiating moves — workflow-driven stages, role-aware permissions,
 * and persona-switching as the storytelling device.
 *
 * Steps reference `data-tour-id` attributes sprinkled across the production
 * UI. Steps that need to be on a specific route declare `targetRoute`; the
 * tour driver navigates before highlighting. A small set of steps use
 * `{routeRequiresProjectId: true}` — the orchestrator resolves the seeded
 * Diageo project at tour-start and substitutes its id into the route.
 */

import type { TourStep } from './types'

export const SIXTY_SECOND_TOUR_ID = 'sixty-second'

/** Sentinel — replaced at runtime with the resolved Diageo project id. */
export const DIAGEO_PROJECT_PLACEHOLDER = '__DIAGEO__'

export const SIXTY_SECOND_TOUR: TourStep[] = [
  {
    id: 'dashboard-overview',
    targetSelector: 'home-dashboard',
    targetRoute: '/',
    actAs: 'visitor',
    title: 'Your workspace, populated',
    body: "Sample projects are pre-seeded so you have something real to look at. Opening one now…",
    bodyMobile: 'Sample projects pre-seeded. Opening one now…',
    primaryCta: { label: 'Skip ahead' },
    dwellMs: 5500,
  },
  {
    id: 'project-detail',
    targetSelector: 'project-stage-banner',
    targetRoute: `/projects/${DIAGEO_PROJECT_PLACEHOLDER}`,
    actAs: 'persona-vh-primary',
    title: "Aarti's view — Vertical Head",
    body: "Same project, Aarti's lens. As VH she owns moving this forward — allocations, approvals, and timeline pressure all show up here.",
    primaryCta: { label: 'Next' },
    dwellMs: 9500,
  },
  {
    id: 'designer-perspective',
    targetSelector: 'my-tasks',
    targetRoute: '/me',
    actAs: 'persona-designer-2d',
    title: "Sneha's view — Designer",
    body: "Same data, focused down. Sneha only sees what's assigned to her, with status + due dates at a glance.",
    primaryCta: { label: 'Next' },
    dwellMs: 9000,
  },
  {
    id: 'ct-approval',
    targetSelector: 'review-queue',
    targetRoute: '/me',
    actAs: 'persona-ct-lead',
    title: "Rohan's view — CT Lead",
    body: 'Validators land on their review queue — work to approve, projects awaiting their call, all routed automatically.',
    primaryCta: { label: 'Next' },
    dwellMs: 9000,
  },
  {
    id: 'audit-trail',
    targetSelector: 'project-stage-banner',
    targetRoute: `/projects/${DIAGEO_PROJECT_PLACEHOLDER}`,
    actAs: 'visitor',
    title: 'Back to you — every action audited',
    body: 'Open Project history any time to see who did what, when. Nothing gets lost.',
    primaryCta: { label: 'Wrap up' },
    dwellMs: 8500,
  },
  {
    id: 'wrap-up',
    targetSelector: 'home-dashboard',
    targetRoute: '/',
    actAs: 'visitor',
    title: 'You just ran a full Workflow end-to-end',
    body: 'Build your own workflow, free-roam, or talk to us.',
    manualAdvance: true,
  },
]
