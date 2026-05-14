import { Route, Routes, useLocation, type Location } from 'react-router-dom'
import AdminRoute from './components/AdminRoute'
import DevConfigRoute from './components/DevConfigRoute'
import ProtectedRoute from './components/ProtectedRoute'
import TaskDetailModal from './components/tasks/TaskDetailModal'
import AdminDashboard from './pages/AdminDashboard'
import AdminMembers from './pages/AdminMembers'
import AppConfigPage from './pages/AppConfigPage'
import Home from './pages/Home'
import Login from './pages/Login'
import Me from './pages/Me'
import NotFound from './pages/NotFound'
import ProjectBoard from './pages/ProjectBoard'
import ProjectDetail from './pages/ProjectDetail'
import Projects from './pages/Projects'
import TaskDetailPage from './pages/TaskDetailPage'
import TeamDetail from './pages/TeamDetail'
import TeamOnProject from './pages/TeamOnProject'
import Teams from './pages/Teams'

function App() {
  const location = useLocation()
  const state = location.state as { backgroundLocation?: Location } | null
  const backgroundLocation = state?.backgroundLocation ?? null

  return (
    <>
      <Routes location={backgroundLocation ?? location}>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Home />} />
          <Route path="/me" element={<Me />} />
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="/teams/:teamId" element={<TeamDetail />} />
          <Route path="/projects/:projectId" element={<ProjectDetail />} />
          <Route path="/projects/:projectId/boards" element={<ProjectBoard />} />
          <Route
            path="/projects/:projectId/teams/:teamId"
            element={<TeamOnProject />}
          />
          <Route path="/teams" element={<Teams />} />
          <Route path="/projects" element={<Projects />} />
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/members" element={<AdminMembers />} />
          </Route>
          <Route element={<DevConfigRoute />}>
            <Route path="/admin/config" element={<AppConfigPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>

      {backgroundLocation && (
        <Routes>
          <Route path="/tasks/:taskId" element={<TaskDetailModal />} />
        </Routes>
      )}
    </>
  )
}

export default App