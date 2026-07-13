import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { usePermissions } from '../contexts/PermissionsContext'
import { PAGES } from '../utils/pages'

const ROLE_LABELS = { manager: '設計主管', designer: '設計師', planner: 'Planner' }

// 系統管理頁（固定僅 manager）
const ADMIN_ITEMS = [
  { to: '/users', label: '使用者管理', icon: '🔑' },
  { to: '/permissions', label: '權限設定', icon: '🛡️' },
]

export default function Layout() {
  const { user, role, logout } = useAuth()
  const { canAccess } = usePermissions()

  const visibleNav = PAGES.filter(p => canAccess(p.key, role))

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100">
          <h1 className="text-lg font-bold text-gray-800">Team Scheduler</h1>
          <p className="text-xs text-gray-400 mt-0.5">排程管理系統</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {visibleNav.map(({ path, label, icon, end }) => (
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
              <span>{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}

          {role === 'manager' && (
            <>
              <div className="pt-3 mt-2 border-t border-gray-100">
                <p className="px-3 pb-1 text-xs text-gray-400 font-medium">系統管理</p>
              </div>
              {ADMIN_ITEMS.map(({ to, label, icon }) => (
                <NavLink key={to} to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
                    }`
                  }>
                  <span>{icon}</span>
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
