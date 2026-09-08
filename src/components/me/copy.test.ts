import { describe, expect, it } from 'vitest'
import { myTasksCopy, type MyTasksCopy } from './copy'

// Every string the two My Tasks surfaces show a person. The risk this guards
// is narrow but real: the third-person voice is selected by a NON-EMPTY name,
// so a blank displayName silently reverts the admin view to "Assigned to me",
// and a newly added string is easy to write in first person by habit.

const FIRST_PERSON_WORD = /\b(you|your|yours|my|me)\b/i

function values(c: MyTasksCopy): [string, string][] {
  return Object.entries(c) as [string, string][]
}

describe('myTasksCopy', () => {
  it('speaks in first person when nobody is named', () => {
    const c = myTasksCopy()
    expect(c.assignedTitle).toBe('Assigned to me')
    expect(c.ledTitle).toBe('Led by me')
    expect(c.pendingEmpty).toBe('Nothing is waiting on you.')
  })

  it('treats an empty or whitespace name as first person, not as a blank name', () => {
    // Documents the fallback deliberately: callers that can produce an empty
    // name (a member with no displayName) must supply their own label, which
    // is why MemberTasks falls through displayName -> email -> "this member".
    for (const blank of [undefined, '', '   ']) {
      expect(myTasksCopy(blank).assignedTitle).toBe('Assigned to me')
    }
  })

  it('names the person in every place the first-person voice referred to the reader', () => {
    const c = myTasksCopy('Sneha')
    expect(c.assignedTitle).toBe('Assigned to Sneha')
    expect(c.ledTitle).toBe('Led by Sneha')
    expect(c.reviewHeading).toBe("Awaiting Sneha's review")
    expect(c.projectsHeading).toBe("Projects awaiting Sneha's action")
    expect(c.pendingEmpty).toBe('Nothing is waiting on Sneha.')
    expect(c.statusTitle).toBe("Sneha's status breakdown")
  })

  it('never addresses the reader as the person once someone is named', () => {
    // The real regression guard: a string added to the third-person map in
    // first person ("what you finished") would tell an admin that someone
    // else's plate is their own.
    for (const [key, text] of values(myTasksCopy('Sneha'))) {
      expect(FIRST_PERSON_WORD.test(text), `${key}: ${text}`).toBe(false)
    }
  })

  it('trims the supplied name so padding cannot leak into the copy', () => {
    expect(myTasksCopy('  Sneha  ').assignedTitle).toBe('Assigned to Sneha')
  })

  it('covers the same keys in both voices', () => {
    expect(Object.keys(myTasksCopy('Sneha')).sort()).toEqual(Object.keys(myTasksCopy()).sort())
  })
})
