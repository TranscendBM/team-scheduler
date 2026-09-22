import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { usePermissions } from '../contexts/PermissionsContext'
import { useNotifications } from '../contexts/NotificationsContext'
import { PAGES, GROUPS } from '../utils/pages'
import { buildNavGroups, totalBadgeCount } from '../utils/navigation'
import useScrollLock from '../hooks/useScrollLock'
import NavContent from './NavContent'
import transcendLogo from '../assets/transcend-logo.svg'

// 全站響應式外框。
//   lg 以上：維持原本的左側固定 Sidebar（桌面資訊密度完全不變）
//   lg 以下：Sidebar 收起，改成 sticky top bar + hamburger 開啟的 off-canvas drawer
//
// 導覽內容（權限過濾、badge、使用者資訊、登出、manager 管理選單）只寫在 NavContent 一份，
// 桌面與 drawer 共用，不會有兩份不同步的風險。
//
// z-index 層級見 src/index.css 的說明：top bar 30 < drawer 40 < Modal 50，
// 所以頁面裡的 Modal 一定蓋得過 drawer。
export default function Layout() {
  const { user, role, logout, canReview } = useAuth()
  const { canAccess } = usePermissions()
  const { newCount, pendingCount } = useNotifications()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  // 每個頁面的提示數量:總表=未讀新任務、審核=待審核件數
  const badgeFor = (key) => {
    if (key === 'requests' && newCount > 0) return newCount
    if (key === 'review' && pendingCount > 0) return pendingCount
    return 0
  }

  const navGroups = buildNavGroups({ pages: PAGES, groups: GROUPS, canAccess, role, canReview })
  const mobileBadge = totalBadgeCount(navGroups, badgeFor)

  // route 一換就關 drawer（含瀏覽器上一頁/下一頁），不會停在開啟狀態擋住新頁面。
  // 在 render 期間直接比對調整 state（而不是在 effect 裡 setState），這是 React 官方建議的
  // 「依 props/外部值變化調整 state」寫法，也符合本專案其他地方的既有做法
  // （見 ShareLinkPanel.jsx / NotificationsContext.jsx），不會多一次級聯渲染。
  const [trackedPath, setTrackedPath] = useState(location.pathname)
  if (location.pathname !== trackedPath) {
    setTrackedPath(location.pathname)
    if (drawerOpen) setDrawerOpen(false)
  }

  // Escape 關閉
  useEffect(() => {
    if (!drawerOpen) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  // 開啟時鎖住背景捲動；關閉或離開頁面一定會解開
  useScrollLock(drawerOpen)

  return (
    <div className="app-shell flex bg-gray-50">
      {/* 桌面 Sidebar（lg 以上） */}
      <aside className="hidden lg:flex w-56 shrink-0 bg-white border-r border-gray-200 flex-col shadow-sm">
        <NavContent
          navGroups={navGroups}
          badgeFor={badgeFor}
          role={role}
          user={user}
          logout={logout}
        />
      </aside>

      {/* 行動版 off-canvas drawer（lg 以下） */}
      {drawerOpen && (
        <div className="lg:hidden">
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div
            id="app-mobile-nav"
            role="dialog"
            aria-modal="true"
            aria-label="主選單"
            className="fixed inset-y-0 left-0 z-40 w-[84vw] max-w-[17rem] bg-white shadow-xl flex flex-col"
          >
            <NavContent
              navGroups={navGroups}
              badgeFor={badgeFor}
              role={role}
              user={user}
              logout={logout}
              onNavigate={() => setDrawerOpen(false)}
              onClose={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* 行動版 top bar */}
        <header className="lg:hidden sticky top-0 z-30 flex items-center gap-3 px-3 sm:px-4 h-14 bg-white border-b border-gray-200 shrink-0">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="開啟主選單"
            aria-expanded={drawerOpen}
            aria-controls="app-mobile-nav"
            className="relative w-11 h-11 -ml-1 flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
          >
            <Menu size={22} strokeWidth={1.75} />
            {mobileBadge > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" aria-hidden="true" />
            )}
          </button>
          <img src={transcendLogo} alt="" className="h-5 shrink-0" />
          <span className="text-sm font-semibold text-gray-800 truncate">行銷設計部 · 專案管理系統</span>
        </header>

        {/* Main content */}
        <main className="flex-1 min-h-0 min-w-0 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
