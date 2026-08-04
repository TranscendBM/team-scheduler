import { NavLink, Outlet } from 'react-router-dom'
import {
  Home, BarChart3, TrendingUp, ClipboardList, Target, Users, FilePlus2, FileText,
  FolderOpen, Scale, LineChart, Calendar, Umbrella, Trophy, Settings, PartyPopper,
  Award, Palette, Shield,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { usePermissions } from '../contexts/PermissionsContext'
import { useNotifications } from '../contexts/NotificationsContext'
import { PAGES, GROUPS } from '../utils/pages'
import transcendLogo from '../assets/transcend-logo.svg'

const ROLE_LABELS = { manager: '主管', designer: '設計師', planner: 'Planner' }

// 側邊選單改用單色線稿 icon(lucide-react)取代原本的彩色 emoji——顏色一律用 currentColor
// 跟著 NavLink 的文字顏色走(未選取灰色、選取藍色)，不額外指定 stroke 顏色。
// key 對應 utils/pages.js 的 PAGES[].key，這裡只影響側邊選單的顯示，不改動 pages.js
// 本身的資料(PermissionsPage.jsx 的權限矩陣仍沿用原本的 emoji，不在這次異動範圍)。
const NAV_ICONS = {
  'my-dashboard': Home,
  gantt: BarChart3,
  'tradeshow-analysis': TrendingUp,
  'tradeshow-list': ClipboardList,
  'tradeshow-targets': Target,
  'tradeshow-assignments': Users,
  'tradeshow-gantt': BarChart3,
  'request/new': FilePlus2,
  'my-requests': FileText,
  requests: FolderOpen,
  review: Scale,
  dashboard: LineChart,
  calendar: Calendar,
  leave: Umbrella,
  sponsor: Trophy,
  people: Users,
  settings: Settings,
  'projects-event': PartyPopper,
  'projects-award': Award,
  'projects-design': Palette,
}

// 系統管理頁（固定僅 manager）。使用者管理已併入「人員管理」，不再獨立列出
const ADMIN_ITEMS = [
  { to: '/permissions', label: '權限設定', icon: Shield },
]

export default function Layout() {
  const { user, role, logout } = useAuth()
  const { canAccess } = usePermissions()
  const { newCount, pendingCount } = useNotifications()

  // 每個頁面的提示數量:總表=未讀新任務、審核=待審核件數
  const badgeFor = (key) => {
    if (key === 'requests' && newCount > 0) return newCount
    if (key === 'review' && pendingCount > 0) return pendingCount
    return 0
  }

  const visibleNav = PAGES.filter(p => canAccess(p.key, role))
  const navGroups = GROUPS
    .map(g => ({ ...g, items: visibleNav.filter(p => p.group === g.key) }))
    .filter(g => g.items.length > 0)

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100">
          <img src={transcendLogo} alt="創見資訊" className="h-6 mb-2" />
          <h1 className="text-lg font-bold text-gray-800">行銷設計部</h1>
          <p className="text-xs text-gray-500 mt-0.5">專案管理系統</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navGroups.map((g, gi) => (
            <div key={g.key} className={gi > 0 ? 'pt-3 mt-2 border-t border-gray-100' : ''}>
              <p className="px-3 pb-1 text-xs text-gray-500 font-medium">{g.label}</p>
              {g.items.map(({ key, path, label, end }) => {
                const badge = badgeFor(key)
                const Icon = NAV_ICONS[key]
                return (
                  <NavLink
                    key={path}
                    to={path}
                    end={end}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                        isActive
                          ? 'bg-blue-50 text-blue-700 font-medium'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`
                    }
                  >
                    {Icon && <Icon size={18} strokeWidth={1.75} className="shrink-0" />}
                    <span className="flex-1">{label}</span>
                    {badge > 0 && (
                      <span className="text-[10px] font-bold bg-red-500 text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none">
                        {badge > 99 ? '99+' : badge}
                      </span>
                    )}
                  </NavLink>
                )
              })}
            </div>
          ))}

          {role === 'manager' && (
            <>
              <div className="pt-3 mt-2 border-t border-gray-100">
                <p className="px-3 pb-1 text-xs text-gray-500 font-medium">系統管理</p>
              </div>
              {ADMIN_ITEMS.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
                    }`
                  }>
                  <Icon size={18} strokeWidth={1.75} className="shrink-0" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* User info */}
        <div className="px-4 py-3 border-t border-gray-100">
          <div className="flex items-center gap-2 mb-2">
            {user?.photoURL && (
              <img src={user.photoURL} alt="" className="w-7 h-7 rounded-full" referrerPolicy="no-referrer" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-700 truncate">{user?.displayName || user?.email}</p>
              {role && <p className="text-xs text-blue-500">{ROLE_LABELS[role] || role}</p>}
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full text-xs text-gray-500 hover:text-red-500 text-left transition-colors"
          >
            登出
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
