import { describe, it, expect } from 'vitest'
import {
  URGENT_LEAD_DAYS, toLocalDateStr, leadDays, isAutoUrgent, urgentInfo, buildMonthlyStats, requestsOfMonth,
} from '../../src/utils/requestUrgency.js'

// 用本地時間建立 Date，避免時區讓日期差一天
const at = (y, m, d, h = 10) => new Date(y, m - 1, d, h, 30)
const ts = (date) => ({ toDate: () => date, seconds: Math.floor(date.getTime() / 1000) })
const req = (o) => ({ status: 'assigned', region: 'HQ', urgent: false, dueDate: '2099-01-01', createdAt: ts(at(2026, 11, 3)), ...o })

describe('日期轉換', () => {
  it('toLocalDateStr：Timestamp、Date、{seconds}、字串都轉成本地日期；壞資料回空字串', () => {
    expect(toLocalDateStr(ts(at(2026, 11, 25, 23)))).toBe('2026-11-25')
    expect(toLocalDateStr(at(2026, 1, 2, 0))).toBe('2026-01-02')
    expect(toLocalDateStr({ seconds: at(2026, 3, 4).getTime() / 1000 })).toBe('2026-03-04')
    expect(toLocalDateStr('2026-12-31')).toBe('2026-12-31')
    expect(toLocalDateStr(null)).toBe('')
    expect(toLocalDateStr('not a date')).toBe('')
  })
})

describe('急件判定(發稿到交期間隔不足 7 天)', () => {
  it('門檻是 7 天', () => expect(URGENT_LEAD_DAYS).toBe(7))
  it('leadDays：同一天 0、跨月跨年正確、交期早於發稿為負數、缺資料為 null', () => {
    expect(leadDays('2026-11-25', '2026-11-25')).toBe(0)
    expect(leadDays('2026-11-25', '2026-12-02')).toBe(7)
    expect(leadDays('2026-12-28', '2027-01-03')).toBe(6)
    expect(leadDays('2026-11-25', '2026-11-20')).toBe(-5)
    expect(leadDays('2026-11-25', '')).toBeNull()
    expect(leadDays(null, '2026-11-25')).toBeNull()
  })
  it('間隔 6 天(含)以內是急件，剛好 7 天不是', () => {
    expect(isAutoUrgent('2026-11-25', '2026-12-01')).toBe(true)   // 6 天
    expect(isAutoUrgent('2026-11-25', '2026-12-02')).toBe(false)  // 7 天
    expect(isAutoUrgent('2026-11-25', '2026-12-10')).toBe(false)
  })
  it('交期當天、交期已過也是急件；沒填交期不判定', () => {
    expect(isAutoUrgent('2026-11-25', '2026-11-25')).toBe(true)
    expect(isAutoUrgent('2026-11-25', '2026-11-01')).toBe(true)
    expect(isAutoUrgent('2026-11-25', '')).toBe(false)
  })
  it('跨月底也用日曆日計算(11/28 → 12/4 = 6 天)', () => {
    expect(isAutoUrgent('2026-11-28', '2026-12-04')).toBe(true)
    expect(isAutoUrgent('2026-11-28', '2026-12-05')).toBe(false)
  })
  it('urgentInfo：系統計算 / 手動勾選 / 兩者皆無，並帶出間隔天數', () => {
    expect(urgentInfo(req({ createdAt: ts(at(2026, 11, 25)), dueDate: '2026-11-30' }))).toMatchObject({ urgent: true, auto: true, manual: false, days: 5 })
    expect(urgentInfo(req({ createdAt: ts(at(2026, 11, 25)), dueDate: '2026-12-30', urgent: true }))).toMatchObject({ urgent: true, auto: false, manual: true })
    expect(urgentInfo(req({ createdAt: ts(at(2026, 11, 25)), dueDate: '2026-12-30' }))).toMatchObject({ urgent: false, auto: false, manual: false, days: 35 })
    expect(urgentInfo({ urgent: true }).urgent).toBe(true) // 缺日期仍認手動勾選
  })
})

describe('buildMonthlyStats', () => {
  const list = [
    req({ createdAt: ts(at(2026, 1, 5)), region: 'HQ', dueDate: '2026-01-08' }),       // 急件(3 天)
    req({ createdAt: ts(at(2026, 1, 20)), region: 'HQ', dueDate: '2026-03-01' }),      // 一般
    req({ createdAt: ts(at(2026, 1, 21)), region: 'US', dueDate: '2026-03-01', urgent: true }), // 手動急件
    req({ createdAt: ts(at(2026, 2, 2)), region: 'US', dueDate: '2026-02-04' }),       // 急件
    req({ createdAt: ts(at(2026, 2, 3)), region: 'ZZ', dueDate: '2026-04-01' }),       // 不在清單的地區
    req({ createdAt: ts(at(2026, 2, 4)), region: 'HQ', status: 'rejected' }),          // 已駁回不算
    req({ createdAt: ts(at(2025, 12, 31)), region: 'HQ' }),                            // 別的年份
    req({ createdAt: null, region: 'HQ' }),                                            // 沒有提交時間
    req({ createdAt: ts(at(2026, 3, 1)), region: '', dueDate: '2026-03-02' }),         // 沒填地區
  ]
  const s = buildMonthlyStats(list, 2026)

  it('一律 12 個月；每月總數與急件數正確', () => {
    expect(s.months.length).toBe(12)
    expect(s.months[0]).toMatchObject({ month: '2026-01', total: 3, urgent: 2 })
    expect(s.months[1]).toMatchObject({ month: '2026-02', total: 2, urgent: 1 })
    expect(s.months[2]).toMatchObject({ month: '2026-03', total: 1, urgent: 1 })
    expect(s.months[3].total).toBe(0)
  })
  it('每月各地區數量與急件數', () => {
    expect(s.months[0].byRegion).toEqual({ HQ: { total: 2, urgent: 1 }, US: { total: 1, urgent: 1 } })
    expect(s.months[1].byRegion.US).toEqual({ total: 1, urgent: 1 })
  })
  it('地區欄依固定順序，清單外的地區與未填排在後面；沒資料的地區不列', () => {
    expect(s.regions).toEqual(['HQ', 'US', 'ZZ', '未填'])
  })
  it('全年合計與略過筆數', () => {
    expect(s.totals).toMatchObject({ total: 6, urgent: 4 })
    expect(s.totals.byRegion.HQ).toEqual({ total: 2, urgent: 1 })
    expect(s.skipped).toEqual({ rejected: 1, noDate: 1 })
  })
  it('沒有資料也不會壞', () => {
    const e = buildMonthlyStats([], 2026)
    expect(e.regions).toEqual([])
    expect(e.totals.total).toBe(0)
  })
})

describe('requestsOfMonth', () => {
  const list = [
    req({ id: 'a', createdAt: ts(at(2026, 1, 5)), region: 'HQ' }),
    req({ id: 'b', createdAt: ts(at(2026, 1, 20)), region: 'US' }),
    req({ id: 'c', createdAt: ts(at(2026, 1, 21)), region: 'HQ', status: 'rejected' }),
    req({ id: 'd', createdAt: ts(at(2026, 2, 1)), region: 'HQ' }),
  ]
  it('依月份過濾、排除已駁回、新到舊', () => {
    expect(requestsOfMonth(list, '2026-01').map(r => r.id)).toEqual(['b', 'a'])
  })
  it('可再指定地區', () => {
    expect(requestsOfMonth(list, '2026-01', 'HQ').map(r => r.id)).toEqual(['a'])
  })
})
