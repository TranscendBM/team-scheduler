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
