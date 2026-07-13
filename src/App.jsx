import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { usePermissions } from './contexts/PermissionsContext'
import { PAGES } from './utils/pages'
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
import RequestsTablePage from './pages/RequestsTablePage'
import ReviewPage from './pages/ReviewPage'
import TasksPage from './pages/TasksPage'
import PermissionsPage from './pages/PermissionsPage'

function ProtectedRoute({ children }) {
  const { user, unauthorized, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-500">載入中…</div>
  if (!user || unauthorized) return <Navigate to="/login" replace />
  return children
}

// 依「權限設定」判斷角色能否進入該頁；不能就導回首頁
function PermRoute({ pageKey, children }) {
  const { role } = useAuth()
  const { canAccess } = usePermissions()
  if (!canAccess(pageKey, role)) return <Navigate to="/" replace />
  return children
}

// 系統管理頁固定僅 manager
function ManagerRoute({ children }) {
  const { role } = useAuth()
  if (role !== 'manager') return <Navigate to="/" replace />
  return children
}

// 首頁：導到該角色第一個可看的頁面（manager/designer 通常是甘特圖，planner 是我的需求）
function Home() {
  const { role } = useAuth()
  const { canAccess } = usePermissions()
  if (canAccess('gantt', role)) return <GanttPage />
  const first = PAGES.find(p => p.key !== 'gantt' && canAccess(p.key, role))
  return <Navigate to={first ? first.path : '/login'} replace />
}

export default function App() {
  const { user, unauthorized, loading } = useAuth()

  if (loading) return <div className="flex items-center justify-center h-screen text-gray-500">載入中…</div>

  return (
    <Routes>
      <Route path="/login" element={user && !unauthorized ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Home />} />
        <Route path="calendar" element={<PermRoute pageKey="calendar"><CalendarPage /></PermRoute>} />
        <Route path="projects" element={<PermRoute pageKey="projects"><ProjectsPage /></PermRoute>} />
        <Route path="people" element={<PermRoute pageKey="people"><PeoplePage /></PermRoute>} />
        <Route path="settings" element={<PermRoute pageKey="settings"><SettingsPage /></PermRoute>} />
        <Route path="import" element={<PermRoute pageKey="import"><ImportPage /></PermRoute>} />
        <Route path="leave" element={<PermRoute pageKey="leave"><LeavePage /></PermRoute>} />
        <Route path="sponsor" element={<PermRoute pageKey="sponsor"><SponsorPage /></PermRoute>} />
        <Route path="request/new" element={<PermRoute pageKey="request/new"><RequestNewPage /></PermRoute>} />
        <Route path="my-requests" element={<PermRoute pageKey="my-requests"><MyRequestsPage /></PermRoute>} />
        <Route path="requests" element={<PermRoute pageKey="requests"><RequestsTablePage /></PermRoute>} />
        <Route path="review" element={<PermRoute pageKey="review"><ReviewPage /></PermRoute>} />
        <Route path="tasks" element={<PermRoute pageKey="tasks"><TasksPage /></PermRoute>} />
        <Route path="users" element={<ManagerRoute><UsersPage /></ManagerRoute>} />
        <Route path="permissions" element={<ManagerRoute><PermissionsPage /></ManagerRoute>} />
      </Route>
    </Routes>
  )
}
