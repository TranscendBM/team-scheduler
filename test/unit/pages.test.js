import { describe, it, expect } from 'vitest'
import { canAccess, ADJUSTABLE_PAGES, PAGES } from '../../src/utils/pages.js'

describe('canAccess', () => {
  it('manager 永遠可以看到所有頁面', () => {
    for (const p of PAGES) {
      expect(canAccess({}, p.key, 'manager')).toBe(true)
    }
  })

  it('fixed 頁面（review/dashboard/tradeshow-assignments/gantt）designer/planner 永遠看不到，即使 perms 硬要覆蓋成 true', () => {
    const fixedKeys = PAGES.filter((p) => p.fixed).map((p) => p.key)
    expect(fixedKeys).toEqual(expect.arrayContaining(['review', 'dashboard', 'tradeshow-assignments', 'gantt']))
    for (const key of fixedKeys) {
      const perms = { [key]: { designer: true, planner: true } }
      expect(canAccess(perms, key, 'designer')).toBe(false)
      expect(canAccess(perms, key, 'planner')).toBe(false)
    }
  })

  it('review/dashboard/tradeshow-assignments/gantt 不應出現在可調整矩陣中', () => {
    const adjustableKeys = ADJUSTABLE_PAGES.map((p) => p.key)
    expect(adjustableKeys).not.toContain('review')
    expect(adjustableKeys).not.toContain('dashboard')
    expect(adjustableKeys).not.toContain('tradeshow-assignments')
    expect(adjustableKeys).not.toContain('gantt')
  })

  it('甘特圖是 manager 專用：判斷團隊人力狀況、且非 manager 讀 requests 全表本來就會被 Firestore 規則拒絕', () => {
    expect(canAccess({}, 'gantt', 'manager')).toBe(true)
    expect(canAccess({}, 'gantt', 'designer')).toBe(false)
    expect(canAccess({}, 'gantt', 'planner')).toBe(false)
  })

  it('tradeshow-assignments 業務規則本來就是 manager-only：元件本身也硬性鎖定(TradeshowAssignmentsPage 對非 manager 顯示鎖定畫面)，矩陣與元件不會互相矛盾', () => {
    expect(canAccess({}, 'tradeshow-assignments', 'manager')).toBe(true)
    expect(canAccess({}, 'tradeshow-assignments', 'designer')).toBe(false)
    expect(canAccess({}, 'tradeshow-assignments', 'planner')).toBe(false)
  })

  it('未知頁面一律回傳 false', () => {
    expect(canAccess({}, 'not-a-real-page', 'manager')).toBe(false)
    expect(canAccess({}, 'not-a-real-page', 'designer')).toBe(false)
  })

  it('沒有 perms 覆蓋時使用 defaults', () => {
    expect(canAccess({}, 'tradeshow-list', 'designer')).toBe(true)   // defaults.designer = true
    expect(canAccess({}, 'tradeshow-list', 'planner')).toBe(true)    // defaults.planner = true
  })

  it('perms 覆蓋可調整頁面的預設值', () => {
    const perms = { 'tradeshow-list': { designer: false, planner: true } }
    expect(canAccess(perms, 'tradeshow-list', 'designer')).toBe(false)
    expect(canAccess(perms, 'tradeshow-list', 'planner')).toBe(true)
  })
})
