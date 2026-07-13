import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import GanttPage from './pages/GanttPage'
import CalendarPage from './pages/CalendarPage'
import ProjectsPage from './pages/ProjectsPage'
import PeoplePage from './pages/PeoplePage'
import SettingsPage from './pages/SettingsPage'
import ImportPage from './pages/ImportPage'
import LeavePage from './pages/LeavePage'
import SponsorPage from './pages/SponsorPage'
import UsersPage from './pages/UsersPage'
import RequestNewPage from './pages/RequestNewPage'
import MyRequestsPage from './pages/MyRequestsPage'
import ReviewPage from './pages/ReviewPage'
import TasksPage from './pages/TasksPage'

function ProtectedRoute({ children }) {
  const { user, unauthorized, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-500">載入中…</div>
  if (!user || unauthorized) return <Navigate to="/login" replace />
  return children
}

// 限定角色才能進入，否則導回首頁
function RoleRoute({ allow, children }) {
  const { role } = useAuth()
  if (!allow.includes(role)) return <Navigate to="/" replace />
  return children
}

// 首頁依角色決定：planner → 我的需求；其他 → 甘特圖
function Home() {
  const { role } = useAuth()
  if (role === 'planner') return <Navigate to="/my-requests" replace />
  return <GanttPage />
}

export default function App() {
  const { user, unauthorized, loading } = useAuth()

  if (loading) return <div className="flex items-center justify-center h-screen text-gray-500">載入中…</div>

  return (
    <Routes>
      <Route path="/login" element={user && !unauthorized ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Home />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="people" element={<PeoplePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="leave" element={<LeavePage />} />
        <Route path="sponsor" element={<SponsorPage />} />
        <Route path="users" element={<RoleRoute allow={['manager']}><UsersPage /></RoleRoute>} />
        <Route path="request/new" element={<RoleRoute allow={['manager', 'planner']}><RequestNewPage /></RoleRoute>} />
        <Route path="my-requests" element={<RoleRoute allow={['manager', 'planner']}><MyRequestsPage /></RoleRoute>} />
        <Route path="review" element={<RoleRoute allow={['manager']}><ReviewPage /></RoleRoute>} />
        <Route path="tasks" element={<RoleRoute allow={['manager', 'designer']}><TasksPage /></RoleRoute>} />
      </Route>
    </Routes>
  )
}
