// 可設定權限的頁面清單（集中管理）。
// manager 永遠全部可見；矩陣只調 designer / planner。
// defaults：settings/permissions 尚未設定時的預設可見角色。
// fixed: 'manager' — 此頁固定僅 manager 可用，不可透過權限矩陣調整。
//   原因：這類頁面的 Firestore 查詢（如未過濾條件的 collection(db,'requests') 全表讀取）
//   在安全規則下「結構上」就只有 manager 能通過（designer/planner 的讀取規則需逐筆條件比對，
//   無條件的 list 查詢會被 Firestore 直接整體拒絕）。若讓其他角色「看得到但打不開」，
//   會出現使用者點進頁面卻满版 permission-denied 的壞體驗，因此從矩陣移除、程式碼層級鎖死。
export const GROUPS = [
  { key: 'overview', label: '總覽' },
  { key: 'tradeshow', label: '秀展' },
  { key: 'requests', label: '需求發稿' },
  { key: 'projects', label: '專案管理' },
  { key: 'schedule', label: '排程管理' },
]

export const PAGES = [
  // ── 總覽：個人儀表板（登入時的重點資訊）+ 甘特圖（planner/設計師工作排程）──
  { key: 'my-dashboard', path: '/dashboard-me', label: '我的儀表板', icon: '🏠', group: 'overview', defaults: { designer: true, planner: true } },
  { key: 'gantt', path: '/gantt', label: '甘特圖', icon: '📊', group: 'overview', defaults: { designer: true, planner: true } },

  // ── 秀展（獨立於排程管理之外，秀展是主要業務）──
  { key: 'tradeshow-analysis',    path: '/tradeshow-analysis',    label: '秀展分析',       icon: '📈', group: 'tradeshow', defaults: { designer: true,  planner: false } },
  { key: 'tradeshow-list',        path: '/tradeshow-list',        label: '展覽列表',       icon: '📋', group: 'tradeshow', defaults: { designer: true,  planner: true } },
  { key: 'tradeshow-targets',     path: '/tradeshow-targets',     label: '年度目標',       icon: '🎯', group: 'tradeshow', defaults: { designer: false, planner: false } },
  { key: 'tradeshow-assignments', path: '/tradeshow-assignments', label: '負責人與設計師管理', icon: '👥', group: 'tradeshow', fixed: 'manager' },
  { key: 'tradeshow-gantt',       path: '/tradeshow-gantt',       label: '秀展甘特圖',     icon: '📊', group: 'tradeshow', defaults: { designer: true,  planner: false } },

  { key: 'request/new', path: '/request/new', label: '提交需求', icon: '📝', group: 'requests', defaults: { designer: false, planner: true } },
  { key: 'my-requests', path: '/my-requests', label: '我的需求', icon: '📄', group: 'requests', defaults: { designer: false, planner: true } },
  { key: 'requests',    path: '/requests',    label: '需求總表', icon: '🗂️', group: 'requests', defaults: { designer: true, planner: true } },
  { key: 'review',      path: '/review',      label: '需求審核', icon: '⚖️', group: 'requests', fixed: 'manager' },
  { key: 'dashboard',   path: '/dashboard',   label: '設計師儀表板', icon: '📈', group: 'requests', fixed: 'manager' },
  { key: 'calendar',    path: '/calendar',    label: '日曆',     icon: '📅', group: 'schedule', defaults: { designer: true,  planner: false } },
  { key: 'leave',       path: '/leave',       label: '休假預排', icon: '🏖️', group: 'schedule', defaults: { designer: true,  planner: false } },
  { key: 'sponsor',     path: '/sponsor',     label: '體總贊助', icon: '🏆', group: 'schedule', defaults: { designer: true,  planner: false } },
  { key: 'people',      path: '/people',      label: '人員管理', icon: '👥', group: 'schedule', defaults: { designer: true,  planner: false } },
  { key: 'settings',    path: '/settings',    label: '里程碑設定', icon: '⚙️', group: 'schedule', defaults: { designer: false, planner: false } },

  // ── 專案管理（活動/報獎/設計 各自獨立維護）──
  { key: 'projects-event',  path: '/projects/event',  label: '活動', icon: '🎉', group: 'projects', defaults: { designer: true, planner: false } },
  { key: 'projects-award',  path: '/projects/award',  label: '報獎', icon: '🏆', group: 'projects', defaults: { designer: true, planner: false } },
  { key: 'projects-design', path: '/projects/design', label: '設計', icon: '🎨', group: 'projects', defaults: { designer: true, planner: false } },
]

export const PAGE_BY_KEY = Object.fromEntries(PAGES.map(p => [p.key, p]))

// manager 永遠 true；fixed 頁面其他角色永遠 false（不受 perms 覆蓋）；
// 其餘依 perms 覆蓋，沒設定就用 defaults
export function canAccess(perms, pageKey, role) {
  const page = PAGE_BY_KEY[pageKey]
  if (!page) return false
  if (page.fixed) return role === page.fixed
  if (role === 'manager') return true
  const override = perms?.[pageKey]?.[role]
  if (typeof override === 'boolean') return override
  return !!page.defaults[role]
}

// 可在權限矩陣中調整的頁面（排除 fixed）
export const ADJUSTABLE_PAGES = PAGES.filter(p => !p.fixed)
