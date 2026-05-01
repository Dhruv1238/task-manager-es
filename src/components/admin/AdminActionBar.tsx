import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { seedTenderWorkspace, type SeedResult } from '../../lib/seedTender'
import NewMemberModal from './NewMemberModal'
import NewProjectModal from './NewProjectModal'
import NewTeamModal from './NewTeamModal'

interface Props {
  className?: string
}

export default function AdminActionBar({ className = '' }: Props) {
  const { profile, user } = useAuth()
  const [newMemberOpen, setNewMemberOpen] = useState(false)
  const [newTeamOpen, setNewTeamOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [seedResult, setSeedResult] = useState<SeedResult | null>(null)
  const [seedError, setSeedError] = useState<string | null>(null)

  const isSuperAdmin = profile?.globalRole === 'super_admin'
  const isAdmin = isSuperAdmin || profile?.globalRole === 'admin'
  if (!isAdmin) return null

  const secondaryBtn =
    'rounded-lg border border-white/10 bg-white/4 px-3.5 py-2 text-sm font-medium text-white/85 transition hover:bg-white/8 hover:text-white'
  const primaryBtn =
    'rounded-lg bg-linear-to-r from-purple-500 to-fuchsia-500 px-3.5 py-2 text-sm font-medium text-white shadow-lg shadow-purple-900/30 transition hover:from-purple-400 hover:to-fuchsia-400'

  async function handleSeed() {
    if (!user) return
    setSeeding(true)
    setSeedError(null)
    try {
      const r = await seedTenderWorkspace(user.uid)
      setSeedResult(r)
      window.setTimeout(() => setSeedResult(null), 6000)
    } catch (e) {
      setSeedError(e instanceof Error ? e.message : 'Seed failed')
    } finally {
      setSeeding(false)
    }
  }
  // The Seed button is currently commented out below — keep the state/handler
  // alive so re-enabling is a one-line uncomment.
  void seeding
  void handleSeed

  return (
    <>
      <div className={`flex flex-wrap items-center gap-2 ${className}`}>
        {/* Tender project creation is super-admin only (delta §2.3) */}
        {isSuperAdmin && (
          <button type="button" onClick={() => setNewProjectOpen(true)} className={primaryBtn}>
            + New Tender
          </button>
        )}
        <button type="button" onClick={() => setNewTeamOpen(true)} className={secondaryBtn}>
          + New Team
        </button>
        <button type="button" onClick={() => setNewMemberOpen(true)} className={secondaryBtn}>
          + New Member
        </button>
        {/* {isSuperAdmin && (
          <button
            type="button"
            onClick={handleSeed}
            disabled={seeding}
            title="Seeds the 5 tender teams + /config/taskTemplates. Idempotent."
            className={`${secondaryBtn} disabled:opacity-60`}
          >
            {seeding ? 'Seeding…' : 'Seed tender workspace'}
          </button>
        )} */}
      </div>

      {seedResult && (
        <div className="mt-2 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          Seed done — {seedResult.teamsCreated} teams created, {seedResult.teamsReused} reused, {seedResult.templatesWritten} templates written.
        </div>
      )}
      {seedError && (
        <div className="mt-2 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {seedError}
        </div>
      )}

      <NewMemberModal open={newMemberOpen} onClose={() => setNewMemberOpen(false)} />
      <NewTeamModal open={newTeamOpen} onClose={() => setNewTeamOpen(false)} />
      <NewProjectModal open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
    </>
  )
}