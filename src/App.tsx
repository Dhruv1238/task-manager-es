import { lazy, Suspense, useEffect } from 'react'
import { Route, Routes, useLocation, type Location } from 'react-router-dom'
import AdminRoute, { SuperAdminRoute } from './components/AdminRoute'
import DevConfigRoute from './components/DevConfigRoute'
import ProtectedRoute from './components/ProtectedRoute'
import TaskDetailModal from './components/tasks/TaskDetailModal'
import ProjectLayout from './layouts/ProjectLayout'
import AdminDashboard from './pages/AdminDashboard'
import AdminMembers from './pages/AdminMembers'
import AppConfigPage from './pages/AppConfigPage'
import Home from './pages/Home'
import Login from './pages/Login'
import OrgSetupWizard from './pages/OrgSetupWizard'
import WorkflowEdit from './pages/WorkflowEdit'
import WorkflowWizard from './pages/WorkflowWizard'
import Me from './pages/Me'
import NotFound from './pages/NotFound'
import ProjectBoard from './pages/ProjectBoard'
import ProjectDetail from './pages/ProjectDetail'
import Projects from './pages/Projects'
import TaskDetailPage from './pages/TaskDetailPage'
import TeamDetail from './pages/TeamDetail'
import TeamOnProject from './pages/TeamOnProject'
import Teams from './pages/Teams'

// Sandbox-only surfaces — gated by the build-time literal `__IS_SANDBOX__`
// so production bundles tree-shake every chunk these would have generated.
const SandboxLogin = __IS_SANDBOX__ ? lazy(() => import('./pages/SandboxLogin')) : null
const SandboxShell = __IS_SANDBOX__ ? lazy(() => import('./components/sandbox/SandboxShell')) : null
const SandboxErrorBoundary = __IS_SANDBOX__
  ? lazy(() => import('./components/sandbox/SandboxErrorBoundary'))
  : null

function App() {
  const location = useLocation()
  const state = location.state as { backgroundLocation?: Location } | null
  const backgroundLocation = state?.backgroundLocation ?? null

  // Phase B trigger: watch for "wizards complete" once authenticated.
  useEffect(() => {
    if (!__IS_SANDBOX__) return
    let cancelled = false
    let teardown: (() => void) | null = null
    void import('./lib/sandboxBoot').then((m) => {
      if (cancelled) return
      teardown = m.watchForPhaseB()
    })
    return () => {
      cancelled = true
      teardown?.()
    }
  }, [])

  const inner = (
    <>
      <Routes location={backgroundLocation ?? location}>
        <Route
          path="/login"
          element={
            __IS_SANDBOX__ && SandboxLogin ? (
              <Suspense fallback={null}>
                <SandboxLogin />
              </Suspense>
            ) : (
              <Login />
            )
          }
        />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Home />} />
          <Route path="/me" element={<Me />} />
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="/teams/:teamId" element={<TeamDetail />} />
          <Route path="/projects/:projectId" element={<ProjectLayout />}>
            <Route index element={<ProjectDetail />} />
            <Route path="boards" element={<ProjectBoard />} />
            <Route path="teams/:teamId" element={<TeamOnProject />} />
          </Route>
          <Route path="/teams" element={<Teams />} />
          <Route path="/projects" element={<Projects />} />
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/members" element={<AdminMembers />} />
          </Route>
          <Route element={<DevConfigRoute />}>
            <Route path="/admin/config" element={<AppConfigPage />} />
          </Route>
          {/* Phase 2c: setup + workflow authoring open to any super_admin so a
            * fresh tenant's owner can complete onboarding without being on the
            * dev-config allowlist. */}
          <Route element={<SuperAdminRoute />}>
            <Route path="/admin/setup" element={<OrgSetupWizard />} />
            <Route path="/admin/workflows/new" element={<WorkflowWizard />} />
            <Route path="/admin/workflows/:id/edit" element={<WorkflowEdit />} />
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

  if (__IS_SANDBOX__ && SandboxShell && SandboxErrorBoundary) {
    return (
      <Suspense fallback={null}>
        <SandboxErrorBoundary>
          <SandboxShell>{inner}</SandboxShell>
        </SandboxErrorBoundary>
      </Suspense>
    )
  }
  return inner
}

export default App