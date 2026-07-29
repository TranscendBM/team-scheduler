import { describe, it, expect } from 'vitest'
import { STATUS, statusMeta, NEXT_STATUS, STATUS_TIMESTAMP, ACTIVE_STATUSES } from '../../src/utils/requestConstants.js'

const ALL_STATUSES = ['pending', 'rejected', 'assigned', 'in_progress', 'reviewing', 'completed']

describe('requestConstants', () => {
  it('STATUS 涵蓋所有既定 enum 值', () => {
    expect(Object.keys(STATUS).sort()).toEqual(ALL_STATUSES.slice().sort())
  })

  it('statusMeta 對未知狀態有安全的 fallback，不會噴錯', () => {
    const meta = statusMeta('not-a-real-status')
    expect(meta.label).toBe('not-a-real-status')
    expect(meta.color).toContain('bg-gray-100')
  })

  it('NEXT_STATUS 只允許單步推進，且每一步都指向合法狀態', () => {
    for (const [from, to] of Object.entries(NEXT_STATUS)) {
      expect(ALL_STATUSES).toContain(from)
      expect(ALL_STATUSES).toContain(to)
    }
    // 不可能跳兩步：例如 assigned 不會直接指向 completed
    expect(NEXT_STATUS.assigned).toBe('in_progress')
    expect(NEXT_STATUS.in_progress).toBe('reviewing')
    expect(NEXT_STATUS.reviewing).toBe('completed')
    expect(NEXT_STATUS.completed).toBeUndefined()
    expect(NEXT_STATUS.pending).toBeUndefined()
  })

  it('STATUS_TIMESTAMP 的 key 都是 NEXT_STATUS 可能推進到的狀態', () => {
    for (const key of Object.keys(STATUS_TIMESTAMP)) {
      expect(Object.values(NEXT_STATUS)).toContain(key)
    }
  })

  it('ACTIVE_STATUSES 不包含 completed/rejected/pending', () => {
    expect(ACTIVE_STATUSES).not.toContain('completed')
    expect(ACTIVE_STATUSES).not.toContain('rejected')
    expect(ACTIVE_STATUSES).not.toContain('pending')
  })
})
