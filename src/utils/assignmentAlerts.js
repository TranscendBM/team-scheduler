// 站內「新發稿」明顯通知的判斷 —— 純函式，方便測試。
// 兩種通知對象：
//  1) 設計師：有新的需求被指派給自己 (kind: 'assigned-to-me')
//  2) 提交人(planner)：自己提交的需求被主管審核並指派下去了 (kind: 'my-request-assigned')
// 「已看過」沿用 NotificationsContext 的 seen 集合(localStorage)，點開該筆需求或按「知道了」就會消失。

// 只提醒「最近被指派」的需求：換新裝置/清除瀏覽器資料時 seen 清單是空的，沒有時間限制的話
// 會把所有進行中的舊案件一次全部當成新通知洗版。指派時間用 reviewedAt(核准當下蓋的時間戳)。
export const ALERT_WINDOW_DAYS = 14

// 已被指派、尚未結案的狀態(不含 pending/rejected/completed)
const ASSIGNED_STATES = ['assigned', 'in_progress', 'reviewing']

function tsMs(ts) {
  if (!ts) return 0
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  const t = new Date(ts).getTime()
  return Number.isNaN(t) ? 0 : t
}

// assignedRows: 指派給「我」的需求(設計師的查詢結果)；ownRows: 「我提交」的需求。
// 回傳依指派時間新到舊排序的陣列；manager 不產生通知(審核者自己就是發稿的人)。
export function buildAssignmentAlerts({ role, email, assignedRows, ownRows, seen, nowMs }) {
  if (!email || !role || role === 'manager') return []
  const cutoff = nowMs - ALERT_WINDOW_DAYS * 86400000
  const isRecent = (r) => { const t = tsMs(r.reviewedAt); return t > 0 && t >= cutoff }
  const isUnseen = (r) => !(seen && seen.has(r.id))
  const alerts = new Map()

  if (role === 'designer') {
    for (const r of assignedRows || []) {
      if (!r || !ASSIGNED_STATES.includes(r.status)) continue
      if (!(r.assignedDesigners || []).includes(email)) continue
      if (r.submittedBy === email) continue // 自己送的不算新發稿(與既有 NEW 標示一致)
      if (!isUnseen(r) || !isRecent(r)) continue
      alerts.set(r.id, { id: r.id, kind: 'assigned-to-me', request: r })
    }
  }

  for (const r of ownRows || []) {
    if (!r || r.submittedBy !== email || !ASSIGNED_STATES.includes(r.status)) continue
    if (!isUnseen(r) || !isRecent(r) || alerts.has(r.id)) continue
    alerts.set(r.id, { id: r.id, kind: 'my-request-assigned', request: r })
  }

  return [...alerts.values()].sort((a, b) => tsMs(b.request.reviewedAt) - tsMs(a.request.reviewedAt))
}
