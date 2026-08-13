import { describe, it, expect } from 'vitest'
import { projectPhase } from '../../src/utils/milestoneUtils.js'

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
