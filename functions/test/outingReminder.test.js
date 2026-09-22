// 純函式測試，不連任何 Firebase 服務。涵蓋「外出提前 3 天提醒主管、前一天提醒當事人」的判斷邏輯與信件內容。
// 執行：npm test（functions 目錄下）
import test from 'node:test'
import assert from 'node:assert/strict'
import { findOutingsStartingInDays, buildOutingReminderHtml, buildOutingManagerReminderHtml } from '../index.js'

test('findOutingsStartingInDays：外出日期精確等於「今天+N天」才算，差一天就不算', () => {
  const outings = [
    { personName: 'A', date: '2026-08-14' }, // 今天+1
    { personName: 'B', date: '2026-08-13' }, // 今天，差一天
    { personName: 'C', date: '2026-08-15' }, // 今天+2，差一天
  ]
  const result = findOutingsStartingInDays(outings, '2026-08-13', 1)
  assert.equal(result.length, 1)
  assert.equal(result[0].personName, 'A')
})

test('findOutingsStartingInDays：沒有符合的外出回傳空陣列，不會噴錯', () => {
  const outings = [{ personName: 'A', date: '2026-01-01' }]
  assert.deepEqual(findOutingsStartingInDays(outings, '2026-08-13', 1), [])
  assert.deepEqual(findOutingsStartingInDays([], '2026-08-13', 1), [])
})

test('findOutingsStartingInDays：多筆同一天外出的記錄都會被找到', () => {
  const outings = [
    { personName: 'A', date: '2026-08-14' },
    { personName: 'B', date: '2026-08-14' },
    { personName: 'C', date: '2026-09-01' },
  ]
  const result = findOutingsStartingInDays(outings, '2026-08-13', 1)
  assert.equal(result.length, 2)
  assert.deepEqual(result.map((o) => o.personName), ['A', 'B'])
})

test('findOutingsStartingInDays：欄位缺失/格式異常的記錄安全跳過，不會噴錯', () => {
  const outings = [null, undefined, {}, { personName: 'A' }]
  const result = findOutingsStartingInDays(outings, '2026-08-13', 1)
  assert.equal(result.length, 0)
})

test('buildOutingReminderHtml：正常渲染姓名/日期/時間/內容', () => {
  const html = buildOutingReminderHtml(
    { personName: 'Rachel', time: '下午兩點', note: '會和業務外出去布展' },
    '2026-10-06',
  )
  assert.ok(html.includes('Rachel'))
  assert.ok(html.includes('2026-10-06'))
  assert.ok(html.includes('下午兩點'))
  assert.ok(html.includes('會和業務外出去布展'))
})

test('buildOutingReminderHtml：沒有時間/備註時該欄不出現，也不會顯示 undefined/null', () => {
  const html = buildOutingReminderHtml({ personName: 'Rachel' }, '2026-10-08')
  assert.ok(!html.includes('undefined'))
  assert.ok(!html.includes('null'))
})

test('buildOutingReminderHtml：姓名/備註欄位一律 escapeHtml，防止 stored XSS', () => {
  const html = buildOutingReminderHtml(
    { personName: '<img src=x onerror=alert(1)>', note: '<script>alert(2)</script>' },
    '2026-10-06',
  )
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'))
  assert.ok(!html.includes('<script>alert(2)</script>'))
  assert.ok(html.includes('&lt;img'))
  assert.ok(html.includes('&lt;script&gt;'))
})

test('buildOutingManagerReminderHtml：正常渲染姓名/日期/內容，多筆各自一列', () => {
  const html = buildOutingManagerReminderHtml(
    [
      { personName: 'Rachel', date: '2026-10-06', time: '下午兩點', note: '會和業務外出去布展' },
      { personName: 'Ashley', date: '2026-10-13', note: '展前一天外出' },
    ],
    3,
  )
  assert.ok(html.includes('Rachel'))
  assert.ok(html.includes('Ashley'))
  assert.ok(html.includes('2026-10-06'))
  assert.ok(html.includes('下午兩點'))
  assert.ok(html.includes('會和業務外出去布展'))
  assert.ok(html.includes('3 天後'))
  assert.equal((html.match(/<tr style="border-bottom/g) || []).length, 2)
})

test('buildOutingManagerReminderHtml：沒有時間/備註時不會顯示 undefined/null', () => {
  const html = buildOutingManagerReminderHtml([{ personName: 'Rachel', date: '2026-10-08' }], 3)
  assert.ok(!html.includes('undefined'))
  assert.ok(!html.includes('null'))
})

test('buildOutingManagerReminderHtml：姓名/備註欄位一律 escapeHtml，防止 stored XSS', () => {
  const html = buildOutingManagerReminderHtml(
    [{ personName: '<img src=x onerror=alert(1)>', date: '2026-10-06', note: '<script>alert(2)</script>' }],
    3,
  )
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'))
  assert.ok(!html.includes('<script>alert(2)</script>'))
  assert.ok(html.includes('&lt;img'))
  assert.ok(html.includes('&lt;script&gt;'))
})
