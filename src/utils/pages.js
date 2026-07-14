// 可設定權限的頁面清單（集中管理）。
// manager 永遠全部可見；矩陣只調 designer / planner。
// defaults：settings/permissions 尚未設定時的預設可見角色。
export const GROUPS = [
  { key: 'requests', label: '需求發稿' },
  { key: 'schedule', label: '排程管理' },
]

export const PAGES = [
  { key: 'request/new', path: '/request/new', label: '提交需求', icon: '📝', group: 'requests', defaults: { designer: false, planner: true } },
  { key: 'my-requests', path: '/my-requests', label: '我的需求', icon: '📄', group: 'requests', defaults: { designer: false, planner: true } },
  { key: 'requests',    path: '/requests',    label: '需求總表', icon: '🗂️', group: 'requests', defaults: { designer: true, planner: true } },
  { key: 'review',      path: '/review',      label: '需求審核', icon: '⚖️', group: 'requests', defaults: { designer: false, planner: false } },
  { key: 'dashboard',   path: '/dashboard',   label: '設計師儀表板', icon: '📈', group: 'requests', defaults: { designer: false, planner: false } },
  { key: 'gantt',       path: '/',            label: '甘特圖',   icon: '📊', end: true, group: 'schedule', defaults: { designer: true, planner: false } },
  { key: 'calendar',    path: '/calendar',    label: '日曆',     icon: '📅', group: 'schedule', defaults: { designer: true,  planner: false } },
  { key: 'projects',    path: '/projects',    label: '專案管理', icon: '📋', group: 'schedule', defaults: { designer: true,  planner: false } },
  { key: 'leave',       path: '/leave',       label: '休假預排', icon: '🏖️', group: 'schedule', defaults: { designer: true,  planner: false } },
  { key: 'sponsor',     path: '/sponsor',     label: '體總贊助', icon: '🏆', group: 'schedule', defaults: { designer: true,  planner: false } },
  { key: 'people',      path: '/people',      label: '人員管理', icon: '👥', group: 'schedule', defaults: { designer: true,  planner: false } },
  { key: 'settings',    path: '/settings',    label: '里程碑設定', icon: '⚙️', group: 'schedule', defaults: { designer: false, planner: false } },
  { key: 'import',      path: '/import',      label: '匯入 Excel', icon: '📥', group: 'schedule', defaults: { designer: false, planner: false } },
]

export const PAGE_BY_KEY = Object.fromEntries(PAGES.map(p => [p.key, p]))

// manager 永遠 true；其餘依 perms 覆蓋，沒設定就用 defaults
export function canAccess(perms, pageKey, role) {
  if (role === 'manager') return true
  const page = PAGE_BY_KEY[pageKey]
  if (!page) return false
  const override = perms?.[pageKey]?.[role]
  if (typeof override === 'boolean') return override
  return !!page.defaults[role]
}
