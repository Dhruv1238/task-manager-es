import { Outlet, useParams } from 'react-router-dom'
import { useChatEnabled } from '../contexts/AppConfigContext'
import { usePermissions } from '../hooks/usePermissions'
import { ProjectChatProvider } from '../contexts/ProjectChatContext'
import ChatToggleButton from '../components/chat/ChatToggleButton'
import ProjectChatPanel from '../components/chat/ProjectChatPanel'

export default function ProjectLayout() {
  const { projectId } = useParams<{ projectId: string }>()
  const chatEnabled = useChatEnabled()
  const { canViewProjectChat, project } = usePermissions(projectId)

  const showChat = chatEnabled && canViewProjectChat && Boolean(projectId)

  if (!showChat || !projectId) {
    return <Outlet />
  }

  return (
    <ProjectChatProvider projectId={projectId}>
      <Outlet />
      <ChatToggleButton />
      <ProjectChatPanel projectTitle={project?.title} />
    </ProjectChatProvider>
  )
}
