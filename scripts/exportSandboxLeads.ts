/**
 * Sandbox leads CSV exporter. Runs locally; uses the Firebase Admin SDK to
 * read /leads/ in the sandbox Firebase project and write a timestamped CSV.
 *
 * Setup:
 *   1. Download the sandbox project's service account JSON from the Firebase
 *      console and save it as `scripts/sandbox-sa.json` (gitignored).
 *   2. Install firebase-admin if not already: `npm i -D firebase-admin`
 *   3. Run: `npx tsx scripts/exportSandboxLeads.ts [--engagementMin=3] [--out=path.csv]`
 *
 * Filters:
 *   --engagementMin=<N>   Only include leads with engagementMinutes >= N
 *   --stage=<stage>       Only include leads that captured <stage>
 *   --since=<YYYY-MM-DD>  Only include leads captured on/after this date
 *   --out=<path>          Output path (default: ./leads-<timestamp>.csv)
 */

import { writeFileSync } from 'fs'
import { join } from 'path'

interface Args {
  engagementMin?: number
  stage?: string
  since?: Date
  out?: string
}

function parseArgs(argv: string[]): Args {
  const args: Args = {}
  for (const a of argv.slice(2)) {
    const [key, val] = a.startsWith('--') ? a.slice(2).split('=') : [a, '']
    if (key === 'engagementMin') args.engagementMin = Number(val)
    else if (key === 'stage') args.stage = val
    else if (key === 'since') args.since = new Date(val)
    else if (key === 'out') args.out = val
  }
  return args
}

const COLUMNS = [
  'email',
  'name',
  'company',
  'role',
  'intent',
  'wantsCallback',
  'wantsRecap',
  'capturedStages',
  'engagementMinutes',
  'actionsCompleted',
  'tourCompleted',
  'sessionsCount',
  'lastActiveAt',
  'capturedAt',
  'visitorUid',
]

function csvEscape(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

async function main() {
  const args = parseArgs(process.argv)

  // Lazy-import so the script doesn't require firebase-admin to be installed
  // when reading the file (this script is checked in but not part of the app
  // bundle).
  let admin: typeof import('firebase-admin')
  try {
    admin = await import('firebase-admin')
  } catch {
    console.error('firebase-admin is not installed. Run: npm i -D firebase-admin tsx')
    process.exit(1)
  }

  const saPath = join(process.cwd(), 'scripts', 'sandbox-sa.json')
  let cert: import('firebase-admin').ServiceAccount
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cert = require(saPath)
  } catch {
    console.error(`Missing service account at ${saPath}. Download it from the Firebase console and save as scripts/sandbox-sa.json.`)
    process.exit(1)
  }

  admin.initializeApp({ credential: admin.credential.cert(cert) })
  const db = admin.firestore()

  let query: FirebaseFirestore.Query = db.collection('leads')
  if (args.since) {
    query = query.where('capturedAt', '>=', admin.firestore.Timestamp.fromDate(args.since))
  }

  const snap = await query.get()
  const rows: string[] = [COLUMNS.join(',')]
  let included = 0

  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>
    const engagementMin = (d.engagementMinutes as number | undefined) ?? 0
    if (args.engagementMin != null && engagementMin < args.engagementMin) continue
    const stages = (d.capturedStages as string[] | undefined) ?? []
    if (args.stage && !stages.includes(args.stage)) continue
    rows.push(
      COLUMNS.map((c) => {
        const v = d[c]
        if (Array.isArray(v)) return csvEscape(v.join(';'))
        if (v && typeof v === 'object' && 'toDate' in (v as object)) {
          return csvEscape((v as { toDate: () => Date }).toDate().toISOString())
        }
        return csvEscape(v)
      }).join(','),
    )
    included++
  }

  const outPath = args.out ?? `leads-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
  writeFileSync(outPath, rows.join('\n') + '\n', 'utf8')
  console.log(`Wrote ${included} leads to ${outPath} (scanned ${snap.size}).`)
}

void main().catch((err) => {
  console.error('Export failed:', err)
  process.exit(1)
})
