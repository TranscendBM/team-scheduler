import { describe, it, expect } from 'vitest'
import { canAccess, ADJUSTABLE_PAGES, PAGES } from '../../src/utils/pages.js'

describe('canAccess', () => {
  it('manager 永遠可以看到所有頁面', () => {
    for (const p of PAGES) {
      expect(canAccess({}, p.key, 'manager')).toBe(true)
    }
  })

  it('fixed 頁面（review/dashboard）designer/planner 永遠看不到，即使 perms 硬要覆蓋成 true', () => {
    const fixedKeys = PAGES.filter((p) => p.fixed).map((p) => p.key)
    expect(fixedKeys).toEqual(expect.arrayContaining(['review', 'dashboard']))
    for (const key of fixedKeys) {
      const perms = { [key]: { designer: true, planner: true } }
      expect(canAccess(perms, key, 'designer')).toBe(false)
      expect(canAccess(perms, key, 'planner')).toBe(false)
    }
  })

  it('review/dashboard 不應出現在可調整矩陣中', () => {
    const adjustableKeys = ADJUSTABLE_PAGES.map((p) => p.key)
    expect(adjustableKeys).not.toContain('review')
    expect(adjustableKeys).not.toContain('dashboard')
  })

  it('未知頁面一律回傳 false', () => {
    expect(canAccess({}, 'not-a-real-page', 'manager')).toBe(false)
    expect(canAccess({}, 'not-a-real-page', 'designer')).toBe(false)
  })

  it('沒有 perms 覆蓋時使用 defaults', () => {
    expect(canAccess({}, 'gantt', 'designer')).toBe(true)   // defaults.designer = true
    expect(canAccess({}, 'gantt', 'planner')).toBe(true)    // defaults.planner = true（planner 的工作排程也要看得到甘特圖）
  })

  it('perms 覆蓋可調整頁面的預設值', () => {
    const perms = { gantt: { designer: false, planner: true } }
    expect(canAccess(perms, 'gantt', 'designer')).toBe(false)
    expect(canAccess(perms, 'gantt', 'planner')).toBe(true)
  })
})
