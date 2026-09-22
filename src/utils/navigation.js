// 側邊選單 / 行動版 drawer 共用的導覽資料組裝（純函式，方便單元測試）。
//
// 這裡刻意只做「可見性過濾 + 依 group 分組」，不碰任何權限判斷本身：
// canAccess 由呼叫端（Layout）從 PermissionsContext 傳進來，規則仍然完全由
// src/utils/pages.js 的 canAccess 決定。RWD 重構把導覽抽出來共用時，權限邏輯
// 必須跟重構前一模一樣——這支函式存在的目的就是讓那件事可以被測試驗證。
//
// review 是動態例外：manager 固定看得到，非 manager 只有目前被指派為臨時審核
// 代理人（canReview）才看得到（canAccess('review', role) 對 designer/planner 恆為 false，
// 因為 pages.js 寫死 fixed:'manager'）。

export function visibleNavPages({ pages, canAccess, role, canReview }) {
  return pages.filter(p => canAccess(p.key, role) || (p.key === 'review' && canReview))
}

export function buildNavGroups({ pages, groups, canAccess, role, canReview }) {
  const visible = visibleNavPages({ pages, canAccess, role, canReview })
  return groups
    .map(g => ({ ...g, items: visible.filter(p => p.group === g.key) }))
    .filter(g => g.items.length > 0)
}

// 行動版 top bar 的提示小紅點：只加總「這個角色本來就看得到的頁面」的 badge，
// 不會把 manager 專用的待審核數量洩漏給其他角色。
export function totalBadgeCount(navGroups, badgeFor) {
  return navGroups.reduce(
    (sum, g) => sum + g.items.reduce((s, item) => s + (badgeFor(item.key) || 0), 0),
    0,
  )
}
