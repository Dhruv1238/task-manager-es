/**
 * Every person-facing string on the My Tasks surface, in one place.
 *
 * The same components serve two audiences: /me, where the reader IS the person
 * ("Assigned to me", "the workflow is blocked on you"), and
 * /admin/member-tasks, where they are looking at somebody else and that
 * wording would be actively misleading. Rather than fork the components, the
 * page picks a voice and the copy follows.
 *
 * Third-person wording uses the person's NAME, never a pronoun: we don't know
 * anyone's pronouns from a user doc, and a name is both unambiguous and
 * friendlier than "they" repeated down a page.
 */

export interface MyTasksCopy {
  // Stat tiles
  openSub: string
  doneSub: string
  ledSub: string
  overdueSub: string
  pendingSub: string
  // Pending actions
  pendingDescription: string
  reviewHeading: string
  projectsHeading: string
  pendingEmpty: string
  // Assigned
  assignedTitle: string
  assignedEmptyNothing: string
  assignedEmptyHint: string
  assignedEmptyCaught: string
  assignedEmptyHidden: string
  assignedEmptyToggle: string
  // Led
  ledTitle: string
  ledDescription: string
  ledEmpty: string
  // Charts
  statusTitle: string
  /** Donut subtitle, picked by the "Show completed" toggle. */
  statusSubtitleOpen: string
  statusSubtitleAll: string
}

const FIRST_PERSON: MyTasksCopy = {
  openSub: 'Assigned to you, still live',
  doneSub: 'Completed work',
  ledSub: 'Open on teams you lead',
  overdueSub: 'Past due, still open',
  pendingSub: 'Reviews and projects',

  pendingDescription: 'The workflow is blocked on you. Review a task or move a project forward.',
  reviewHeading: 'Awaiting my review',
  projectsHeading: 'Projects awaiting my action',
  pendingEmpty: 'Nothing is waiting on you.',

  assignedTitle: 'Assigned to me',
  assignedEmptyNothing: 'Nothing assigned to you yet',
  assignedEmptyHint: 'When a team lead delegates a subtask to you, it will show up here.',
  assignedEmptyCaught: 'All caught up',
  assignedEmptyHidden:
    'Some tasks are hidden because their project has been submitted — turn on "Show submitted" to see them.',
  assignedEmptyToggle: 'Toggle "Show completed" to see what you finished.',

  ledTitle: 'Led by me',
  ledDescription:
    "Team-level tasks on teams where you're the lead. You own delegation for these.",
  ledEmpty: 'No open team-level tasks on the teams you lead.',

  statusTitle: 'Your status breakdown',
  statusSubtitleOpen: 'Open tasks across everything on your plate',
  statusSubtitleAll: 'Everything on your plate, finished work included',
}

/**
 * `name` omitted (or empty) = the reader is the person. Pass a display name to
 * describe somebody else's plate.
 */
export function myTasksCopy(name?: string): MyTasksCopy {
  const who = name?.trim()
  if (!who) return FIRST_PERSON

  return {
    openSub: `Assigned to ${who}, still live`,
    doneSub: 'Completed work',
    ledSub: `Open on teams ${who} leads`,
    overdueSub: 'Past due, still open',
    pendingSub: 'Reviews and projects',

    pendingDescription: `The workflow is blocked on ${who} — these are waiting for a review or a decision.`,
    reviewHeading: `Awaiting ${who}'s review`,
    projectsHeading: `Projects awaiting ${who}'s action`,
    pendingEmpty: `Nothing is waiting on ${who}.`,

    assignedTitle: `Assigned to ${who}`,
    assignedEmptyNothing: `Nothing assigned to ${who} yet`,
    assignedEmptyHint: `When a team lead delegates a subtask to ${who}, it will show up here.`,
    assignedEmptyCaught: 'All caught up',
    assignedEmptyHidden:
      'Some tasks are hidden because their project has been submitted — turn on "Show submitted" to see them.',
    assignedEmptyToggle: `Toggle "Show completed" to see what ${who} finished.`,

    ledTitle: `Led by ${who}`,
    ledDescription: `Team-level tasks on teams ${who} leads, including delegation.`,
    ledEmpty: `No open team-level tasks on the teams ${who} leads.`,

    statusTitle: `${who}'s status breakdown`,
    statusSubtitleOpen: `Open tasks across everything on ${who}'s plate`,
    statusSubtitleAll: `Everything on ${who}'s plate, finished work included`,
  }
}
