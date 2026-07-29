import { describe, it, expect } from 'vitest'
import { getRequestAction } from '../../src/utils/requestActions.js'

const DESIGNER = 'designer.a@example.com'
const OTHER_DESIGNER = 'designer.b@example.com'

describe('getRequestAction — 動作欄可用動作需與 firestore.rules 狀態機一致', () => {
  it('assigned:被指派的設計師只能「開始設計」(→ in_progress)', () => {
    const r = { status: 'assigned', assignedDesigners: [DESIGNER] }
    expect(getRequestAction(r, 'designer', DESIGNER)).toEqual({ type: 'advance', next: 'in_progress', label: '開始設計' })
  })

  it('in_progress:被指派的設計師只能「送出確認」(→ reviewing)', () => {
    const r = { status: 'in_progress', assignedDesigners: [DESIGNER] }
    expect(getRequestAction(r, 'designer', DESIGNER)).toEqual({ type: 'advance', next: 'reviewing', label: '送出確認' })
  })

  it('reviewing:被指派的設計師只能「打勾結案」(→ completed)', () => {
    const r = { status: 'reviewing', assignedDesigners: [DESIGNER] }
    expect(getRequestAction(r, 'designer', DESIGNER)).toEqual({ type: 'advance', next: 'completed', label: '打勾結案' })
  })

  it('completed:設計師沒有任何動作可做(不能跳階，也沒有下一步)', () => {
    const r = { status: 'completed', assignedDesigners: [DESIGNER] }
    expect(getRequestAction(r, 'designer', DESIGNER)).toBeNull()
  })

  it('pending/rejected:設計師沒有動作(這兩個狀態不在 NEXT_STATUS 裡)', () => {
    expect(getRequestAction({ status: 'pending', assignedDesigners: [DESIGNER] }, 'designer', DESIGNER)).toBeNull()
    expect(getRequestAction({ status: 'rejected', assignedDesigners: [DESIGNER] }, 'designer', DESIGNER)).toBeNull()
  })

  it('未被指派的設計師看不到任何動作，即使狀態允許推進', () => {
    const r = { status: 'assigned', assignedDesigners: [OTHER_DESIGNER] }
    expect(getRequestAction(r, 'designer', DESIGNER)).toBeNull()
  })

  it('planner:assigned/in_progress/reviewing 都能結案', () => {
    for (const status of ['assigned', 'in_progress', 'reviewing']) {
      expect(getRequestAction({ status }, 'planner', 'planner@example.com')).toEqual({ type: 'close', next: 'completed', label: '✓ 結案' })
    }
  })

  it('planner:pending/rejected/completed 都不能結案(結案按鈕不應顯示)', () => {
    for (const status of ['pending', 'rejected', 'completed']) {
      expect(getRequestAction({ status }, 'planner', 'planner@example.com')).toBeNull()
    }
  })

  it('manager 在這個動作欄沒有動作(刪除另外在詳情視窗，不走這個函式)', () => {
    expect(getRequestAction({ status: 'assigned' }, 'manager', 'manager@example.com')).toBeNull()
  })
})
