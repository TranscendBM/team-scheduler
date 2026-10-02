// 純函式測試，不連任何 Firebase 服務。涵蓋「逾期未更新狀態提醒」的判斷、分組與信件內容。
import test from 'node:test'
import assert from 'node:assert/strict'
import { findOverdueRequests, groupOverdueByDesigner, buildOverdueReminderHtml } from '../index.js'

const TODAY = '2026-10-10'

test('findOverdueRequests：已發稿/設計中且超過交期才算，並帶上逾期天數', () => {
  const result = findOverdueRequests([
    { id: 'a', status: 'assigned', dueDate: '2026-10-09' },
    { id: 'b', status: 'in_progress', dueDate: '2026-10-05' },
  ], TODAY)
  assert.deepEqual(result.map((r) => [r.id, r.overdueDays]), [['b', 5], ['a', 1]]) // 逾期最久排最前
})

test('findOverdueRequests：交期當天或未來不算逾期', () => {
  assert.equal(findOverdueRequests([
    { id: 'a', status: 'assigned', dueDate: TODAY },
    { id: 'b', status: 'assigned', dueDate: '2026-10-11' },
  ], TODAY).length, 0)
})

test('findOverdueRequests：設計確認中/已結案/待審核/已駁回不算逾期未更新', () => {
  const reqs = ['reviewing', 'completed', 'pending', 'rejected'].map((status) => ({ id: status, status, dueDate: '2026-10-01' }))
  assert.equal(findOverdueRequests(reqs, TODAY).length, 0)
})

test('findOverdueRequests：沒填交期、null、空輸入都安全略過', () => {
  assert.deepEqual(findOverdueRequests([null, undefined, {}, { status: 'assigned' }], TODAY), [])
  assert.deepEqual(findOverdueRequests(undefined, TODAY), [])
})

test('findOverdueRequests：跨月/跨年正確計算', () => {
  assert.equal(findOverdueRequests([{ status: 'assigned', dueDate: '2026-09-30' }], '2026-10-02')[0].overdueDays, 2)
  assert.equal(findOverdueRequests([{ status: 'assigned', dueDate: '2025-12-31' }], '2026-01-02')[0].overdueDays, 2)
})

test('groupOverdueByDesigner：多位設計師的需求每人都看得到，沒指派的不出現', () => {
  const items = [
    { id: 'a', assignedDesigners: ['s@x.com', 't@x.com'] },
    { id: 'b', assignedDesigners: ['s@x.com'] },
    { id: 'c', assignedDesigners: [] },
    { id: 'd' },
  ]
  const g = groupOverdueByDesigner(items)
  assert.deepEqual(g.get('s@x.com').map((r) => r.id), ['a', 'b'])
  assert.deepEqual(g.get('t@x.com').map((r) => r.id), ['a'])
  assert.equal(g.size, 2)
})

test('buildOverdueReminderHtml：設計師版列出專案/交期/逾期天數/狀態，不含設計師欄', () => {
  const html = buildOverdueReminderHtml([{ projectName: '乖乖 Halloween', dueDate: '2026-10-05', overdueDays: 5, status: 'in_progress', assignedDesignersNames: ['Sherry'] }], 'designer')
  assert.ok(html.includes('乖乖 Halloween'))
  assert.ok(html.includes('逾期 5 天'))
  assert.ok(html.includes('設計中'))
  assert.ok(!html.includes('>設計師<'))
})

test('buildOverdueReminderHtml：主管版多一欄設計師名稱，沒有名稱退回 email 前綴', () => {
  const html = buildOverdueReminderHtml([
    { projectName: 'A', dueDate: '2026-10-05', overdueDays: 5, status: 'assigned', assignedDesignersNames: ['Sherry'], assignedDesigners: ['s@x.com'] },
    { projectName: 'B', dueDate: '2026-10-06', overdueDays: 4, status: 'assigned', assignedDesigners: ['tingwei@x.com'] },
  ], 'manager')
  assert.ok(html.includes('>設計師<'))
  assert.ok(html.includes('Sherry'))
  assert.ok(html.includes('tingwei'))
})

test('buildOverdueReminderHtml：專案名稱/設計師名稱一律 escapeHtml，防止 stored XSS', () => {
  const html = buildOverdueReminderHtml([{
    projectName: '<img src=x onerror=alert(1)>', dueDate: '2026-10-05', overdueDays: 5, status: 'assigned',
    assignedDesignersNames: ['<script>alert(2)</script>'],
  }], 'manager')
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'))
  assert.ok(!html.includes('<script>alert(2)</script>'))
  assert.ok(html.includes('&lt;img'))
  assert.ok(html.includes('&lt;script&gt;'))
})

test('buildOverdueReminderHtml：欄位缺失不會顯示 undefined/null', () => {
  const html = buildOverdueReminderHtml([{ dueDate: '2026-10-05', overdueDays: 1, status: 'assigned' }], 'manager')
  assert.ok(!html.includes('undefined'))
  assert.ok(!html.includes('null'))
})
