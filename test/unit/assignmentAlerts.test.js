import { describe, it, expect } from 'vitest'
import { buildAssignmentAlerts, ALERT_WINDOW_DAYS } from '../../src/utils/assignmentAlerts.js'

const DAY = 86400000
const NOW = Date.parse('2026-10-15T09:00:00Z')
const ago = (days) => ({ toMillis: () => NOW - days * DAY })
const DESIGNER = 'designer@x.com'
const PLANNER = 'planner@x.com'
const seenNone = new Set()

const assignedToMe = (over = {}) => ({
  id: 'r1', status: 'assigned', assignedDesigners: [DESIGNER], submittedBy: PLANNER, reviewedAt: ago(1), ...over,
})

describe('buildAssignmentAlerts — 設計師收到新發稿', () => {
  const run = (rows, seen = seenNone) =>
    buildAssignmentAlerts({ role: 'designer', email: DESIGNER, assignedRows: rows, ownRows: [], seen, nowMs: NOW })

  it('最近被指派給我、還沒看過：產生 assigned-to-me 通知', () => {
    const a = run([assignedToMe()])
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ id: 'r1', kind: 'assigned-to-me' })
  })

  it('已看過(seen)就不再通知', () => {
    expect(run([assignedToMe()], new Set(['r1']))).toEqual([])
  })

  it('沒有指派給我的需求不通知', () => {
    expect(run([assignedToMe({ assignedDesigners: ['other@x.com'] })])).toEqual([])
  })

  it('自己提交的不算新發稿', () => {
    expect(run([assignedToMe({ submittedBy: DESIGNER })])).toEqual([])
  })

  it('pending / rejected / completed 不通知', () => {
    for (const status of ['pending', 'rejected', 'completed']) {
      expect(run([assignedToMe({ status })])).toEqual([])
    }
  })

  it('指派時間超過時間窗(舊案件)不通知，避免換裝置時洗版；窗內邊界仍通知', () => {
    expect(run([assignedToMe({ reviewedAt: ago(ALERT_WINDOW_DAYS + 1) })])).toEqual([])
    expect(run([assignedToMe({ reviewedAt: ago(ALERT_WINDOW_DAYS - 1) })])).toHaveLength(1)
  })

  it('沒有 reviewedAt 的舊資料不通知', () => {
    expect(run([assignedToMe({ reviewedAt: undefined })])).toEqual([])
  })

  it('支援 Firestore Timestamp 形狀 {seconds}', () => {
    expect(run([assignedToMe({ reviewedAt: { seconds: (NOW - DAY) / 1000 } })])).toHaveLength(1)
  })

  it('多筆依指派時間新到舊排序', () => {
    const a = run([assignedToMe({ id: 'old', reviewedAt: ago(5) }), assignedToMe({ id: 'new', reviewedAt: ago(1) })])
    expect(a.map(x => x.id)).toEqual(['new', 'old'])
  })
})

describe('buildAssignmentAlerts — planner 提交的需求被指派', () => {
  const own = (over = {}) => ({ id: 'p1', status: 'assigned', submittedBy: PLANNER, assignedDesigners: [DESIGNER], reviewedAt: ago(2), ...over })
  const run = (ownRows, seen = seenNone, role = 'planner') =>
    buildAssignmentAlerts({ role, email: PLANNER, assignedRows: [], ownRows, seen, nowMs: NOW })

  it('自己提交的需求被指派：產生 my-request-assigned 通知', () => {
    const a = run([own()])
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ id: 'p1', kind: 'my-request-assigned' })
  })

  it('還在待審核/被駁回/已結案不通知', () => {
    for (const status of ['pending', 'rejected', 'completed']) expect(run([own({ status })])).toEqual([])
  })

  it('別人提交的需求不會通知給我', () => {
    expect(run([own({ submittedBy: 'someone@x.com' })])).toEqual([])
  })

  it('已看過不再通知；超過時間窗不通知', () => {
    expect(run([own()], new Set(['p1']))).toEqual([])
    expect(run([own({ reviewedAt: ago(ALERT_WINDOW_DAYS + 1) })])).toEqual([])
  })
})

describe('buildAssignmentAlerts — 邊界', () => {
  it('manager 一律不產生通知', () => {
    const r = { id: 'x', status: 'assigned', assignedDesigners: ['m@x.com'], submittedBy: 'm@x.com', reviewedAt: ago(1) }
    expect(buildAssignmentAlerts({ role: 'manager', email: 'm@x.com', assignedRows: [r], ownRows: [r], seen: seenNone, nowMs: NOW })).toEqual([])
  })

  it('沒有 email / role 或空輸入安全回傳空陣列', () => {
    expect(buildAssignmentAlerts({ role: 'designer', email: '', assignedRows: [], ownRows: [], seen: seenNone, nowMs: NOW })).toEqual([])
    expect(buildAssignmentAlerts({ role: 'designer', email: DESIGNER, nowMs: NOW })).toEqual([])
  })

  it('同一筆同時出現在兩個來源時只通知一次', () => {
    const r = { id: 'dup', status: 'assigned', assignedDesigners: [DESIGNER], submittedBy: PLANNER, reviewedAt: ago(1) }
    const a = buildAssignmentAlerts({ role: 'designer', email: DESIGNER, assignedRows: [r], ownRows: [{ ...r, submittedBy: DESIGNER }], seen: seenNone, nowMs: NOW })
    expect(a.filter(x => x.id === 'dup')).toHaveLength(1)
  })
})
