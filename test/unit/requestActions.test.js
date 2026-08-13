import { describe, it, expect } from 'vitest'
import { getRequestAction, groupRequestsForList } from '../../src/utils/requestActions.js'

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

describe('groupRequestsForList — 我的需求列表，已結案分組排到最下面', () => {
  it('未結案維持原本順序(呼叫端已排好序，這裡不重新排未結案這組)', () => {
    const r1 = { id: '1', status: 'pending' }
    const r2 = { id: '2', status: 'assigned' }
    const { active } = groupRequestsForList([r1, r2])
    expect(active.map(r => r.id)).toEqual(['1', '2'])
  })

  it('已結案的獨立分成另一組，不出現在 active 裡', () => {
    const pending = { id: '1', status: 'pending' }
    const done = { id: '2', status: 'completed' }
    const { active, completed } = groupRequestsForList([pending, done])
    expect(active.map(r => r.id)).toEqual(['1'])
    expect(completed.map(r => r.id)).toEqual(['2'])
  })

  it('已結案這組依 completedAt 新到舊排序，不是維持原本傳入順序', () => {
    const older = { id: 'older', status: 'completed', completedAt: { seconds: 100 } }
    const newer = { id: 'newer', status: 'completed', completedAt: { seconds: 200 } }
    const { completed } = groupRequestsForList([older, newer]) // 傳入順序刻意是「舊的在前」
    expect(completed.map(r => r.id)).toEqual(['newer', 'older'])
  })

  it('沒有 completedAt 的舊資料退回用 createdAt 排序，不會排序出錯或漏掉', () => {
    const noTimestamp = { id: 'no-ts', status: 'completed' }
    const withCreatedAt = { id: 'has-createdAt', status: 'completed', createdAt: { seconds: 50 } }
    const { completed } = groupRequestsForList([noTimestamp, withCreatedAt])
    expect(completed.map(r => r.id)).toContain('no-ts')
    expect(completed.map(r => r.id)).toContain('has-createdAt')
    expect(completed.length).toBe(2)
  })

  it('全部都是未結案時，completed 是空陣列，不會噴錯', () => {
    const { active, completed } = groupRequestsForList([{ id: '1', status: 'pending' }])
    expect(active.length).toBe(1)
    expect(completed).toEqual([])
  })

  it('全部都已結案時，active 是空陣列', () => {
    const { active, completed } = groupRequestsForList([{ id: '1', status: 'completed' }])
    expect(active).toEqual([])
    expect(completed.length).toBe(1)
  })

  it('空陣列／undefined 輸入都安全回傳兩個空陣列，不會噴錯', () => {
    expect(groupRequestsForList([])).toEqual({ active: [], completed: [] })
    expect(groupRequestsForList(undefined)).toEqual({ active: [], completed: [] })
  })

  it('不會修改傳入的原始陣列(避免呼叫端的既有排序被意外打亂)', () => {
    const original = [
      { id: 'a', status: 'completed', completedAt: { seconds: 1 } },
      { id: 'b', status: 'completed', completedAt: { seconds: 2 } },
    ]
    const originalOrder = original.map(r => r.id)
    groupRequestsForList(original)
    expect(original.map(r => r.id)).toEqual(originalOrder)
  })
})
