import { describe, it, expect } from 'vitest'
import {
  defaultAnalysisYear, isTradeshowEnded, boothFormatByOffice, boothSizeByOffice, boothSizeBucket, costByOffice,
  monthlyCounts, MONTH_REGIONS,
} from '../../src/utils/tradeshowStats.js'

describe('defaultAnalysisYear', () => {
  const today = '2026-11-27'
  const s = (o) => ({ year: 2026, endDate: '2026-12-31', status: '進行中', ...o })
  it('今年的秀展全部結束 → 看明年', () => {
    expect(defaultAnalysisYear([s({ endDate: '2026-03-01' }), s({ endDate: '2026-11-26' })], today)).toBe(2027)
  })
  it('手動標「已結束」也算結束(即使結束日期還沒到)', () => {
    expect(defaultAnalysisYear([s({ status: '已結束' })], today)).toBe(2027)
  })
  it('還有一場沒結束(含結束日=今天) → 維持今年', () => {
    expect(defaultAnalysisYear([s({ endDate: '2026-03-01' }), s({ endDate: '2026-11-27' })], today)).toBe(2026)
  })
  it('今年沒有任何秀展 → 維持今年，不跳到空白年度；只有明年的秀展不影響', () => {
    expect(defaultAnalysisYear([], today)).toBe(2026)
    expect(defaultAnalysisYear([s({ year: 2027 })], today)).toBe(2026)
  })
  it('沒填結束日期的秀展視為還沒結束', () => {
    expect(isTradeshowEnded({ endDate: '' , status: '進行中' }, today)).toBe(false)
    expect(defaultAnalysisYear([s({ endDate: '' })], today)).toBe(2026)
  })
})

describe('boothFormatByOffice', () => {
  const r = boothFormatByOffice([
    { office: 'US', boothFormat: 'Show Kit' }, { office: 'US', boothFormat: '特裝' },
    { office: 'GM', boothFormat: '標準' }, { office: 'GM', boothFormat: '' },
    { office: 'TW', boothFormat: '標準' }, { office: 'TW', boothFormat: '自訂形式' },
  ])
  it('欄位依固定順序，自訂值在後，未填在最後；沒出現的形式不列', () => {
    expect(r.columns).toEqual(['Show Kit', '標準', '特裝', '自訂形式', '未填'])
  })
  it('分公司照公司順序，各格場數與合計正確', () => {
    expect(r.rows.map(x => x.office)).toEqual(['TW', 'US', 'GM'])
    expect(r.rows.find(x => x.office === 'US').counts).toMatchObject({ 'Show Kit': 1, 特裝: 1, 標準: 0 })
    expect(r.totals['標準']).toBe(2)
    expect(r.total).toBe(6)
  })
  it('沒有資料 → 空表', () => {
    expect(boothFormatByOffice([])).toMatchObject({ columns: [], rows: [], total: 0 })
  })
})

describe('boothSizeByOffice', () => {
  it('攤位數量分組：1、2、3、4 以上、未填', () => {
    expect(boothSizeBucket({ boothSize: 1 })).toBe('1 個')
    expect(boothSizeBucket({ boothSize: '2' })).toBe('2 個')
    expect(boothSizeBucket({ boothSize: 3 })).toBe('3 個')
    expect(boothSizeBucket({ boothSize: 4 })).toBe('4 個以上')
    expect(boothSizeBucket({ boothSize: 12 })).toBe('4 個以上')
    expect(boothSizeBucket({ boothSize: 0 })).toBe('未填')
    expect(boothSizeBucket({ boothSize: '' })).toBe('未填')
  })
  it('依分公司統計場數', () => {
    const r = boothSizeByOffice([
      { office: 'US', boothSize: 1 }, { office: 'US', boothSize: 1 }, { office: 'US', boothSize: 2 },
      { office: 'JP', boothSize: 6 },
    ])
    expect(r.columns).toEqual(['1 個', '2 個', '4 個以上'])
    expect(r.rows.find(x => x.office === 'US').counts['1 個']).toBe(2)
    expect(r.totals['4 個以上']).toBe(1)
  })
})

describe('monthlyCounts / MONTH_REGIONS', () => {
  const shows = [
    { office: 'US', startDate: '2027-01-10' }, { office: 'JP', startDate: '2027-01-20' },
    { office: 'KR', startDate: '2027-03-02' }, { office: 'GM', startDate: '2027-03-09' },
    { office: 'SH', startDate: '2027-12-01' }, { office: '', startDate: '2027-05-05' },
    { office: 'US', startDate: '' },
  ]
  it('全部：依開始月份計數，沒填日期的不算', () => {
    const c = monthlyCounts(shows)
    expect(c[0]).toBe(2); expect(c[2]).toBe(2); expect(c[4]).toBe(1); expect(c[11]).toBe(1)
    expect(c.reduce((a, b) => a + b, 0)).toBe(6)
  })
  it('區域分組：JP KR 一區合併計算；沒填分公司的只出現在全部', () => {
    const jpkr = MONTH_REGIONS.find(r => r.key === 'jpkr').offices
    expect(monthlyCounts(shows, jpkr).filter(Boolean)).toEqual([1, 1])
    expect(monthlyCounts(shows, MONTH_REGIONS.find(r => r.key === 'eu').offices)[2]).toBe(1)
    expect(monthlyCounts(shows, MONTH_REGIONS.find(r => r.key === 'cn').offices)[11]).toBe(1)
    expect(monthlyCounts(shows, ['US']).reduce((a, b) => a + b, 0)).toBe(1)
  })
})

describe('costByOffice', () => {
  it('總額、計入場數與平均每場；沒有費用的場次不計入', () => {
    const r = costByOffice([
      { office: 'US', rentUSD: 1000, decorUSD: 500 },
      { office: 'US', rentUSD: 500 },
      { office: 'JP', rentUSD: 9000 },
      { office: 'JP' },
    ])
    expect(r).toEqual([
      { office: 'JP', shows: 1, total: 9000, avg: 9000 },
      { office: 'US', shows: 2, total: 2000, avg: 1000 },
    ])
  })
})
