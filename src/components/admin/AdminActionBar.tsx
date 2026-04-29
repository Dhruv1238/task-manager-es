import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import NewMemberModal from './NewMemberModal'
import NewProjectModal from './NewProjectModal'
import NewTeamModal from './NewTeamModal'

interface Props {
  className?: string
}

export default function AdminActionBar({ className = '' }: Props) {
  const { profile } = useAuth()
  const [newMemberOpen, setNewMemberOpen] = useState(false)
  const [newTeamOpen, setNewTeamOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)

  if (profile?.globalRole !== 'admin') return null

  const secondaryBtn =
    'rounded-lg border border-white/10 bg-white/4 px-3.5 py-2 text-sm font-medium text-white/85 transition hover:bg-white/8 hover:text-white'
  const primaryBtn =
    'rounded-lg bg-linear-to-r from-purple-500 to-fuchsia-500 px-3.5 py-2 text-sm font-medium text-white shadow-lg shadow-purple-900/30 transition hover:from-purple-400 hover:to-fuchsia-400'

  return (
    <>
      <div className={`flex flex-wrap items-center gap-2 ${className}`}>
        <button type="button" onClick={() => setNewProjectOpen(true)} className={primaryBtn}>
          + New Project
        </button>
        <button type="button" onClick={() => setNewTeamOpen(true)} className={secondaryBtn}>
          + New Team
        </button>
        <button type="button" onClick={() => setNewMemberOpen(true)} className={secondaryBtn}>
          + New Member
        </button>
      </div>

      <NewMemberModal open={newMemberOpen} onClose={() => setNewMemberOpen(false)} />
      <NewTeamModal open={newTeamOpen} onClose={() => setNewTeamOpen(false)} />
      <NewProjectModal open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
    </>
  )
}