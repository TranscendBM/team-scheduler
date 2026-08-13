// 需求列表「動作欄」該顯示什麼動作 —— 純函式，刻意跟 firestore.rules 的狀態機保持一致：
// designer 只能單步推進(isDesignerTransition)，planner 只能把「已審核、未結案」的需求結案
// (assigned/in_progress/reviewing，不含 pending/rejected/completed)。
// 規則本身才是最終防線，這裡只負責讓 UI 不要暴露規則不允許的操作。
import { NEXT_STATUS, NEXT_STATUS_LABEL, ACTIVE_STATUSES } from './requestConstants'

export function getRequestAction(r, role, email) {
  if (role === 'designer' && (r.assignedDesigners || []).includes(email)) {
    const next = NEXT_STATUS[r.status]
    if (!next) return null
    return { type: 'advance', next, label: NEXT_STATUS_LABEL[r.status] }
  }
  if (role === 'planner' && ACTIVE_STATUSES.includes(r.status)) {
    return { type: 'close', next: 'completed', label: '✓ 結案' }
  }
  return null
}

// 「我的需求」列表:已結案的請求群組起來放最下方，不要跟其他狀態混在一起依建立時間排序——
// 已結案是「不再需要關注」的請求，混在最上面容易擠掉真正需要處理/追蹤的項目。
// 未結案維持呼叫端既有的順序(通常是 createdAt 新到舊)；已結案這組額外依 completedAt
// (沒有就退回 createdAt，涵蓋這個欄位還沒存在時就已經結案的舊資料)重新排序，
// 最近結案的排在這組最前面。
export function groupRequestsForList(requests) {
  const active = (requests || []).filter((r) => r.status !== 'completed')
  const completed = (requests || [])
    .filter((r) => r.status === 'completed')
    .slice()
    .sort((a, b) =>
      (b.completedAt?.seconds || b.createdAt?.seconds || 0) - (a.completedAt?.seconds || a.createdAt?.seconds || 0))
  return { active, completed }
}

// 「我的需求」列表依交期排序(近到遠 asc／遠到近 desc)。dueDate 是 'yyyy-mm-dd' 字串，
// 字串排序天生就等於日期排序，不需要轉成 Date 物件。沒填交期的一律排到最後面(不管哪個
// 方向)——「未指定」不是「最近」也不是「最遠」，跟其他有交期的項目沒有比較意義，
// 硬要排進去只會讓使用者誤以為它是最近或最遠的一筆。
export function sortByDueDate(requests, direction) {
  const withDate = (requests || []).filter((r) => r.dueDate)
  const withoutDate = (requests || []).filter((r) => !r.dueDate)
  withDate.sort((a, b) =>
    direction === 'desc' ? b.dueDate.localeCompare(a.dueDate) : a.dueDate.localeCompare(b.dueDate))
  return [...withDate, ...withoutDate]
}
