import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { usePermissions } from './contexts/PermissionsContext'
import { PAGES } from './utils/pages'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import GanttPage from './pages/GanttPage'
import DashboardPage from './pages/DashboardPage'
import CalendarPage from './pages/CalendarPage'
import EventsPage from './pages/EventsPage'
import AwardsPage from './pages/AwardsPage'
import DesignPage from './pages/DesignPage'
import PeoplePage from './pages/PeoplePage'
import SettingsPage from './pages/SettingsPage'
import LeavePage from './pages/LeavePage'
import SponsorPage from './pages/SponsorPage'
import RequestNewPage from './pages/RequestNewPage'
import MyRequestsPage from './pages/MyRequestsPage'
import RequestsTablePage from './pages/RequestsTablePage'
import ReviewPage from './pages/ReviewPage'
import RequestsDashboardPage from './pages/RequestsDashboardPage'
import PermissionsPage from './pages/PermissionsPage'
import TradeshowAnalysisPage from './pages/TradeshowAnalysisPage'
import TradeshowListPage from './pages/TradeshowListPage'
import TradeshowTargetsPage from './pages/TradeshowTargetsPage'
import TradeshowAssignmentsPage from './pages/TradeshowAssignmentsPage'
import TradeshowGanttPage from './pages/TradeshowGanttPage'

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

// 首頁：所有角色登入後都先落地在「我的儀表板」（登入時的重點資訊，內容依角色分不同區塊）
function Home() {
  const { role } = useAuth()
  const { canAccess } = usePermissions()
  if (canAccess('my-dashboard', role)) return <Navigate to="/dashboard-me" replace />
  if (canAccess('gantt', role)) return <Navigate to="/gantt" replace />
  // planner 的慣用首頁是「我的需求」，優先於秀展等其他頁面（PAGES 陣列順序不代表落地頁優先序）
  if (canAccess('my-requests', role)) return <Navigate to="/my-requests" replace />
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
        <Route path="dashboard-me" element={<PermRoute pageKey="my-dashboard"><DashboardPage /></PermRoute>} />
        <Route path="gantt" element={<PermRoute pageKey="gantt"><GanttPage /></PermRoute>} />
        <Route path="calendar" element={<PermRoute pageKey="calendar"><CalendarPage /></PermRoute>} />
        <Route path="tradeshow-analysis" element={<PermRoute pageKey="tradeshow-analysis"><TradeshowAnalysisPage /></PermRoute>} />
        <Route path="tradeshow-list" element={<PermRoute pageKey="tradeshow-list"><TradeshowListPage /></PermRoute>} />
        <Route path="tradeshow-targets" element={<PermRoute pageKey="tradeshow-targets"><TradeshowTargetsPage /></PermRoute>} />
        <Route path="tradeshow-assignments" element={<PermRoute pageKey="tradeshow-assignments"><TradeshowAssignmentsPage /></PermRoute>} />
        <Route path="tradeshow-gantt" element={<PermRoute pageKey="tradeshow-gantt"><TradeshowGanttPage /></PermRoute>} />
        <Route path="projects/event" element={<PermRoute pageKey="projects-event"><EventsPage /></PermRoute>} />
        <Route path="projects/award" element={<PermRoute pageKey="projects-award"><AwardsPage /></PermRoute>} />
        <Route path="projects/design" element={<PermRoute pageKey="projects-design"><DesignPage /></PermRoute>} />
        <Route path="people" element={<PermRoute pageKey="people"><PeoplePage /></PermRoute>} />
        <Route path="settings" element={<PermRoute pageKey="settings"><SettingsPage /></PermRoute>} />
        <Route path="leave" element={<PermRoute pageKey="leave"><LeavePage /></PermRoute>} />
        <Route path="sponsor" element={<PermRoute pageKey="sponsor"><SponsorPage /></PermRoute>} />
        <Route path="request/new" element={<PermRoute pageKey="request/new"><RequestNewPage /></PermRoute>} />
        <Route path="request/edit/:id" element={<PermRoute pageKey="request/new"><RequestNewPage /></PermRoute>} />
        <Route path="my-requests" element={<PermRoute pageKey="my-requests"><MyRequestsPage /></PermRoute>} />
        <Route path="requests" element={<PermRoute pageKey="requests"><RequestsTablePage /></PermRoute>} />
        <Route path="review" element={<PermRoute pageKey="review"><ReviewPage /></PermRoute>} />
        <Route path="dashboard" element={<PermRoute pageKey="dashboard"><RequestsDashboardPage /></PermRoute>} />
        {/* 使用者管理已併入「人員管理」，舊書籤導過去 */}
        <Route path="users" element={<Navigate to="/people" replace />} />
        <Route path="permissions" element={<ManagerRoute><PermissionsPage /></ManagerRoute>} />
      </Route>
    </Routes>
  )
}
