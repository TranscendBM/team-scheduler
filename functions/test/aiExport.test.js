// AI 資料表「純函式」測試：口徑、去識別化、白名單、與既有系統一致性。不連任何 Firebase/Google 服務。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSnapshot, computeStats, personCode, itemCode, weekRange, dateStrOf, taipeiDateStr, addDays, cleanText,
  assertNoPii, PiiError, LimitError, LIMITS, canonCell, checksumRows, canonRows, TAB, DATA_TABS, OVERDUE_WATCH_STATUSES,
} from '../aiExport.js'
import { findOverdueRequests } from '../index.js'
import { KEY, NOW, TODAY, SENTINELS, users, people, requests, projects, EXPECTED } from './helpers/aiExportFixtures.js'

const build = (over = {}) => buildSnapshot({ requests, projects, users, people, now: NOW, hmacKey: KEY, anonymize: true, ...over })
const allText = (snap) => JSON.stringify(snap.tabs)
const reqRow = (snap, docId) => snap.tabs[TAB.REQUESTS].find((r) => r[0] === itemCode('R', docId, KEY))

test('彙總口徑：各狀態數加總 = 範圍內總數；逾期/本週到期/無交期/補充指標與手算一致', () => {
  const { stats } = build()
  assert.equal(stats.total, EXPECTED.total)
  assert.deepEqual(stats.byStatus, EXPECTED.byStatus)
  assert.equal(Object.values(stats.byStatus).reduce((a, b) => a + b, 0), stats.total)
  for (const k of ['open', 'active', 'overdue', 'dueThisWeek', 'noDue', 'openDueThisWeek', 'pastDueNotWatched', 'urgentOpen', 'unassignedNonPending']) {
    assert.equal(stats[k], EXPECTED[k], k)
  }
})

test('資料保留：太舊的已結案/已駁回不輸出；90 天邊界(含第 90 天、不含第 91 天)', () => {
  const snap = build()
  assert.equal(reqRow(snap, 'reqDocIdAAAA0009'), undefined)
  assert.equal(reqRow(snap, 'reqDocIdAAAA0011'), undefined)
  assert.ok(reqRow(snap, 'reqDocIdAAAA0008') && reqRow(snap, 'reqDocIdAAAA0010'))
  const day90 = addDays(TODAY, -90), day91 = addDays(TODAY, -91)
  const edge = (id, d) => ({ id, status: 'completed', dueDate: '', docTypes: [], assignedDesigners: [], completedAt: `${d}` })
  const s = buildSnapshot({ requests: [edge('e90', day90), edge('e91', day91)], projects: [], users, people, now: NOW, hmacKey: KEY })
  assert.ok(s.tabs[TAB.REQUESTS].find((r) => r[0] === itemCode('R', 'e90', KEY)))
  assert.equal(s.tabs[TAB.REQUESTS].find((r) => r[0] === itemCode('R', 'e91', KEY)), undefined)
})

test('dueBucket：交期當天、本週日算本週到期；下週一算之後；待審核/設計確認中已過交期不算逾期但單獨標出', () => {
  const snap = build()
  const bucket = (id) => reqRow(snap, id)[snap.tabs[TAB.REQUESTS][1].indexOf('dueBucket')]
  assert.equal(bucket('reqDocIdAAAA0001'), 'OVERDUE')
  assert.equal(bucket('reqDocIdAAAA0002'), 'THIS_WEEK')   // 交期=今天，不算逾期
  assert.equal(bucket('reqDocIdAAAA0003'), 'THIS_WEEK')   // 本週日
  assert.equal(bucket('reqDocIdAAAA0004'), 'LATER')       // 下週一
  assert.equal(bucket('reqDocIdAAAA0005'), 'PAST_DUE_NOT_WATCHED') // 待審核
  assert.equal(bucket('reqDocIdAAAA0006'), 'PAST_DUE_NOT_WATCHED') // 設計確認中
  assert.equal(bucket('reqDocIdAAAA0007'), 'NO_DUE')
  assert.equal(bucket('reqDocIdAAAA0013'), 'NO_DUE')      // 格式錯誤視為沒有交期
  assert.equal(bucket('reqDocIdAAAA0008'), '')            // 已結案不分桶
  assert.equal(snap.counts.invalidDueDate, 1)
})

