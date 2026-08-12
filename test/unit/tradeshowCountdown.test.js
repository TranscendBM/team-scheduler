import { describe, it, expect } from 'vitest'
import { addDays, daysBetween, weekRange, showCountdown } from '../../src/utils/tradeshowCountdown.js'

// 2026-08-10 是週一，2026-08-16 是週日(同一週)，2026-08-17 是下週一 —— 用這組固定日期避免測試依賴系統時間。
describe('addDays / daysBetween', () => {
  it('addDays 正常加日期，跨月會正確進位', () => {
    expect(addDays('2026-08-10', 7)).toBe('2026-08-17')
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
  })

  it('daysBetween 算兩個日期字串相差幾天，方向對調結果變號', () => {
    expect(daysBetween('2026-08-10', '2026-08-17')).toBe(7)
    expect(daysBetween('2026-08-17', '2026-08-10')).toBe(-7)
    expect(daysBetween('2026-08-13', '2026-08-13')).toBe(0)
  })
})

describe('weekRange', () => {
  it('週間任一天都算出同一組週一~週日', () => {
    expect(weekRange('2026-08-13')).toEqual(['2026-08-10', '2026-08-16']) // 週四
    expect(weekRange('2026-08-10')).toEqual(['2026-08-10', '2026-08-16']) // 週一本身
    expect(weekRange('2026-08-16')).toEqual(['2026-08-10', '2026-08-16']) // 週日本身
  })

  it('下一週一算出新的一組週一~週日', () => {
    expect(weekRange('2026-08-17')).toEqual(['2026-08-17', '2026-08-23'])
  })
})

describe('showCountdown', () => {
  const today = '2026-08-13' // 週四，本週 = 08-10~08-16，下週 = 08-17~08-23

  it('startDate<=today<=endDate：進行中，不算倒數天數', () => {
    const r = showCountdown({ startDate: '2026-08-12', endDate: '2026-08-14' }, today)
    expect(r.ongoing).toBe(true)
    expect(r.days).toBeUndefined()
  })

  it('startDate 剛好是今天：今天開展，不加本週/下週註記', () => {
    const r = showCountdown({ startDate: today }, today)
    expect(r.ongoing).toBe(false)
    expect(r.days).toBe(0)
    expect(r.label).toBe('今天開展')
  })

  it('startDate 落在本週(週六，不是今天)：加註「本週開展」，倒數天數正確', () => {
    const r = showCountdown({ startDate: '2026-08-15' }, today)
    expect(r.weekTag).toBe('本週開展')
    expect(r.days).toBe(2)
    expect(r.label).toBeUndefined()
  })

  it('startDate 落在下週：加註「下週開展」', () => {
    const r = showCountdown({ startDate: '2026-08-19' }, today)
    expect(r.weekTag).toBe('下週開展')
    expect(r.days).toBe(6)
  })

  it('startDate 超過下週：不加任何週次註記，只有倒數天數', () => {
    const r = showCountdown({ startDate: '2026-09-01' }, today)
    expect(r.weekTag).toBeNull()
    expect(r.days).toBe(19)
  })

  it('本週/下週邊界值(週一、週日)都正確算入', () => {
    expect(showCountdown({ startDate: '2026-08-16' }, today).weekTag).toBe('本週開展') // 本週最後一天(週日)
    expect(showCountdown({ startDate: '2026-08-17' }, today).weekTag).toBe('下週開展') // 下週第一天(週一)
    expect(showCountdown({ startDate: '2026-08-23' }, today).weekTag).toBe('下週開展') // 下週最後一天(週日)
    expect(showCountdown({ startDate: '2026-08-24' }, today).weekTag).toBeNull() // 下下週第一天
  })

  it('沒有 endDate 時不會被誤判成進行中(缺 endDate 就不算 ongoing)', () => {
    const r = showCountdown({ startDate: '2026-08-01' }, today)
    expect(r.ongoing).toBe(false)
  })
})
