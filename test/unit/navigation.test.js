import { describe, it, expect } from 'vitest'
import { buildNavGroups, visibleNavPages, totalBadgeCount } from '../../src/utils/navigation.js'
import { PAGES, GROUPS, canAccess as canAccessFn } from '../../src/utils/pages.js'

// RWD 重構把側邊選單抽成 NavContent（桌面 Sidebar 與行動版 drawer 共用），
// 這組測試確保「抽出去之後權限過濾結果跟改版前完全一樣」。
const canAccessFor = (perms) => (pageKey, role) => canAccessFn(perms, pageKey, role)

function keysFor(role, { perms = {}, canReview = false } = {}) {
  return visibleNavPages({ pages: PAGES, canAccess: canAccessFor(perms), role, canReview }).map(p => p.key)
}

describe('導覽權限過濾（drawer 重構後不變）', () => {
  it('manager 看得到所有 PAGES', () => {
    expect(keysFor('manager')).toEqual(PAGES.map(p => p.key))
  })

  it('designer / planner 看不到任何 fixed:manager 的頁面', () => {
    const fixedKeys = PAGES.filter(p => p.fixed).map(p => p.key)
    for (const role of ['designer', 'planner']) {
      const visible = keysFor(role)
      for (const k of fixedKeys) expect(visible).not.toContain(k)
    }
  })

  it('即使權限矩陣硬塞 true，designer/planner 還是看不到 fixed 頁面', () => {
    const perms = Object.fromEntries(PAGES.filter(p => p.fixed).map(p => [p.key, { designer: true, planner: true }]))
    for (const role of ['designer', 'planner']) {
      for (const p of PAGES.filter(x => x.fixed)) {
        expect(keysFor(role, { perms })).not.toContain(p.key)
      }
    }
  })

  it('非 manager 只有被指派為臨時審核代理人時才看得到「需求審核」', () => {
    expect(keysFor('designer')).not.toContain('review')
    expect(keysFor('designer', { canReview: true })).toContain('review')
  })

  it('buildNavGroups 只輸出有項目的群組，且項目都屬於該群組', () => {
    const groups = buildNavGroups({ pages: PAGES, groups: GROUPS, canAccess: canAccessFor({}), role: 'manager', canReview: false })
    expect(groups.length).toBeGreaterThan(0)
    for (const g of groups) {
      expect(g.items.length).toBeGreaterThan(0)
      for (const item of g.items) expect(item.group).toBe(g.key)
    }
    // 群組化之後總項目數要跟過濾結果一致（不多不少）
    const total = groups.reduce((n, g) => n + g.items.length, 0)
    expect(total).toBe(keysFor('manager').length)
  })

  it('行動版 top bar 的提示數只加總「這個角色看得到的頁面」，不會洩漏 manager 專用的待審核數', () => {
    const badgeFor = (key) => (key === 'review' ? 7 : key === 'requests' ? 2 : 0)
    const managerGroups = buildNavGroups({ pages: PAGES, groups: GROUPS, canAccess: canAccessFor({}), role: 'manager', canReview: false })
    const designerGroups = buildNavGroups({ pages: PAGES, groups: GROUPS, canAccess: canAccessFor({}), role: 'designer', canReview: false })
    expect(totalBadgeCount(managerGroups, badgeFor)).toBe(9)
    expect(totalBadgeCount(designerGroups, badgeFor)).toBe(2) // 只有需求總表，沒有 review
  })
})