test('同一筆需求只會落在一個 dueBucket：逾期 + 本週到期 + 之後 + 無交期 + 已過交期未監控 = 開放需求數', () => {
  const snap = build()
  const header = snap.tabs[TAB.REQUESTS][1]
  const rows = snap.tabs[TAB.REQUESTS].slice(2)
  const counts = {}
  for (const r of rows) {
    const b = r[header.indexOf('dueBucket')]
    if (b) counts[b] = (counts[b] || 0) + 1
  }
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), snap.stats.open)
})

test('與既有系統一致：逾期判斷等同 functions/index.js 的 findOverdueRequests(與前端的對照在 test/unit/aiExportConsistency.test.js)', () => {
  assert.deepEqual([...OVERDUE_WATCH_STATUSES].sort(), ['assigned', 'in_progress'])
  const snap = build()
  const header = snap.tabs[TAB.REQUESTS][1]
  const mine = new Set(snap.tabs[TAB.REQUESTS].slice(2).filter((r) => r[header.indexOf('isOverdue')] === true).map((r) => r[0]))
  const inScope = requests.filter((r) => snap.tabs[TAB.REQUESTS].some((row) => row[0] === itemCode('R', r.id, KEY)))
  const backend = new Set(findOverdueRequests(inScope, TODAY).map((r) => itemCode('R', r.id, KEY)))
  assert.deepEqual([...mine].sort(), [...backend].sort())
  assert.equal(mine.size, 2)
  // 逾期天數也一致
  for (const r of findOverdueRequests(inScope, TODAY)) {
    assert.equal(reqRow(snap, r.id)[header.indexOf('overdueDays')], r.overdueDays)
  }
})

test('工作量：共同指派每人各算一次、UNASSIGNED 單獨一列、待審核與已駁回不進個人工作量', () => {
  const { workload } = build()
  const d1 = workload.find((w) => w.code === personCode('d1@example.com', KEY, 'designer'))
  const d2 = workload.find((w) => w.code === personCode('d2@example.com', KEY, 'designer'))
  const un = workload.find((w) => w.code === 'UNASSIGNED')
  assert.deepEqual({ assigned: d1.assigned, inProgress: d1.inProgress, reviewing: d1.reviewing, active: d1.active, overdue: d1.overdue, dueThisWeek: d1.dueThisWeek, shared: d1.sharedActive, completed: d1.completed },
    { assigned: 2, inProgress: 1, reviewing: 1, active: 3, overdue: 1, dueThisWeek: 1, shared: 1, completed: 1 })
  assert.deepEqual({ assigned: d2.assigned, inProgress: d2.inProgress, active: d2.active, overdue: d2.overdue, dueThisWeek: d2.dueThisWeek, shared: d2.sharedActive },
    { assigned: 2, inProgress: 2, active: 4, overdue: 0, dueThisWeek: 2, shared: 1 })
  assert.equal(un.inProgress, 1)
  assert.equal(un.overdue, 1)
  assert.equal(workload.length, 3) // 沒有 pending/rejected 造成的額外列
  // 說明：每人加總(含共同指派重複)大於不重複的進行中總數
  assert.ok(d1.active + d2.active + un.active > build().stats.active)
})

test('前三項風險候選：依固定規則排序、帶原因，且只來自開放中需求', () => {
  const { risks } = build()
  assert.deepEqual(risks.map((r) => r.id), [itemCode('R', 'reqDocIdAAAA0001', KEY), itemCode('R', 'reqDocIdAAAA0014', KEY), itemCode('R', 'reqDocIdAAAA0005', KEY)])
  assert.deepEqual(risks.map((r) => r.rank), [1, 2, 3])
  assert.deepEqual(risks[0].reasons, ['OVERDUE'])
  assert.equal(risks[0].score, 102) // 100 + 逾期 2 天
  assert.ok(risks[2].reasons.includes('PENDING_PAST_DUE'))
  assert.ok(!risks.some((r) => r.status === 'completed' || r.status === 'rejected'))
})

