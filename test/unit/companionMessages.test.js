import { describe, it, expect } from 'vitest'
import { buildCompanionMessages, avatarKey, initialsOf, greeting } from '../../src/utils/companionMessages.js'

const today = '2026-11-27'

describe('avatarKey / initialsOf / greeting', () => {
  it('頭像 key：取第一個有值的信箱 @ 前面那段，轉小寫', () => {
    expect(avatarKey('Rachel.Chen@transcend-info.com', 'x@y.com')).toBe('rachel.chen')
    expect(avatarKey('', null, 'Ecco@gmail.com')).toBe('ecco')
    expect(avatarKey(undefined, '')).toBe('')
  })
  it('縮寫：英文前兩個字母、中文第一個字、空白給 ?', () => {
    expect(initialsOf('Rachel Chen')).toBe('RC')
    expect(initialsOf('ecco')).toBe('EC')
    expect(initialsOf('王小明')).toBe('王')
    expect(initialsOf('')).toBe('?')
  })
  it('問候依時段', () => {
    expect(greeting(8)).toBe('早安')
    expect(greeting(13)).toBe('午安')
    expect(greeting(20)).toBe('辛苦了')
    expect(greeting(2)).toBe('夜深了')
  })
})

describe('buildCompanionMessages', () => {
  it('什麼資料都沒有 → 只有問候', () => {
    const m = buildCompanionMessages({ name: 'Amy', role: 'planner', today, hour: 9 })
    expect(m).toHaveLength(1)
    expect(m[0].text).toContain('早安')
    expect(m[0].text).toContain('Amy')
  })
  it('進行中的秀展排在最前面，顯示第幾天', () => {
    const m = buildCompanionMessages({
      role: 'planner', today,
      ongoingShows: [{ name: 'CES', startDate: '2026-11-26', endDate: '2026-11-29' }],
      upcomingShows: [{ name: 'MWC', startDate: '2026-12-10' }],
    })
    expect(m[0].text).toContain('第 2 天')
    expect(m[1].text).toContain('13 天')
    expect(m[1].tone).toBe('warn')
  })
  it('超過兩週的秀展只輕描淡寫；今天開展特別提醒', () => {
    const far = buildCompanionMessages({ role: 'planner', today, upcomingShows: [{ name: 'A', startDate: '2027-01-20' }] })
    expect(far[0].tone).toBe('info')
    const now = buildCompanionMessages({ role: 'planner', today, upcomingShows: [{ name: 'A', startDate: today }] })
    expect(now[0].text).toContain('今天開展')
  })
  it('設計師：逾期、3 天內到期、沒事各有訊息', () => {
    const m = buildCompanionMessages({
      role: 'designer', today,
      assignedRequests: [{ dueDate: '2026-11-20' }, { dueDate: '2026-11-29' }, { dueDate: '2026-12-30' }],
    })
    expect(m[0].text).toContain('1 件需求已經超過期限')
    expect(m[1].text).toContain('1 件需求 3 天內到期')
    expect(buildCompanionMessages({ role: 'designer', today })[0].tone).toBe('good')
    const calm = buildCompanionMessages({ role: 'designer', today, assignedRequests: [{ dueDate: '2026-12-30' }] })
    expect(calm[0].text).toContain('時程都還充裕')
  })
  it('需求人：等確認、已結案、待審核', () => {
    const m = buildCompanionMessages({
      role: 'planner', today,
      myRequests: [{ status: 'reviewing' }, { status: 'completed' }, { status: 'completed' }, { status: 'pending' }],
    })
    expect(m.map(x => x.text).join('|')).toMatch(/1 件需求的設計稿等你確認.*2 件需求已經結案.*1 件需求正在等主管審核/)
  })
  it('主管：全公司重點，數量為 0 的不顯示', () => {
    const m = buildCompanionMessages({ role: 'manager', today, manager: { newProductAttention: 2, showsSoon: 0, onLeaveSoon: 3 } })
    const t = m.map(x => x.text).join('|')
    expect(t).toContain('2 項新品上官網')
    expect(t).toContain('3 筆休假預排')
    expect(t).not.toContain('秀展')
  })
})
