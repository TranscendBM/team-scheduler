import { describe, it, expect } from 'vitest'
import { assignedPersonIds, hasAssignedPerson } from '../../src/utils/tradeshowAssignments.js'

const show = (assignments) => ({ assignments })

describe('assignedPersonIds', () => {
  it('取出指定角色的 personId，去重', () => {
    const projects = [
      show([{ personId: 'a', role: 'planner' }, { personId: 'b', role: 'designer' }]),
      show([{ personId: 'a', role: 'planner' }]), // 同一人在另一場秀展也是 planner，不重複列出
    ]
    expect(assignedPersonIds(projects, 'planner')).toEqual(['a'])
    expect(assignedPersonIds(projects, 'designer')).toEqual(['b'])
  })

  it('沒有任何指派時回傳空陣列，不會噴錯', () => {
    expect(assignedPersonIds([], 'planner')).toEqual([])
    expect(assignedPersonIds([show([])], 'planner')).toEqual([])
    expect(assignedPersonIds([show(undefined)], 'planner')).toEqual([])
  })

  it('projects 本身是 undefined/null 也安全回傳空陣列', () => {
    expect(assignedPersonIds(undefined, 'planner')).toEqual([])
    expect(assignedPersonIds(null, 'planner')).toEqual([])
  })

  it('assignments 陣列裡混入 null/格式異常的項目不會噴錯，安全跳過', () => {
    const projects = [show([null, { personId: 'a', role: 'planner' }, {}])]
    expect(assignedPersonIds(projects, 'planner')).toEqual(['a'])
  })
})

describe('hasAssignedPerson', () => {
  it('指定角色的其中一人在 ids 清單內 → true', () => {
    const p = show([{ personId: 'a', role: 'planner' }, { personId: 'b', role: 'designer' }])
    expect(hasAssignedPerson(p, 'planner', ['a', 'x'])).toBe(true)
  })

  it('角色不符即使 personId 在清單內也是 false(planner/designer 分開比對)', () => {
    const p = show([{ personId: 'a', role: 'designer' }])
    expect(hasAssignedPerson(p, 'planner', ['a'])).toBe(false)
  })

  it('沒有任何符合的人 → false', () => {
    const p = show([{ personId: 'a', role: 'planner' }])
    expect(hasAssignedPerson(p, 'planner', ['b', 'c'])).toBe(false)
  })

  it('project 沒有 assignments 欄位／是 null 都安全回傳 false', () => {
    expect(hasAssignedPerson({}, 'planner', ['a'])).toBe(false)
    expect(hasAssignedPerson(null, 'planner', ['a'])).toBe(false)
    expect(hasAssignedPerson(undefined, 'planner', ['a'])).toBe(false)
  })

  it('ids 是空陣列 → 永遠 false(呼叫端負責在 filters.length===0 時跳過這個判斷，不是這個函式的責任)', () => {
    const p = show([{ personId: 'a', role: 'planner' }])
    expect(hasAssignedPerson(p, 'planner', [])).toBe(false)
  })
})