test('AI_Daily_Summary 版面：含需求總數、各狀態、逾期、本週到期、無交期、每人工作量、風險前三', () => {
  const text = JSON.stringify(build().tabs[TAB.SUMMARY])
  for (const k of ['totalRequestsInScope', 'status.pending', 'status.assigned', 'status.in_progress', 'status.reviewing', 'status.completed', 'status.rejected',
    'overdue', 'dueThisWeek', 'noDueDate', 'WORKLOAD', 'RISK_TOP3', 'weekMonToSun']) assert.ok(text.includes(k), k)
})

test('去識別化：任何分頁都不含敏感哨兵字串、email、網址、原始文件 ID、真實專案名稱', () => {
  const text = allText(build())
  for (const s of SENTINELS) assert.ok(!text.includes(s), `外洩：${s}`)
  for (const id of requests.map((r) => r.id).concat(projects.map((p) => p.id))) assert.ok(!text.includes(id), `原始文件 ID 外洩：${id}`)
  assert.ok(!/@/.test(text))
  assert.ok(!/https?:/i.test(text))
  assert.ok(!/Designer One|Submitter Name/.test(text))
})

test('欄位白名單：需求表與專案表的表頭固定，不會因來源多了欄位而多輸出', () => {
  const snap = build()
  assert.deepEqual(snap.tabs[TAB.REQUESTS][1], ['reqCode', 'name', 'category', 'region', 'urgent', 'status', 'dueDate', 'createdDate', 'reviewedDate', 'startedDate',
    'reviewingDate', 'completedDate', 'assigneeCodes', 'isOpen', 'isOverdue', 'overdueDays', 'dueBucket', 'selfCreated', 'snapshotId'])
  assert.deepEqual(snap.tabs[TAB.PROJECTS][1], ['projCode', 'name', 'type', 'status', 'startDate', 'endDate', 'year', 'assigneeCodes', 'phase', 'daysToStart', 'snapshotId'])
  const extra = requests.map((r) => ({ ...r, brandNewSensitiveField: 'BRAND-NEW-SECRET' }))
  assert.ok(!allText(build({ requests: extra })).includes('BRAND-NEW-SECRET'))
})

test('匿名模式：需求/專案名稱是代碼；非匿名模式才輸出清理過的真實名稱(email/網址被遮蔽、過長截斷)', () => {
  const anon = build()
  assert.match(reqRow(anon, 'reqDocIdAAAA0001')[1], /^需求 R-[0-9a-f]{10}$/)
  const real = build({
    anonymize: false,
    requests: [{ ...requests[0], projectName: 'Promo for a@b.com see https://x.y/z' + 'x'.repeat(200) }],
    projects: [],
  })
  const name = real.tabs[TAB.REQUESTS][2][1]
  assert.ok(name.includes('[email]') && name.includes('[url]'))
  assert.ok(!name.includes('a@b.com') && !name.includes('https://'))
  assert.ok(name.length <= 81)
})

test('代號：同一個人在需求與專案是同一個代號(透過公司信箱對應)、穩定、格式正確、不同密鑰不同代號', () => {
  const a = build(), b = build()
  const d1 = personCode('d1@example.com', KEY, 'designer')
  assert.match(d1, /^D-[0-9a-f]{6}$/)
  assert.equal(personCode('  D1@Example.com ', KEY, 'designer'), d1) // 大小寫與空白不影響
  assert.equal(reqRow(a, 'reqDocIdAAAA0001')[0], reqRow(b, 'reqDocIdAAAA0001')[0]) // 跨次執行穩定
  assert.notEqual(a.snapshotId, b.snapshotId)
  const proj = a.tabs[TAB.PROJECTS][2]
  assert.ok(proj[7].split(';').includes(d1))
  assert.ok(proj[7].includes('P-')) // planner 前綴
  assert.notEqual(personCode('d1@example.com', KEY + 'x', 'designer'), d1)
})

