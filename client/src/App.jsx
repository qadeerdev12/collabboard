import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import PageLoading from './components/PageLoading'
import PageErrorBoundary from './components/PageErrorBoundary'

// Module-scope lazy components retain their identity across navigation/renders.
// ProtectedRoute checks access before React renders (and imports) its child page.
const LandingPage = lazy(() => import('./pages/LandingPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const BoardPage = lazy(() => import('./pages/BoardPage'))
const ActivityPage = lazy(() => import('./pages/ActivityPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const MyTasksPage = lazy(() => import('./pages/MyTasksPage'))

function App() {
  return (
    <PageErrorBoundary>
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/activity" element={<ProtectedRoute><ActivityPage /></ProtectedRoute>} />
          <Route path="/my-tasks" element={<ProtectedRoute><MyTasksPage /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/boards/:boardId" element={<ProtectedRoute><BoardPage /></ProtectedRoute>} />
          <Route path="/boards/:boardId/activity" element={<ProtectedRoute><ActivityPage /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </PageErrorBoundary>
  )
}

export default App
