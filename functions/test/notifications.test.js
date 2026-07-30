// 純函式測試，不連任何 Firebase 服務。涵蓋「已發稿後編輯指派/交期該不該通知、通知誰」的判斷邏輯。
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeReassignNotification } from '../index.js'

const A = 'a@example.com'
const B = 'b@example.com'
const C = 'c@example.com'

test('只改交期(設計師沒變)：通知目前所有設計師，changeLabels 只有交期異動', () => {
  const before = { assignedDesigners: [A, B], dueDate: '2026-08-01' }
  const after = { assignedDesigners: [A, B], dueDate: '2026-08-15' }
  const result = computeReassignNotification(before, after)
  assert.deepEqual(result.notifyEmails, [A, B])
  assert.deepEqual(result.changeLabels, ['交期異動'])
})

test('新增設計師(交期沒變)：通知目前所有設計師(不是只有新加入的)，changeLabels 只有指派異動', () => {
  const before = { assignedDesigners: [A], dueDate: '2026-08-01' }
  const after = { assignedDesigners: [A, B], dueDate: '2026-08-01' }
  const result = computeReassignNotification(before, after)
  assert.deepEqual(result.notifyEmails, [A, B])
  assert.deepEqual(result.changeLabels, ['指派異動'])
})

test('移除設計師：也算指派異動，通知剩下的人', () => {
  const before = { assignedDesigners: [A, B], dueDate: '2026-08-01' }
  const after = { assignedDesigners: [A], dueDate: '2026-08-01' }
  const result = computeReassignNotification(before, after)
  assert.deepEqual(result.notifyEmails, [A])
  assert.deepEqual(result.changeLabels, ['指派異動'])
})

test('設計師跟交期都改：changeLabels 兩個都有', () => {
  const before = { assignedDesigners: [A], dueDate: '2026-08-01' }
  const after = { assignedDesigners: [A, C], dueDate: '2026-09-01' }
  const result = computeReassignNotification(before, after)
  assert.deepEqual(result.notifyEmails, [A, C])
  assert.deepEqual(result.changeLabels, ['指派異動', '交期異動'])
})

test('只改注意事項/審核備註/ccPlanners(設計師、交期都沒變)：不通知，回傳 null', () => {
  const before = { assignedDesigners: [A], dueDate: '2026-08-01', comment: 'x' }
  const after = { assignedDesigners: [A], dueDate: '2026-08-01', comment: 'y', reviewNote: 'z', ccPlanners: ['p@example.com'] }
  assert.equal(computeReassignNotification(before, after), null)
})

test('設計師全部被移除(cur 是空陣列)：沒人可以通知，回傳 null', () => {
  const before = { assignedDesigners: [A, B], dueDate: '2026-08-01' }
  const after = { assignedDesigners: [], dueDate: '2026-09-01' }
  assert.equal(computeReassignNotification(before, after), null)
})

test('設計師順序不同但成員相同：不算異動', () => {
  const before = { assignedDesigners: [A, B], dueDate: '2026-08-01' }
  const after = { assignedDesigners: [B, A], dueDate: '2026-08-01' }
  assert.equal(computeReassignNotification(before, after), null)
})