test('專案：不輸出預算、地點、備註、辦公室；太舊的專案不輸出', () => {
  const snap = build()
  assert.equal(snap.counts.projects, 1)
  const text = JSON.stringify(snap.tabs[TAB.PROJECTS])
  assert.ok(!/SECRET/.test(text))
  assert.equal(snap.tabs[TAB.PROJECTS][2][8], 'UPCOMING')
})

test('密鑰太短或缺少：直接拒絕，不會用空密鑰算出可預測代號', () => {
  assert.throws(() => personCode('a@b.com', '', 'designer'), /HMAC/)
  assert.throws(() => build({ hmacKey: 'short' }), /HMAC/)
  assert.throws(() => itemCode('R', 'x', undefined), /HMAC/)
})

test('PII 守門：儲存格含 email 或網址就整份作廢', () => {
  assert.throws(() => assertNoPii({ t: [['ok', 'someone@example.com']] }), PiiError)
  assert.throws(() => assertNoPii({ t: [['see https://example.com']] }), PiiError)
  assert.doesNotThrow(() => assertNoPii({ t: [['R-0123456789', 5, true]] }))
})

test('上限：列數超過上限直接失敗，不靜默截斷', () => {
  const many = Array.from({ length: LIMITS.maxRequestRows + 1 }, (_, i) => ({ id: `id${i}`, status: 'pending', dueDate: '2026-12-01', assignedDesigners: [] }))
  assert.throws(() => buildSnapshot({ requests: many, projects: [], users, people, now: NOW, hmacKey: KEY }), LimitError)
})

test('時間：台灣時間日界線、Timestamp 物件、週一到週日', () => {
  assert.equal(taipeiDateStr(new Date('2026-11-04T16:30:00Z')), '2026-11-05') // UTC 還是 11/4，台灣已是 11/5
  assert.equal(dateStrOf({ toDate: () => new Date('2026-11-04T16:30:00Z') }), '2026-11-05')
  assert.equal(dateStrOf('2026-11-05'), '2026-11-05')
  assert.equal(dateStrOf(null), '')
  assert.equal(dateStrOf('garbage'), '')
  assert.deepEqual(weekRange('2026-11-02'), { start: '2026-11-02', end: '2026-11-08' }) // 週一
  assert.deepEqual(weekRange('2026-11-08'), { start: '2026-11-02', end: '2026-11-08' }) // 週日仍屬本週
  assert.deepEqual(weekRange('2026-11-09'), { start: '2026-11-09', end: '2026-11-15' }) // 下週一
})

test('完整性：checksum 對布林/數字型別與尾端空白不敏感、對內容差異敏感；快照含 schemaVersion 與 snapshotId', () => {
  assert.equal(canonCell(true), 'TRUE')
  assert.equal(canonCell(null), '')
  assert.equal(checksumRows([['a', true, 5, '']]), checksumRows([['a', 'TRUE', '5']]))
  assert.notEqual(checksumRows([['a']]), checksumRows([['b']]))
  assert.deepEqual(canonRows([['a', ''], [], ['']]), [['a']])
  const snap = build()
  for (const t of DATA_TABS) {
    const meta = snap.tabs[t][0]
    assert.equal(meta[0], '#META')
    assert.equal(meta[1], `snapshotId=${snap.snapshotId}`)
    assert.equal(meta[2], `schemaVersion=${snap.schemaVersion}`)
    assert.ok(snap.checksums[t] && /^[0-9a-f]{64}$/.test(snap.checksums[t]))
  }
  // 每筆資料列都帶 snapshotId
  assert.ok(snap.tabs[TAB.REQUESTS].slice(2).every((r) => r[r.length - 1] === snap.snapshotId))
})

test('cleanText：控制字元、換行、email、網址', () => {
  assert.equal(cleanText('a\nb\tc'), 'a b c')
  assert.equal(cleanText('x@y.com'), '[email]')
  assert.equal(cleanText(null), '')
})

test('computeStats 對空輸入安全', () => {
  assert.equal(computeStats([]).total, 0)
  const snap = buildSnapshot({ requests: [], projects: [], users: [], people: [], now: NOW, hmacKey: KEY })
  assert.equal(snap.counts.requests, 0)
  assert.equal(snap.risks.length, 0)
})
