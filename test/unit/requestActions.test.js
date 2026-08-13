import { describe, it, expect } from 'vitest'
import { getRequestAction, groupRequestsForList, sortByDueDate, designerNamesFor, groupByDesigner } from '../../src/utils/requestActions.js'

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

describe('sortByDueDate — 我的需求依交期排序', () => {
  const far = { id: 'far', dueDate: '2026-12-01' }
  const near = { id: 'near', dueDate: '2026-08-01' }
  const mid = { id: 'mid', dueDate: '2026-10-01' }

  it('asc(近到遠):交期字串由小到大，最快到期的排最前面', () => {
    const result = sortByDueDate([far, near, mid], 'asc')
    expect(result.map(r => r.id)).toEqual(['near', 'mid', 'far'])
  })

  it('desc(遠到近):交期由大到小，最晚到期的排最前面', () => {
    const result = sortByDueDate([far, near, mid], 'desc')
    expect(result.map(r => r.id)).toEqual(['far', 'mid', 'near'])
  })

  it('沒有交期的一律排最後面，不管哪個方向(不是「最近」也不是「最遠」)', () => {
    const noDate = { id: 'no-date' }
    const ascResult = sortByDueDate([noDate, far, near], 'asc')
    expect(ascResult[ascResult.length - 1].id).toBe('no-date')
    const descResult = sortByDueDate([noDate, far, near], 'desc')
    expect(descResult[descResult.length - 1].id).toBe('no-date')
  })

  it('多筆沒有交期的維持彼此的相對順序(穩定排序)', () => {
    const nd1 = { id: 'nd1' }
    const nd2 = { id: 'nd2' }
    const result = sortByDueDate([nd1, near, nd2], 'asc')
    expect(result.map(r => r.id)).toEqual(['near', 'nd1', 'nd2'])
  })

  it('空陣列／undefined 輸入都安全回傳空陣列，不會噴錯', () => {
    expect(sortByDueDate([], 'asc')).toEqual([])
    expect(sortByDueDate(undefined, 'asc')).toEqual([])
  })

  it('不會修改傳入的原始陣列', () => {
    const original = [far, near]
    const originalOrder = original.map(r => r.id)
    sortByDueDate(original, 'asc')
    expect(original.map(r => r.id)).toEqual(originalOrder)
  })
})

describe('designerNamesFor / groupByDesigner — 需求總表依設計師分組(迴歸測試：多位設計師的需求先前只會出現在第一位底下)', () => {
  it('單一設計師：回傳一個名字', () => {
    const r = { assignedDesigners: ['a@x.com'], assignedDesignersNames: ['Sherry'] }
    expect(designerNamesFor(r)).toEqual(['Sherry'])
  })

  it('多位設計師：回傳全部名字，不是只有第一個', () => {
    const r = { assignedDesigners: ['a@x.com', 'b@x.com'], assignedDesignersNames: ['Sherry', 'Tingwei'] }
    expect(designerNamesFor(r)).toEqual(['Sherry', 'Tingwei'])
  })

  it('沒有 assignedDesignersNames 時退回用 email 前綴當名字', () => {
    const r = { assignedDesigners: ['sherry.chen@example.com', 'tingwei.lin@example.com'] }
    expect(designerNamesFor(r)).toEqual(['sherry.chen', 'tingwei.lin'])
  })

  it('沒有指派任何設計師 → 未指派', () => {
    expect(designerNamesFor({ assignedDesigners: [] })).toEqual(['未指派'])
    expect(designerNamesFor({})).toEqual(['未指派'])
    expect(designerNamesFor(null)).toEqual(['未指派'])
  })

  it('對應真實回報案例："MVP / AD獎盃 製作" 同時指派給兩位設計師，兩人的分組都要看得到這筆需求(先前的 bug：只有陣列第一個看得到)', () => {
    const mvpAward = {
      id: 'mvp-award', projectName: 'MVP / AD獎盃 製作',
      assignedDesigners: ['sherry@example.com', 'tingwei@example.com'],
      assignedDesignersNames: ['Sherry', 'Tingwei'],
    }
    const otherReq = {
      id: 'other', projectName: '別的需求',
      assignedDesigners: ['sherry@example.com'], assignedDesignersNames: ['Sherry'],
    }
    const groups = groupByDesigner([mvpAward, otherReq], ['Sherry', 'Tingwei'])
    const groupMap = Object.fromEntries(groups)
    expect(groupMap.Sherry.map(r => r.id)).toContain('mvp-award')
    expect(groupMap.Tingwei.map(r => r.id)).toContain('mvp-award')
    expect(groupMap.Sherry.map(r => r.id)).toContain('other')
    expect(groupMap.Tingwei.map(r => r.id)).not.toContain('other') // Tingwei 沒被指派這筆，不該出現在他的分組
  })

  it('分組依 designerOrder 排序，不在清單內的依字母序排在後面，未指派永遠排最後', () => {
    const reqs = [
      { assignedDesigners: ['z@x.com'], assignedDesignersNames: ['Zoe'] },       // 不在 order 裡
      { assignedDesigners: ['a@x.com'], assignedDesignersNames: ['Abby'] },      // order[1]
      { assignedDesigners: [] },                                                 // 未指派
      { assignedDesigners: ['s@x.com'], assignedDesignersNames: ['Sherry'] },    // order[0]
    ]
    const groups = groupByDesigner(reqs, ['Sherry', 'Abby'])
    expect(groups.map(([name]) => name)).toEqual(['Sherry', 'Abby', 'Zoe', '未指派'])
  })

  it('designerOrder 沒給時(預設空陣列)仍能正常分組，只是排序退回字母序', () => {
    const reqs = [{ assignedDesigners: ['b@x.com'], assignedDesignersNames: ['Bob'] }]
    const groups = groupByDesigner(reqs)
    expect(groups.map(([name]) => name)).toEqual(['Bob'])
  })

  it('空陣列／undefined 輸入都安全回傳空陣列，不會噴錯', () => {
    expect(groupByDesigner([])).toEqual([])
    expect(groupByDesigner(undefined)).toEqual([])
  })
})
