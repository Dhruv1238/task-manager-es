import { lazy, Suspense, useEffect } from 'react'
import { Route, Routes, useLocation, type Location } from 'react-router-dom'
import { SuperAdminRoute } from './components/AdminRoute'
import RequireAccess from './components/RequireAccess'
import ProtectedRoute from './components/ProtectedRoute'
import TaskDetailModal from './components/tasks/TaskDetailModal'
import ProjectLayout from './layouts/ProjectLayout'
import AdminDashboard from './pages/AdminDashboard'
import AdminMembers from './pages/AdminMembers'
import KpiReports from './pages/KpiReports'
import AppConfigPage from './pages/AppConfigPage'
import Home from './pages/Home'
import Login from './pages/Login'
import OrgSetupWizard from './pages/OrgSetupWizard'
import RolesHierarchy from './pages/RolesHierarchy'
// Phase 3: the React Flow canvas is now the primary authoring surface — it
// replaces the old conversational WorkflowWizard + SideEditor at every entry
// point (new / edit). Lazy so @xyflow/react + dagre + framer-motion land in
// their own route chunk; neither the main bundle nor the sandbox login/shell
// (which never visits an authoring route) pays for it. The old wizard/editor
// modules remain in the repo, just no longer routed.
const FlowAuthoring = lazy(() => import('./pages/FlowAuthoring'))
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
          {/* Admin surfaces gated by the Role-Hierarchy module grid (super_admin
            * always passes via RequireAccess's hierarchy-independent baseline). */}
          <Route element={<RequireAccess module="reports" />}>
            <Route path="/admin" element={<AdminDashboard />} />
          </Route>
          {/* KPI Reports — pushed but NOT yet released to the client. No nav
            * entry, no permission column; the route stays live so reviewers
            * can reach it by direct URL, super-admins only.
            * RELEASE(kpi-reports): swap SuperAdminRoute back to
            * <RequireAccess module="kpi_reports" /> and uncomment the module id
            * in types/v2.ts + the Navbar entries. */}
          <Route element={<SuperAdminRoute />}>
            <Route path="/admin/reports" element={<KpiReports />} />
          </Route>
          <Route element={<RequireAccess module="members" />}>
            <Route path="/admin/members" element={<AdminMembers />} />
          </Route>
          <Route element={<RequireAccess module="settings" />}>
            <Route path="/admin/config" element={<AppConfigPage />} />
          </Route>
          {/* Setup + Roles EDIT the permission system itself — kept super_admin
            * only (a settings.update role must not be able to escalate). */}
          <Route element={<SuperAdminRoute />}>
            <Route path="/admin/setup" element={<OrgSetupWizard />} />
            <Route path="/admin/roles" element={<RolesHierarchy />} />
          </Route>
          {/* Workflow authoring is config-driven (workflows module). The flow
            * canvas resolves all three paths (lazy chunk): /admin/workflows/new
            * (no :id) → new-flow creation; the edit paths → edit/view that flow. */}
          <Route element={<RequireAccess module="workflows" />}>
            <Route
              path="/admin/workflows/new"
              element={
                <Suspense fallback={<CanvasLoading />}>
                  <FlowAuthoring />
                </Suspense>
              }
            />
            <Route
              path="/admin/workflows/:id/edit"
              element={
                <Suspense fallback={<CanvasLoading />}>
                  <FlowAuthoring />
                </Suspense>
              }
            />
            <Route
              path="/admin/flow/:id"
              element={
                <Suspense fallback={<CanvasLoading />}>
                  <FlowAuthoring />
                </Suspense>
              }
            />
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

function CanvasLoading() {
  return <div className="p-16 text-center text-sm text-fg-subtle">Loading canvas…</div>
}

export default App