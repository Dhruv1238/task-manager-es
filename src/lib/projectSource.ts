import type { Project } from '../types/models'

/**
 * Attribution for a project that arrived from another Eventstrat app.
 *
 * These projects are written by a Cloud Function rather than a signed-in
 * person, so `createdBy` is a real uid only because `accessKeys` needs one —
 * it names whoever the integration is configured to file under, not who
 * actually decided to create it. Both "Created by" surfaces resolve that uid
 * through the users directory, so without this the honest answer would be
 * whichever colleague happens to be configured, and a workspace with no
 * matching user doc would render a bare em-dash.
 *
 * Keyed off `sourcePortal`, which the creating function stamps on the document.
 */
const SOURCE_LABELS: Record<string, string> = {
  'sales-portal': 'Sales Portal',
}

/** The label to show instead of a person, or null for a normal project. */
export function projectSourceLabel(
  project: Pick<Project, 'sourcePortal'>,
): string | null {
  const source = project.sourcePortal
  if (!source) return null
  // An unknown source still beats an em-dash: show the raw key rather than
  // pretending a project nobody here created was created by nobody.
  return SOURCE_LABELS[source] ?? source
}
