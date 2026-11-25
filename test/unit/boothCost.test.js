import { describe, it, expect } from 'vitest'
import { perBoothRentByOffice } from '../../src/utils/boothCost.js'

const show = (o) => ({ name: 'S', office: 'US', rentUSD: 10000, boothSize: 2, ...o })

describe('perBoothRentByOffice', () => {
  it('每場先算 租金÷攤位數，再把同分公司的各場取平均(不是總租金÷總攤位)', () => {
    const { rows } = perBoothRentByOffice([
      show({ rentUSD: 10000, boothSize: 2 }),   // 5000
      show({ rentUSD: 9000, boothSize: 9 }),    // 1000
    ])
    expect(rows).toEqual([{ office: 'US', shows: 2, avg: 3000, min: 1000, max: 5000 }])
  })
  it('依平均由高到低排序、各分公司分開算', () => {
    const { rows } = perBoothRentByOffice([
      show({ office: 'JP', rentUSD: 3000, boothSize: 3 }),   // 1000
      show({ office: 'GM', rentUSD: 8000, boothSize: 2 }),   // 4000
      show({ office: 'US', rentUSD: 6000, boothSize: 2 }),   // 3000
    ])
    expect(rows.map(r => r.office)).toEqual(['GM', 'US', 'JP'])
  })
  it('缺租金或缺攤位數量(空、0、null、負數)的場次不計入，並分別統計原因', () => {
    const r = perBoothRentByOffice([
      show({}),
      show({ rentUSD: 0 }),
      show({ rentUSD: '' }),
      show({ boothSize: null }),
      show({ boothSize: 0 }),
      show({ rentUSD: null, boothSize: null }),
      show({ boothSize: -1 }),
    ])
    expect(r.counted).toBe(1)
    expect(r.skipped).toEqual({ noRent: 2, noBooths: 3, both: 1 })
    expect(r.skippedTotal).toBe(6)
  })
  it('沒填分公司歸為「未指定」；沒有資料時回空陣列', () => {
    expect(perBoothRentByOffice([show({ office: '' })]).rows[0].office).toBe('未指定')
    expect(perBoothRentByOffice([]).rows).toEqual([])
    expect(perBoothRentByOffice(null).counted).toBe(0)
  })
  it('攤位數量與租金可能是字串數字(表單輸入)，仍能正確計算', () => {
    expect(perBoothRentByOffice([show({ rentUSD: '8000', boothSize: '4' })]).rows[0].avg).toBe(2000)
  })
})
