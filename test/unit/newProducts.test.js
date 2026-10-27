import { describe, it, expect } from 'vitest'
import {
  PRODUCT_LINES, STAGES, categoryMeta, categoryUrl, stageIndex, launchStatus, sortByLaunch,
  countByCategory, prepProgress, validateProduct,
} from '../../src/utils/newProducts.js'

describe('分類資料', () => {
  it('兩條產品線共 15 個分類，分類 key 在同一條產品線內不重複', () => {
    expect(PRODUCT_LINES.map(l => l.categories.length)).toEqual([6, 9])
    for (const l of PRODUCT_LINES) {
      const keys = l.categories.map(c => c.key)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('categoryUrl 組出官網分類頁網址，找不到回空字串', () => {
    expect(categoryUrl('embedded', 'ssd')).toBe('https://tw.transcend-info.com/Embedded/Product/ssd')
    expect(categoryUrl('consumer', 'internal-ssd')).toBe('https://tw.transcend-info.com/product/internal-ssd')
    expect(categoryUrl('consumer', 'ssd')).toBe('') // ssd 是嵌入式的分類，不屬於消費性
    expect(categoryMeta('embedded', 'ssd').label).toBe('工業用SSD解決方案')
  })
})

describe('進度階段', () => {
  it('順序為 收到通知 → 準備中 → RD 確認 → ePage 確認 → 已上線', () => {
    expect(STAGES.map(s => s.key)).toEqual(['rd', 'prep', 'rd_confirm', 'epage_confirm', 'live'])
    expect(stageIndex('epage_confirm')).toBe(3)
  })

  it('未知或沒填的階段視為第一步', () => {
    expect(stageIndex(undefined)).toBe(0)
    expect(stageIndex('nope')).toBe(0)
  })
})

describe('launchStatus', () => {
  const today = '2026-10-27'
  it('沒填預計日期或已上線 → null', () => {
    expect(launchStatus({ stage: 'prep' }, today)).toBeNull()
    expect(launchStatus({ stage: 'live', launchDate: '2026-01-01' }, today)).toBeNull()
  })
  it('超過預計日仍未上線 → overdue 並帶逾期天數', () => {
    expect(launchStatus({ stage: 'prep', launchDate: '2026-10-25' }, today)).toEqual({ tone: 'overdue', days: 2 })
  })
  it('當天與 7 天內 → soon；超過 7 天 → ok', () => {
    expect(launchStatus({ stage: 'prep', launchDate: '2026-10-27' }, today)).toEqual({ tone: 'soon', days: 0 })
    expect(launchStatus({ stage: 'prep', launchDate: '2026-11-03' }, today)).toEqual({ tone: 'soon', days: 7 })
    expect(launchStatus({ stage: 'prep', launchDate: '2026-11-04' }, today)).toEqual({ tone: 'ok', days: 8 })
  })
  it('跨月跨年也算得對', () => {
    expect(launchStatus({ stage: 'rd', launchDate: '2027-01-02' }, '2026-12-31')).toEqual({ tone: 'soon', days: 2 })
  })
})

describe('sortByLaunch', () => {
  it('上線日近到遠，沒填的排最後，同日依型號', () => {
    const list = [
      { model: 'C', launchDate: '' },
      { model: 'B', launchDate: '2026-12-01' },
      { model: 'A', launchDate: '2026-12-01' },
      { model: 'D', launchDate: '2026-11-01' },
    ]
    expect(sortByLaunch(list).map(p => p.model)).toEqual(['D', 'A', 'B', 'C'])
  })
  it('不改動原陣列', () => {
    const list = [{ model: 'B', launchDate: '2026-12-01' }, { model: 'A', launchDate: '2026-11-01' }]
    sortByLaunch(list)
    expect(list[0].model).toBe('B')
  })
})

describe('countByCategory', () => {
  it('只算指定產品線、不含已上線', () => {
    const list = [
      { line: 'embedded', category: 'ssd', stage: 'prep' },
      { line: 'embedded', category: 'ssd', stage: 'rd' },
      { line: 'embedded', category: 'ssd', stage: 'live' },
      { line: 'embedded', category: 'flash', stage: 'prep' },
      { line: 'consumer', category: 'usb', stage: 'prep' },
    ]
    expect(countByCategory(list, 'embedded')).toEqual({ ssd: 2, flash: 1 })
  })
})

describe('prepProgress', () => {
  it('計算準備中三項工作完成數', () => {
    expect(prepProgress({ prep: { copy: true, photo: true } })).toEqual({ done: 2, total: 3 })
    expect(prepProgress({})).toEqual({ done: 0, total: 3 })
  })
})

describe('validateProduct', () => {
  const ok = { line: 'embedded', category: 'ssd', model: 'MTE775A' }
  it('完整資料通過', () => { expect(validateProduct(ok)).toBe('') })
  it('缺產品線 / 分類 / 型號各回對應訊息', () => {
    expect(validateProduct({ ...ok, line: '' })).toBe('請選擇產品線')
    expect(validateProduct({ ...ok, category: '' })).toBe('請選擇分類')
    expect(validateProduct({ ...ok, model: '  ' })).toBe('請輸入型號')
  })
  it('分類必須屬於所選產品線', () => {
    expect(validateProduct({ ...ok, line: 'consumer' })).toBe('請選擇分類')
  })
})
