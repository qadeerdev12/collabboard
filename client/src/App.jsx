import { Routes, Route, Navigate } from 'react-router-dom'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import ProtectedRoute from './components/ProtectedRoute'
import BoardPage from './pages/BoardPage'
import ActivityPage from './pages/ActivityPage'
import ProfilePage from './pages/ProfilePage'
import MyTasksPage from './pages/MyTasksPage'

function App() {
  return (
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
  )
}

export default App
