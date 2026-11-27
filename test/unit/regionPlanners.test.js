import { describe, it, expect } from 'vitest'
import { REGIONS, regionKeyOfOffice, resolveRegionPlanners, plannerNames } from '../../src/utils/regionPlanners.js'

const people = [
  { id: 'p1', name: 'Rachel Chen', role: 'planner' },
  { id: 'p2', name: 'Ecco', role: 'planner' },
  { id: 'p3', name: 'Shinpei', role: 'planner' },
  { id: 'p4', name: 'ashley', role: 'planner' },
  { id: 'p5', name: 'Amy', role: 'planner' },
  { id: 'd1', name: 'Rachel Design', role: 'designer' },
]

describe('regionKeyOfOffice', () => {
  it('分公司代碼 → 地區', () => {
    expect(REGIONS.map(r => r.label)).toEqual(['HQ', 'TW', 'US', 'EU', 'JPKR', 'CN'])
    expect(regionKeyOfOffice('GM')).toBe('eu')
    expect(regionKeyOfOffice('NL')).toBe('eu')
    expect(regionKeyOfOffice('KR')).toBe('jpkr')
    expect(regionKeyOfOffice('SZ')).toBe('cn')
    expect(regionKeyOfOffice('HQ')).toBe('hq')
    expect(regionKeyOfOffice('')).toBe(null)
    expect(regionKeyOfOffice('XX')).toBe(null)
  })
})

describe('resolveRegionPlanners', () => {
  it('沒設定時：TW Rachel、US Ashley、EU Ecco、JPKR Shinpei(姓名比對、優先 planner)，HQ、CN 沒人', () => {
    const m = resolveRegionPlanners({}, 2027, people)
    expect(m).toEqual({ hq: [], tw: ['p1'], us: ['p4'], eu: ['p2'], jpkr: ['p3'], cn: [] })
  })
  it('年度有設定的地區以設定為準(HQ 每年不同)，沒設定的地區仍用預設', () => {
    const cfg = { 2027: { hq: ['p5'] }, 2026: { hq: ['p2'] } }
    expect(resolveRegionPlanners(cfg, 2027, people).hq).toEqual(['p5'])
    expect(resolveRegionPlanners(cfg, 2026, people).hq).toEqual(['p2'])
    expect(resolveRegionPlanners(cfg, 2028, people).hq).toEqual([])
    expect(resolveRegionPlanners(cfg, 2027, people).tw).toEqual(['p1'])
  })
  it('設成空陣列＝刻意不指定，不會再套預設', () => {
    expect(resolveRegionPlanners({ 2027: { tw: [] } }, 2027, people).tw).toEqual([])
  })
  it('people 裡找不到預設姓名 → 空；沒有 config/people 也不會當掉', () => {
    expect(resolveRegionPlanners(null, 2027, []).tw).toEqual([])
    expect(resolveRegionPlanners(undefined, 2027, undefined).eu).toEqual([])
  })
})

describe('plannerNames', () => {
  it('把 id 轉成姓名，找不到的略過', () => {
    expect(plannerNames({ tw: ['p1', 'zzz'] }, 'tw', people)).toEqual(['Rachel Chen'])
    expect(plannerNames({}, 'hq', people)).toEqual([])
  })
})
