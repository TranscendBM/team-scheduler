// 純函式測試，不連任何 Firebase 服務。涵蓋「休假前一週提醒主管」的判斷邏輯與信件內容。
// 執行：npm test（functions 目錄下）
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addDaysToDateStr,
  findLeavesStartingInDays,
  buildLeaveReminderHtml,
} from '../index.js'

test('addDaysToDateStr：正常加日期，跨月/跨年會正確進位', () => {
  assert.equal(addDaysToDateStr('2026-08-10', 7), '2026-08-17')
  assert.equal(addDaysToDateStr('2026-08-31', 1), '2026-09-01')
  assert.equal(addDaysToDateStr('2026-12-31', 1), '2027-01-01')
})

test('addDaysToDateStr：全程用 UTC 運算，不受執行環境系統時區影響(這裡故意跟本機時區設定無關)', () => {
  // 這組斷言本身就是 UTC-only 實作要保證的事：不管這台機器的 TZ 環境變數是什麼，
  // 加 7 天永遠精確對應日曆上的 7 天，不會因為本機時區跟 UTC 有offset就早/晚一天。
  assert.equal(addDaysToDateStr('2026-01-01', 0), '2026-01-01')
  assert.equal(addDaysToDateStr('2026-01-01', -1), '2025-12-31')
})

test('findLeavesStartingInDays：休假開始日精確等於「今天+N天」才算，差一天就不算', () => {
  const leaves = [
    { personName: 'A', startDate: '2026-08-20', endDate: '2026-08-22' }, // 今天+7
    { personName: 'B', startDate: '2026-08-19', endDate: '2026-08-19' }, // 今天+6，差一天
    { personName: 'C', startDate: '2026-08-21', endDate: '2026-08-21' }, // 今天+8，差一天
  ]
  const result = findLeavesStartingInDays(leaves, '2026-08-13', 7)
  assert.equal(result.length, 1)
  assert.equal(result[0].personName, 'A')
})

test('findLeavesStartingInDays：沒有符合的休假回傳空陣列，不會噴錯', () => {
  const leaves = [{ personName: 'A', startDate: '2026-01-01', endDate: '2026-01-01' }]
  assert.deepEqual(findLeavesStartingInDays(leaves, '2026-08-13', 7), [])
  assert.deepEqual(findLeavesStartingInDays([], '2026-08-13', 7), [])
})

test('findLeavesStartingInDays：多筆同一天開始的休假都會被找到', () => {
  const leaves = [
    { personName: 'A', startDate: '2026-08-20', endDate: '2026-08-20' },
    { personName: 'B', startDate: '2026-08-20', endDate: '2026-08-25' },
    { personName: 'C', startDate: '2026-09-01', endDate: '2026-09-01' },
  ]
  const result = findLeavesStartingInDays(leaves, '2026-08-13', 7)
  assert.equal(result.length, 2)
  assert.deepEqual(result.map((l) => l.personName), ['A', 'B'])
})

test('findLeavesStartingInDays：欄位缺失/格式異常的記錄安全跳過，不會噴錯', () => {
  const leaves = [null, undefined, {}, { personName: 'A' }, { startDate: '2026-08-20' }]
  const result = findLeavesStartingInDays(leaves, '2026-08-13', 7)
  assert.equal(result.length, 1)
  assert.equal(result[0].personName, undefined)
})

test('buildLeaveReminderHtml：正常渲染姓名/假別/日期/備註', () => {
  const html = buildLeaveReminderHtml(
    [{ personName: '王小明', type: '特休', startDate: '2026-08-20', endDate: '2026-08-22', note: '回國' }],
    7,
  )
  assert.ok(html.includes('王小明'))
  assert.ok(html.includes('特休'))
  assert.ok(html.includes('2026-08-20 ~ 2026-08-22'))
  assert.ok(html.includes('回國'))
  assert.ok(html.includes('7 天後'))
})

test('buildLeaveReminderHtml：單日休假只顯示一個日期，不會出現多餘的 ~', () => {
  const html = buildLeaveReminderHtml(
    [{ personName: '王小明', type: '事假', startDate: '2026-08-20', endDate: '2026-08-20' }],
    7,
  )
  assert.ok(html.includes('2026-08-20'))
  assert.ok(!html.includes('2026-08-20 ~ 2026-08-20'))
})

test('buildLeaveReminderHtml：姓名/備註欄位一律 escapeHtml，防止 stored XSS', () => {
  const html = buildLeaveReminderHtml(
    [{
      personName: '<img src=x onerror=alert(1)>',
      type: '特休',
      startDate: '2026-08-20',
      endDate: '2026-08-20',
      note: '<script>alert(2)</script>',
    }],
    7,
  )
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'))
  assert.ok(!html.includes('<script>alert(2)</script>'))
  assert.ok(html.includes('&lt;img'))
  assert.ok(html.includes('&lt;script&gt;'))
})

test('buildLeaveReminderHtml：多筆記錄都會各自產生一列', () => {
  const html = buildLeaveReminderHtml(
    [
      { personName: 'A', type: '特休', startDate: '2026-08-20', endDate: '2026-08-20' },
      { personName: 'B', type: '病假', startDate: '2026-08-20', endDate: '2026-08-21' },
    ],
    7,
  )
  assert.ok(html.includes('A'))
  assert.ok(html.includes('B'))
  assert.equal((html.match(/<tr style="border-bottom/g) || []).length, 2)
})

test('buildLeaveReminderHtml：沒有備註時該欄留空，不顯示 undefined/null 字樣', () => {
  const html = buildLeaveReminderHtml(
    [{ personName: 'A', type: '特休', startDate: '2026-08-20', endDate: '2026-08-20' }],
    7,
  )
  assert.ok(!html.includes('undefined'))
  assert.ok(!html.includes('null'))
})
