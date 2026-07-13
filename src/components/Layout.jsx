import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

// roles: 哪些角色能看到該項；未指定 = 所有已登入者
const navItems = [
  // 需求系統
  { to: '/request/new', label: '提交需求', icon: '📝', roles: ['manager', 'planner'] },
  { to: '/my-requests', label: '我的需求', icon: '📄', roles: ['manager', 'planner'] },
  { to: '/review', label: '需求審核', icon: '⚖️', roles: ['manager'] },
  { to: '/tasks', label: '我的任務', icon: '✅', roles: ['manager', 'designer'] },
  // 設計團隊排程（planner 看不到）
  { to: '/', label: '甘特圖', icon: '📊', end: true, roles: ['manager', 'designer'] },
  { to: '/calendar', label: '日曆', icon: '📅', roles: ['manager', 'designer'] },
  { to: '/projects', label: '專案管理', icon: '📋', roles: ['manager', 'designer'] },
  { to: '/leave', label: '休假預排', icon: '🏖️', roles: ['manager', 'designer'] },
  { to: '/sponsor', label: '體總贊助', icon: '🏆', roles: ['manager', 'designer'] },
  { to: '/people', label: '人員管理', icon: '👥', roles: ['manager', 'designer'] },
  { to: '/settings', label: '里程碑設定', icon: '⚙️', roles: ['manager'] },
  { to: '/import', label: '匯入 Excel', icon: '📥', roles: ['manager'] },
  { to: '/users', label: '使用者管理', icon: '🔑', roles: ['manager'] },
]

const ROLE_LABELS = { manager: '設計主管', designer: '設計師', planner: 'Planner' }

export default function Layout() {
  const { user, role, logout } = useAuth()
  const visibleNav = navItems.filter(item => !item.roles || item.roles.includes(role))

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100">
          <h1 className="text-lg font-bold text-gray-800">Team Scheduler</h1>
          <p className="text-xs text-gray-400 mt-0.5">排程管理系統</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {visibleNav.map(({ to, label, icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                }`
              }
            >
              <span>{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Legend */}
        <div className="px-4 py-3 border-t border-gray-100">
          <p className="text-xs text-gray-400 mb-2 font-medium">圖例</p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-blue-500" />
              <span className="text-xs text-gray-600">秀展</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-orange-500" />
              <span className="text-xs text-gray-600">活動</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-emerald-500" />
              <span className="text-xs text-gray-600">報獎</span>
            </div>
          </div>
        </div>

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
