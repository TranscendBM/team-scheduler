import { describe, it, expect } from 'vitest'
import {
  TRACKS, monthKey, currentMonthKey, shiftMonth, monthsOfYear, monthLabel, ownersOf, hasAnyDuty,
  buildYearModel, upcomingGaps, countByDesigner, buildPayload,
} from '../../src/utils/designRotation.js'

const o = (name) => ({ email: `${name.toLowerCase()}@example.com`, name })

describe('月份工具', () => {
  it('monthKey / currentMonthKey / monthLabel', () => {
    expect(monthKey(2026, 3)).toBe('2026-03')
    expect(currentMonthKey('2026-11-23')).toBe('2026-11')
    expect(monthLabel('2026-03')).toBe('3 月')
    expect(monthLabel('2026-12')).toBe('12 月')
  })
  it('shiftMonth 跨年也正確', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-11', 14)).toBe('2028-01')
    expect(shiftMonth('2026-05', 0)).toBe('2026-05')
  })
  it('monthsOfYear 有 12 個月、依序', () => {
    const m = monthsOfYear(2026)
    expect(m.length).toBe(12)
    expect(m[0]).toBe('2026-01')
    expect(m[11]).toBe('2026-12')
  })
})

describe('輪值線', () => {
  it('固定三條：Transcend Info、IG、工控 DM', () => {
    expect(TRACKS.map(t => t.label)).toEqual(['Transcend Info', 'IG', '工控 DM'])
  })
  it('ownersOf 對缺資料、壞資料都安全', () => {
    expect(ownersOf(null, 'ig')).toEqual([])
    expect(ownersOf({ ig: 'Yuna' }, 'ig')).toEqual([])
    expect(ownersOf({ ig: [o('Yuna')] }, 'ig').map(x => x.name)).toEqual(['Yuna'])
    expect(hasAnyDuty({ id: 'x' })).toBe(false)
    expect(hasAnyDuty({ ig: [o('Yuna')] })).toBe(true)
  })
})

describe('buildYearModel', () => {
  const docs = [
    { id: '2026-10', transcendInfo: [o('Sherry')], ig: [o('Yuna')], industrialDm: [o('Tingwei')], note: '十月' },
    { id: '2026-11', transcendInfo: [o('Tingwei')], ig: [], industrialDm: [] },
  ]
  it('一律回 12 列；沒資料的月份 duties 為空陣列；標出本月與過去月份', () => {
    const rows = buildYearModel(docs, 2026, '2026-11')
    expect(rows.length).toBe(12)
    expect(rows[0].duties).toEqual({ transcendInfo: [], ig: [], industrialDm: [] })
    expect(rows[9].note).toBe('十月')
    expect(rows[9].isPast).toBe(true)
    expect(rows[10].isCurrent).toBe(true)
    expect(rows[11].isCurrent).toBe(false)
    expect(rows[11].isPast).toBe(false)
  })
  it('只取該年份的資料', () => {
    const rows = buildYearModel([{ id: '2025-10', ig: [o('Yuna')] }], 2026, '2026-11')
    expect(rows.every(r => r.doc === null)).toBe(true)
  })
})

describe('upcomingGaps', () => {
  const docs = [
    { id: '2026-11', transcendInfo: [o('A')], ig: [o('B')], industrialDm: [o('C')] },
    { id: '2026-12', transcendInfo: [o('A')], ig: [], industrialDm: [] },
  ]
  it('本月排滿、下個月缺兩條 → 只回報下個月，並列出缺哪些線', () => {
    expect(upcomingGaps(docs, '2026-11')).toEqual([{ month: '2026-12', missing: ['ig', 'industrialDm'] }])
  })
  it('本月與下個月都完全沒排 → 兩個月都回報(跨年也對)', () => {
    const gaps = upcomingGaps([], '2026-12')
    expect(gaps.map(g => g.month)).toEqual(['2026-12', '2027-01'])
    expect(gaps[0].missing).toEqual(['transcendInfo', 'ig', 'industrialDm'])
  })
  it('horizon=0 只看本月', () => {
    expect(upcomingGaps([], '2026-11', 0).length).toBe(1)
  })
})

describe('countByDesigner', () => {
  const docs = [
    { id: '2026-01', transcendInfo: [o('Sherry')], ig: [o('Yuna')], industrialDm: [o('Sherry')] },
    { id: '2026-02', transcendInfo: [o('Yuna'), o('Sherry')], ig: [], industrialDm: [] },
    { id: '2025-12', ig: [o('Yuna')] },
  ]
  it('依設計師與輪值線計次、共同負責各算一次、不含其他年份', () => {
    const rows = countByDesigner(docs, 2026, ['Sherry', 'Tingwei', 'Yuna'])
    expect(rows.map(r => r.name)).toEqual(['Sherry', 'Yuna'])
    expect(rows[0]).toMatchObject({ total: 3, counts: { transcendInfo: 2, ig: 0, industrialDm: 1 } })
    expect(rows[1]).toMatchObject({ total: 2, counts: { transcendInfo: 1, ig: 1, industrialDm: 0 } })
  })
  it('沒有資料回空陣列', () => {
    expect(countByDesigner([], 2026)).toEqual([])
  })
})

describe('buildPayload', () => {
  it('有內容就回完整文件內容(備註去頭尾空白)', () => {
    const p = buildPayload('2026-11', { transcendInfo: [o('Yuna')] }, '  備註  ')
    expect(p).toEqual({ month: '2026-11', note: '備註', transcendInfo: [o('Yuna')], ig: [], industrialDm: [] })
  })
  it('三條線都沒人也沒備註 → null(代表直接刪除該月文件)', () => {
    expect(buildPayload('2026-11', {}, '  ')).toBeNull()
  })
  it('只有備註也算有內容', () => {
    expect(buildPayload('2026-11', {}, '本月暫停')).not.toBeNull()
  })
})
