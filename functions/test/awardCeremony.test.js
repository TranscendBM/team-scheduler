// 純函式測試，不連任何 Firebase 服務。涵蓋「頒獎典禮前一週提醒」的判斷邏輯與信件內容。
import test from 'node:test'
import assert from 'node:assert/strict'
import { findAwardCeremoniesDue, buildAwardCeremonyHtml, daysBetweenDateStrs } from '../index.js'

const award = (o) => ({ id: 'a', type: 'award', name: '金點設計獎', ceremonyDate: '2026-12-10', ...o })

test('findAwardCeremoniesDue：典禮在今天～今天+7 天內才算(含當天與第 7 天)', () => {
  const today = '2026-12-03'
  const list = [
    award({ id: 'in7', ceremonyDate: '2026-12-10' }),
    award({ id: 'today', ceremonyDate: '2026-12-03' }),
    award({ id: 'in8', ceremonyDate: '2026-12-11' }),
    award({ id: 'past', ceremonyDate: '2026-12-02' }),
  ]
  assert.deepEqual(findAwardCeremoniesDue(list, today, 7).map((p) => p.id), ['in7', 'today'])
})

test('findAwardCeremoniesDue：同一個典禮日期寄過就不再寄；日期被改掉會重新排程', () => {
  const today = '2026-12-05'
  assert.equal(findAwardCeremoniesDue([award({ ceremonyNotifiedFor: '2026-12-10' })], today, 7).length, 0)
  assert.equal(findAwardCeremoniesDue([award({ ceremonyNotifiedFor: '2026-12-01', ceremonyDate: '2026-12-10' })], today, 7).length, 1)
})

test('findAwardCeremoniesDue：沒填日期、格式不對、不是報獎的專案一律略過', () => {
  const today = '2026-12-05'
  const list = [award({ ceremonyDate: '' }), award({ ceremonyDate: undefined }), award({ ceremonyDate: '12/10' }),
    award({ type: 'event' }), null]
  assert.equal(findAwardCeremoniesDue(list, today, 7).length, 0)
})

test('findAwardCeremoniesDue：跨月跨年也正確', () => {
  assert.equal(findAwardCeremoniesDue([award({ ceremonyDate: '2027-01-03' })], '2026-12-30', 7).length, 1)
})

test('daysBetweenDateStrs：算日曆天數差', () => {
  assert.equal(daysBetweenDateStrs('2026-12-03', '2026-12-10'), 7)
  assert.equal(daysBetweenDateStrs('2026-12-03', '2026-12-03'), 0)
})

test('buildAwardCeremonyHtml：含名稱/日期時間/負責人，使用者輸入有跳脫', () => {
  const html = buildAwardCeremonyHtml(
    award({ name: '<b>獎</b>', ceremonyTime: '18:30', location: 'Taipei & Co' }),
    [{ name: 'Amy' }, { name: '<i>Bob</i>' }], 7)
  assert.ok(html.includes('2026-12-10 18:30'))
  assert.ok(html.includes('7 天後'))
  assert.ok(html.includes('Amy、&lt;i&gt;Bob&lt;/i&gt;'))
  assert.ok(html.includes('&lt;b&gt;獎&lt;/b&gt;'))
  assert.ok(html.includes('Taipei &amp; Co'))
  assert.ok(!html.includes('<b>獎</b>'))
})

test('buildAwardCeremonyHtml：沒有負責人顯示尚未指派；當天寫「就在今天」', () => {
  const html = buildAwardCeremonyHtml(award({}), [], 0)
  assert.ok(html.includes('尚未指派'))
  assert.ok(html.includes('就在今天'))
})
