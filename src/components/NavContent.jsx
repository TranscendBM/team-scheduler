import { NavLink } from 'react-router-dom'
import {
  Home, BarChart3, TrendingUp, ClipboardList, Target, Users, FilePlus2, FileText,
  FolderOpen, Scale, LineChart, Calendar, Umbrella, Car, Trophy, Settings, PartyPopper,
  Award, Palette, Shield,
} from 'lucide-react'
import transcendLogo from '../assets/transcend-logo.svg'

const ROLE_LABELS = { manager: '主管', designer: '設計師', planner: 'Planner' }

// 側邊選單用單色線稿 icon(lucide-react)——顏色一律用 currentColor 跟著 NavLink 的文字顏色走
// (未選取灰色、選取藍色)，不額外指定 stroke 顏色。
// key 對應 utils/pages.js 的 PAGES[].key，這裡只影響選單顯示，不改動 pages.js 本身的資料
// (PermissionsPage.jsx 的權限矩陣仍沿用原本的 emoji)。
export const NAV_ICONS = {
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
  outings: Car,
  sponsor: Trophy,
  people: Users,
  settings: Settings,
  'projects-event': PartyPopper,
  'projects-award': Award,
  'projects-design': Palette,
}

// 系統管理頁（固定僅 manager）。使用者管理已併入「人員管理」，不再獨立列出
export const ADMIN_ITEMS = [
  { to: '/permissions', label: '權限設定', icon: Shield },
]

const linkClass = ({ isActive }) =>
  `flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded-lg text-sm transition-colors ${
    isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
  }`

// 桌面 Sidebar 與行動版 drawer「共用同一份」導覽內容——刻意不複製兩份，
// 避免以後改了一邊忘了另一邊（權限、badge、登出、manager 管理選單都只寫在這裡）。
// props:
//   navGroups / badgeFor / role / user / logout：由 Layout 算好後傳進來（權限判斷仍在 Layout）
//   onNavigate：點到任何一個 route 之後要做的事（drawer 用它自動關閉；桌面 Sidebar 不傳）
//   onClose：drawer 專用的關閉按鈕；沒傳就不顯示
export default function NavContent({ navGroups, badgeFor, role, user, logout, onNavigate, onClose }) {
  return (
    <>
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <img src={transcendLogo} alt="創見資訊" className="h-6 mb-2" />
          <h1 className="text-lg font-bold text-gray-800">行銷設計部</h1>
          <p className="text-xs text-gray-500 mt-0.5">專案管理系統</p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉主選單"
            className="w-11 h-11 -mr-2 -mt-1 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 text-xl leading-none shrink-0"
          >
            ×
          </button>
        )}
      </div>

      <nav className="flex-1 min-h-0 px-3 py-4 space-y-1 overflow-y-auto overscroll-contain">
        {navGroups.map((g, gi) => (
          <div key={g.key} className={gi > 0 ? 'pt-3 mt-2 border-t border-gray-100' : ''}>
            <p className="px-3 pb-1 text-xs text-gray-500 font-medium">{g.label}</p>
            {g.items.map(({ key, path, label, end }) => {
              const badge = badgeFor(key)
              const Icon = NAV_ICONS[key]
              return (
                <NavLink key={path} to={path} end={end} onClick={onNavigate} className={linkClass}>
                  {Icon && <Icon size={18} strokeWidth={1.75} className="shrink-0" />}
                  <span className="flex-1 min-w-0 break-words">{label}</span>
                  {badge > 0 && (
                    <span className="text-[10px] font-bold bg-red-500 text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none shrink-0">
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
              <NavLink key={to} to={to} onClick={onNavigate} className={linkClass}>
                <Icon size={18} strokeWidth={1.75} className="shrink-0" />
                <span className="min-w-0 break-words">{label}</span>
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* User info */}
      <div className="px-4 py-3 border-t border-gray-100 shrink-0">
        <div className="flex items-center gap-2 mb-2">
          {user?.photoURL && (
            <img src={user.photoURL} alt="" className="w-7 h-7 rounded-full shrink-0" referrerPolicy="no-referrer" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-700 truncate">{user?.displayName || user?.email}</p>
            {role && <p className="text-xs text-blue-500">{ROLE_LABELS[role] || role}</p>}
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full text-xs text-gray-500 hover:text-red-500 text-left transition-colors py-2 min-h-[36px]"
        >
          登出
        </button>
      </div>
    </>
  )
}
