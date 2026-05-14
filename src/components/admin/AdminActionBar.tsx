import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useCreateProjectLabel } from '../../contexts/AppConfigContext'
import { seedTenderWorkspace, type SeedResult } from '../../lib/seedTender'
import NewMemberModal from './NewMemberModal'
import NewProjectModal from './NewProjectModal'
import NewTeamModal from './NewTeamModal'

interface Props {
  className?: string
}

export default function AdminActionBar({ className = '' }: Props) {
  const { profile, user } = useAuth()
  const createLabel = useCreateProjectLabel()
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
    'rounded-lg border border-line bg-fill-2 px-3.5 py-2 text-sm font-medium text-fg-strong transition hover:bg-fill-4 hover:text-fg'
  const primaryBtn =
    'rounded-lg bg-brand-gradient px-3.5 py-2 text-sm font-medium text-white shadow-lg shadow-purple-900/30 transition hover-brand-gradient'

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
            + {createLabel}
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
        <div className="mt-2 rounded-lg border border-tone-success-bd bg-tone-success-bg px-3 py-2 text-xs text-tone-success-fg">
          Seed done — {seedResult.teamsCreated} teams created, {seedResult.teamsReused} reused, {seedResult.templatesWritten} templates written.
        </div>
      )}
      {seedError && (
        <div className="mt-2 rounded-lg border border-tone-danger-bd bg-tone-danger-bg px-3 py-2 text-xs text-tone-danger-fg">
          {seedError}
        </div>
      )}

      <NewMemberModal open={newMemberOpen} onClose={() => setNewMemberOpen(false)} />
      <NewTeamModal open={newTeamOpen} onClose={() => setNewTeamOpen(false)} />
      <NewProjectModal open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
    </>
  )
}