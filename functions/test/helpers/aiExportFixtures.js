// 合成資料(全部是假的)：涵蓋各狀態、日期邊界、共同指派、無交期，以及「不該外洩」的敏感欄位哨兵字串。
// 同時給單元測試(直接餵 buildSnapshot)與 Firestore emulator 整合測試(寫進 emulator)使用。
export const KEY = 'test-hmac-key-0123456789abcdef-test'
export const NOW = new Date('2026-11-04T23:45:00Z') // 台灣時間 2026-11-05(週四) 07:45
export const TODAY = '2026-11-05'                    // 本週：2026-11-02(週一) ~ 2026-11-08(週日)

// 這些字串出現在輸出的任何分頁，就代表有敏感資料外洩
export const SENTINELS = [
  'SECRET-DESCRIPTION', 'SECRET-COMMENT', 'SECRET-REVIEWNOTE', 'SECRET-REJECTREASON', 'SHARETOKEN-ABC123',
  'SECRET-ATTACHMENT-URL', 'submitter@example.com', 'd1@example.com', 'd2@example.com', 'p1@example.com',
  'd1@corp.example.com', 'ConfidentialProjectX', 'SECRET-BUDGET', 'SECRET-LOCATION', 'SECRET-NOTE', 'SECRET-OFFICE',
]

const LEAK = {
  description: 'SECRET-DESCRIPTION', comment: 'SECRET-COMMENT', reviewNote: 'SECRET-REVIEWNOTE', rejectReason: 'SECRET-REJECTREASON',
  shareToken: 'SHARETOKEN-ABC123', submittedBy: 'submitter@example.com', submittedByName: 'Submitter Name',
  attachments: [{ name: 'SECRET-ATTACHMENT-URL.pdf', url: 'https://firebasestorage.googleapis.com/v0/b/x/o/SECRET-ATTACHMENT-URL?token=zzz' }],
  reviewedBy: 'p1@example.com', assignedDesignersNames: ['Designer One'],
}

const ts = (iso) => ({ toDate: () => new Date(iso) }) // 模擬 Firestore Timestamp

export const users = [
  { email: 'd1@example.com', role: 'designer', notifyEmail: 'd1@corp.example.com', active: true },
  { email: 'd2@example.com', role: 'designer', notifyEmail: 'd2@corp.example.com', active: true },
  { email: 'p1@example.com', role: 'planner', notifyEmail: 'p1@corp.example.com', active: true },
]
export const people = [
  { id: 'person-d1', role: 'designer', email: 'd1@corp.example.com' },
  { id: 'person-d2', role: 'designer', email: 'd2@corp.example.com' },
  { id: 'person-p1', role: 'planner', email: 'p1@corp.example.com' },
]

const base = (over) => ({ projectName: 'ConfidentialProjectX', docTypes: ['Banner'], region: 'US', urgent: false, ...LEAK, ...over })

// 12 筆在範圍內，另 2 筆(太舊的已結案/已駁回)不在範圍內
export const requests = [
  base({ id: 'reqDocIdAAAA0001', status: 'assigned', dueDate: '2026-11-03', assignedDesigners: ['d1@example.com'], createdAt: ts('2026-10-20T01:00:00Z') }),                       // 逾期 2 天
  base({ id: 'reqDocIdAAAA0002', status: 'in_progress', dueDate: '2026-11-05', assignedDesigners: ['d1@example.com', 'd2@example.com'], startedAt: ts('2026-11-01T01:00:00Z') }), // 交期當天、共同指派
  base({ id: 'reqDocIdAAAA0003', status: 'in_progress', dueDate: '2026-11-08', assignedDesigners: ['d2@example.com'] }),                                                       // 本週日
  base({ id: 'reqDocIdAAAA0004', status: 'assigned', dueDate: '2026-11-09', assignedDesigners: ['d2@example.com'] }),                                                          // 下週一
  base({ id: 'reqDocIdAAAA0005', status: 'pending', dueDate: '2026-11-01', assignedDesigners: [] }),                                                                            // 待審核已過交期
  base({ id: 'reqDocIdAAAA0006', status: 'reviewing', dueDate: '2026-10-30', assignedDesigners: ['d1@example.com'], reviewingAt: ts('2026-11-02T01:00:00Z') }),                  // 設計確認中已過交期
  base({ id: 'reqDocIdAAAA0007', status: 'assigned', dueDate: '', assignedDesigners: ['d2@example.com'] }),                                                                     // 無交期
  base({ id: 'reqDocIdAAAA0008', status: 'completed', dueDate: '2026-10-18', assignedDesigners: ['d1@example.com'], completedAt: ts('2026-10-20T01:00:00Z') }),                 // 90 天內已結案
  base({ id: 'reqDocIdAAAA0009', status: 'completed', dueDate: '2026-05-30', assignedDesigners: ['d1@example.com'], completedAt: ts('2026-06-01T01:00:00Z') }),                 // 太舊：不在範圍
  base({ id: 'reqDocIdAAAA0010', status: 'rejected', dueDate: '2026-10-10', assignedDesigners: [], reviewedAt: ts('2026-10-01T01:00:00Z') }),                                    // 90 天內已駁回
  base({ id: 'reqDocIdAAAA0011', status: 'rejected', dueDate: '2026-05-10', assignedDesigners: [], reviewedAt: ts('2026-05-01T01:00:00Z') }),                                    // 太舊：不在範圍
  base({ id: 'reqDocIdAAAA0012', status: 'pending', dueDate: '2026-11-06', assignedDesigners: [], urgent: true }),                                                              // 急件、2 天內到期
  base({ id: 'reqDocIdAAAA0013', status: 'assigned', dueDate: 'bad-date', assignedDesigners: ['d1@example.com'] }),                                                             // 交期格式錯誤
  base({ id: 'reqDocIdAAAA0014', status: 'in_progress', dueDate: '2026-11-04', assignedDesigners: [] }),                                                                        // 沒負責人(資料異常)、逾期 1 天
]

export const projects = [
  {
    id: 'projDocIdBBBB0001', name: 'ConfidentialProjectX Tradeshow', type: 'tradeshow', status: '提案通過', startDate: '2026-12-01', endDate: '2026-12-04', year: 2026,
    location: 'SECRET-LOCATION', office: 'SECRET-OFFICE', note: 'SECRET-NOTE', rentUSD: 'SECRET-BUDGET', decorUSD: 'SECRET-BUDGET',
    assignments: [{ personId: 'person-d1', role: 'designer' }, { personId: 'person-p1', role: 'planner' }],
  },
  { id: 'projDocIdBBBB0002', name: 'Old Project', type: 'design', status: '已結束', startDate: '2026-01-01', endDate: '2026-01-10', year: 2026, assignments: [] }, // 太舊：不輸出
]

// 期待值(依上面的資料手算)
export const EXPECTED = {
  total: 12,
  byStatus: { pending: 2, assigned: 4, in_progress: 3, reviewing: 1, completed: 1, rejected: 1 },
  open: 10, active: 7, overdue: 2, dueThisWeek: 2, noDue: 2, openDueThisWeek: 3, pastDueNotWatched: 2, urgentOpen: 1, unassignedNonPending: 1,
}
