// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { SCROLL_LOCK_CLASS } from '../../src/utils/scrollLock.js'
import { canAccess as canAccessFn } from '../../src/utils/pages.js'

// Layout 底下的 context 會 import src/firebase.js（需要 Firebase 環境變數才肯載入），
// 這裡改成直接 mock 三個 hook —— 測的是 RWD 的 drawer 行為與權限過濾結果，
// 不需要、也不應該連到任何 Firebase 專案。
const authState = { user: { displayName: '測試者', email: 'tester@example.com' }, role: 'designer', canReview: false }
const logout = vi.fn()

vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({ ...authState, logout }),
}))
vi.mock('../../src/contexts/PermissionsContext', () => ({
  usePermissions: () => ({ canAccess: (pageKey, role) => canAccessFn({}, pageKey, role) }),
}))
vi.mock('../../src/contexts/NotificationsContext', () => ({
  useNotifications: () => ({ newCount: 0, pendingCount: 0 }),
}))

const { default: Layout } = await import('../../src/components/Layout.jsx')

function renderLayout(initialPath = '/gantt') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route path="gantt" element={<div>甘特圖內容</div>} />
          <Route path="calendar" element={<div>日曆內容</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const openButton = () => screen.getByRole('button', { name: '開啟主選單' })
const drawer = () => screen.queryByRole('dialog', { name: '主選單' })

beforeEach(() => {
  authState.role = 'designer'
  authState.canReview = false
  logout.mockClear()
})

afterEach(() => {
  cleanup()
  document.body.classList.remove(SCROLL_LOCK_CLASS)
})

describe('行動版導覽 drawer', () => {
  it('預設是關閉的，hamburger 有正確的 aria-expanded', () => {
    renderLayout()
    expect(drawer()).toBeNull()
    expect(openButton().getAttribute('aria-expanded')).toBe('false')
    expect(openButton().getAttribute('aria-controls')).toBe('app-mobile-nav')
  })

  it('點 hamburger 會開啟 drawer，並鎖住背景捲動', async () => {
    const user = userEvent.setup()
    renderLayout()
    await user.click(openButton())
    expect(drawer()).not.toBeNull()
    expect(openButton().getAttribute('aria-expanded')).toBe('true')
    expect(document.body.classList.contains(SCROLL_LOCK_CLASS)).toBe(true)
  })

  it('關閉按鈕可以關掉 drawer，並解除 scroll lock', async () => {
    const user = userEvent.setup()
    renderLayout()
    await user.click(openButton())
    await user.click(screen.getByRole('button', { name: '關閉主選單' }))
    expect(drawer()).toBeNull()
    expect(document.body.classList.contains(SCROLL_LOCK_CLASS)).toBe(false)
  })

  it('按 Escape 可以關閉 drawer', async () => {
    const user = userEvent.setup()
    renderLayout()
    await user.click(openButton())
    expect(drawer()).not.toBeNull()
    await user.keyboard('{Escape}')
    expect(drawer()).toBeNull()
    expect(document.body.classList.contains(SCROLL_LOCK_CLASS)).toBe(false)
  })

  it('點 backdrop 可以關閉 drawer', async () => {
    const user = userEvent.setup()
    const { container } = renderLayout()
    await user.click(openButton())
    const backdrop = container.querySelector('[aria-hidden="true"].fixed.inset-0')
    expect(backdrop).not.toBeNull()
    await user.click(backdrop)
    expect(drawer()).toBeNull()
  })

  it('選了 route 之後 drawer 自動關閉，且不殘留 scroll lock', async () => {
    const user = userEvent.setup()
    renderLayout('/gantt')
    await user.click(openButton())
    const panel = drawer()
    await user.click(within(panel).getByRole('link', { name: /日曆/ }))
    expect(drawer()).toBeNull()
    expect(document.body.classList.contains(SCROLL_LOCK_CLASS)).toBe(false)
    expect(screen.getByText('日曆內容')).toBeTruthy()
  })

  it('離開頁面（unmount）時一定會解除 scroll lock', async () => {
    const user = userEvent.setup()
    const { unmount } = renderLayout()
    await user.click(openButton())
    expect(document.body.classList.contains(SCROLL_LOCK_CLASS)).toBe(true)
    unmount()
    expect(document.body.classList.contains(SCROLL_LOCK_CLASS)).toBe(false)
  })
})

describe('drawer 重構後權限過濾不變', () => {
  it('designer 的 drawer 裡沒有「系統管理／權限設定」', async () => {
    const user = userEvent.setup()
    renderLayout()
    await user.click(openButton())
    const panel = drawer()
    expect(within(panel).queryByText('系統管理')).toBeNull()
    expect(within(panel).queryByRole('link', { name: /權限設定/ })).toBeNull()
  })

  it('manager 的 drawer 才會出現「系統管理／權限設定」', async () => {
    authState.role = 'manager'
    const user = userEvent.setup()
    renderLayout()
    await user.click(openButton())
    const panel = drawer()
    expect(within(panel).getByText('系統管理')).toBeTruthy()
    expect(within(panel).getByRole('link', { name: /權限設定/ })).toBeTruthy()
  })

  it('designer 在桌面 Sidebar 與 drawer 看到的導覽項目完全一致（同一份 NavContent）', async () => {
    const user = userEvent.setup()
    const { container } = renderLayout()
    const sidebarLinks = [...container.querySelectorAll('aside a')].map(a => a.textContent.trim())
    await user.click(openButton())
    const panel = drawer()
    const drawerLinks = [...panel.querySelectorAll('a')].map(a => a.textContent.trim())
    expect(drawerLinks).toEqual(sidebarLinks)
  })

  it('designer 看不到 manager 專用頁（甘特圖／需求審核／設計師儀表板）的連結', async () => {
    const user = userEvent.setup()
    renderLayout()
    await user.click(openButton())
    const panel = drawer()
    // 用精確比對，避免「甘特圖」誤中 designer 本來就看得到的「秀展甘特圖」
    for (const label of ['甘特圖', '需求審核', '設計師儀表板', '負責人與設計師管理']) {
      expect(within(panel).queryByRole('link', { name: label })).toBeNull()
    }
    // 對照組：designer 本來就看得到的「秀展甘特圖」仍然在
    expect(within(panel).getByRole('link', { name: '秀展甘特圖' })).toBeTruthy()
  })
})
