import { describe, it, expect } from 'vitest'
import { projectPhase, buildRequestBarsForDesigner } from '../../src/utils/milestoneUtils.js'

const ACTIVE_STATUSES = ['assigned', 'in_progress', 'reviewing']

describe('projectPhase', () => {
  const today = '2026-08-13'

  it('startDate<=今天<=endDate → ongoing', () => {
    expect(projectPhase({ startDate: '2026-08-10', endDate: '2026-08-15' }, today)).toBe('ongoing')
    expect(projectPhase({ startDate: today, endDate: today }, today)).toBe('ongoing') // 起訖日都是今天
  })

  it('今天 < startDate → upcoming', () => {
    expect(projectPhase({ startDate: '2026-08-20', endDate: '2026-08-25' }, today)).toBe('upcoming')
  })

  it('今天 > endDate → ended', () => {
    expect(projectPhase({ startDate: '2026-08-01', endDate: '2026-08-05' }, today)).toBe('ended')
  })

  it('缺少 startDate 或 endDate 回傳 null，不會誤判成任何階段', () => {
    expect(projectPhase({ startDate: '2026-08-01' }, today)).toBe(null)
    expect(projectPhase({ endDate: '2026-08-01' }, today)).toBe(null)
    expect(projectPhase({}, today)).toBe(null)
  })

  it('project 是 null/undefined 安全回傳 null，不會噴錯', () => {
    expect(projectPhase(null, today)).toBe(null)
    expect(projectPhase(undefined, today)).toBe(null)
  })
})

describe('buildRequestBarsForDesigner', () => {
  const base = {
    id: 'r1',
    projectName: 'MVP / AD獎盃 製作',
    status: 'assigned',
    assignedDesigners: ['alice@transcend.com'],
    dueDate: '2026-09-01',
    reviewedAt: { seconds: 1755043200 }, // 2025-08-13
    createdAt: { seconds: 1754956800 },
  }

  it('指派給該設計師且狀態為進行中，回傳一筆 request 類型的 bar', () => {
    const bars = buildRequestBarsForDesigner('alice@transcend.com', [base], ACTIVE_STATUSES)
    expect(bars).toHaveLength(1)
    expect(bars[0]).toMatchObject({
      projectId: 'r1',
      projectName: 'MVP / AD獎盃 製作',
      type: 'request',
      role: 'designer',
    })
    expect(bars[0].workStart).toBeInstanceOf(Date)
    expect(bars[0].workEnd).toEqual(new Date('2026-09-01'))
  })

  it('同一需求指派多位設計師，各自都能看到自己的 bar', () => {
    const multi = { ...base, assignedDesigners: ['alice@transcend.com', 'bob@transcend.com'] }
    expect(buildRequestBarsForDesigner('alice@transcend.com', [multi], ACTIVE_STATUSES)).toHaveLength(1)
    expect(buildRequestBarsForDesigner('bob@transcend.com', [multi], ACTIVE_STATUSES)).toHaveLength(1)
  })

  it('非本人被指派的需求不會出現', () => {
    expect(buildRequestBarsForDesigner('carol@transcend.com', [base], ACTIVE_STATUSES)).toHaveLength(0)
  })

  it('狀態不在 ACTIVE_STATUSES(如 completed/pending/rejected)不佔用甘特圖時段', () => {
    for (const status of ['completed', 'pending', 'rejected']) {
      expect(buildRequestBarsForDesigner('alice@transcend.com', [{ ...base, status }], ACTIVE_STATUSES)).toHaveLength(0)
    }
  })

  it('缺 dueDate 就跳過，避免畫出沒有終點的區間', () => {
    expect(buildRequestBarsForDesigner('alice@transcend.com', [{ ...base, dueDate: null }], ACTIVE_STATUSES)).toHaveLength(0)
  })

  it('缺 reviewedAt 時退回 createdAt 當 workStart', () => {
    const noReviewed = { ...base, reviewedAt: null }
    const bars = buildRequestBarsForDesigner('alice@transcend.com', [noReviewed], ACTIVE_STATUSES)
    expect(bars).toHaveLength(1)
    expect(bars[0].workStart).toEqual(new Date(base.createdAt.seconds * 1000))
  })

  it('personEmail 為空字串/undefined 安全回傳空陣列', () => {
    expect(buildRequestBarsForDesigner('', [base], ACTIVE_STATUSES)).toEqual([])
    expect(buildRequestBarsForDesigner(undefined, [base], ACTIVE_STATUSES)).toEqual([])
  })

  it('requests 是空陣列/undefined 安全回傳空陣列', () => {
    expect(buildRequestBarsForDesigner('alice@transcend.com', [], ACTIVE_STATUSES)).toEqual([])
    expect(buildRequestBarsForDesigner('alice@transcend.com', undefined, ACTIVE_STATUSES)).toEqual([])
  })
})
