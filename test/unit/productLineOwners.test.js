import { describe, it, expect } from 'vitest'
import { PRODUCT_LINES } from '../../src/utils/newProducts.js'
import {
  OFFICIAL_SUBS, officialSubsOf, isOfficialRow, rowId, rowPath, subLabelOf, buildModel, summarizeByDesigner,
  diffOwners, validateRow, customSubKey, SEED_ROWS, buildSeedPlan, PHOTO_METHODS, CUSTOM_SUB_PREFIX,
} from '../../src/utils/productLineOwners.js'

const resolve = (name) => ({ email: `${name.toLowerCase()}@example.com`, name })
const allCategories = PRODUCT_LINES.flatMap(l => l.categories.map(c => ({ line: l.key, category: c.key })))
const docFromSeed = (plan) => plan.docs.map(d => ({ id: d.id, ...d.data }))

describe('官網分類快照', () => {
  it('每個官網分類都有子分類清單，且清單的 key 都屬於存在的分類', () => {
    for (const { line, category } of allCategories) expect(officialSubsOf(line, category).length, `${line}/${category}`).toBeGreaterThan(0)
    const valid = new Set(allCategories.map(c => `${c.line}/${c.category}`))
    for (const k of Object.keys(OFFICIAL_SUBS)) expect(valid.has(k), k).toBe(true)
  })
  it('同一分類內的子分類 key 不重複', () => {
    for (const [k, subs] of Object.entries(OFFICIAL_SUBS)) {
      expect(new Set(subs.map(s => s.key)).size, k).toBe(subs.length)
    }
  })
  it('isOfficialRow：整個分類與官網子分類算官網有，自訂項目與不存在的分類不算', () => {
    expect(isOfficialRow({ line: 'consumer', category: 'usb', sub: '' })).toBe(true)
    expect(isOfficialRow({ line: 'consumer', category: 'usb', sub: 'usb20' })).toBe(true)
    expect(isOfficialRow({ line: 'consumer', category: 'usb', sub: 'x-otg' })).toBe(false)
    expect(isOfficialRow({ line: 'consumer', category: 'gone', sub: '' })).toBe(false)
  })
})

describe('初始資料(試算表對照)', () => {
  it('試算表共對照成 36 列，id 不重複', () => {
    expect(SEED_ROWS.length).toBe(36)
    const ids = SEED_ROWS.map(s => rowId(s.line, s.category, s.sub))
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('每列的分類都存在；非自訂的子分類都在官網清單；自訂項目以 x- 開頭且有名稱', () => {
    for (const s of SEED_ROWS) {
      expect(allCategories.some(c => c.line === s.line && c.category === s.category), rowPath(s)).toBe(true)
      if (!s.sub) continue
      if (s.sub.startsWith(CUSTOM_SUB_PREFIX)) {
        expect(s.subLabel, s.sub).toBeTruthy()
        expect(s.sub).toBe(customSubKey(s.subLabel))
      } else {
        expect(officialSubsOf(s.line, s.category).some(x => x.key === s.sub), `${s.category}/${s.sub}`).toBe(true)
      }
    }
  })
  it('負責人只有試算表上的三位，製作方式只有合成/拍照，每列至少一位負責人', () => {
    for (const s of SEED_ROWS) {
      expect(s.owners.length).toBeGreaterThan(0)
      for (const o of s.owners) expect(['Sherry', 'Tingwei', 'Yuna']).toContain(o)
      expect(PHOTO_METHODS).toContain(s.photoMethod)
    }
  })
  it('試算表標示「刪除」的三列(JetDrive、SJC、DBN1)是預計刪除，其餘為正常', () => {
    const removed = SEED_ROWS.filter(s => s.status === 'to_remove').map(s => s.subLabel).sort()
    expect(removed).toEqual(['DBN1', 'JetDrive', 'SJC'])
  })
  it('試算表備註的 5 筆交接(A -> B)只進歷史，不改變負責人', () => {
    const withHandover = SEED_ROWS.filter(s => s.handover)
    expect(withHandover.length).toBe(5)
    for (const s of withHandover) expect(s.owners).toEqual(s.handover.to)
  })
  it('套用後官網有、卻還沒負責人的只剩 3 項(企業級 SSD 兩個子分類、內接式固態硬碟配件)', () => {
    const plan = buildSeedPlan([], resolve)
    const model = buildModel(docFromSeed(plan))
    expect(model.missing.map(m => `${m.category}/${m.sub}`).sort()).toEqual(['enterprise-ssd-solutions/pcie-essd', 'enterprise-ssd-solutions/sata-essd', 'internal-ssd/accessory'])
    expect(model.stats.missing).toBe(3)
  })
  it('buildSeedPlan：全部標成待確認、帶入解析後的負責人、產生 5 筆交接歷史', () => {
    const plan = buildSeedPlan([], resolve)
    expect(plan.docs.length).toBe(36)
    expect(plan.docs.every(d => d.data.confirmed === false)).toBe(true)
    expect(plan.history.length).toBe(5)
    expect(plan.history[0]).toMatchObject({ kind: 'handover' })
    expect(plan.history.some(h => h.fromNames[0] === 'Yuna' && h.toNames[0] === 'Sherry')).toBe(true)
    const jet = plan.docs.find(d => d.id === rowId('consumer', 'internal-ssd', 'x-jetdrive'))
    expect(jet.data.owners.map(o => o.name)).toEqual(['Sherry', 'Yuna'])
    expect(jet.data.status).toBe('to_remove')
    expect(plan.unresolved).toEqual([])
  })
  it('buildSeedPlan 可重複套用：已存在的列跳過，不會覆蓋主管改過的資料', () => {
    const first = buildSeedPlan([], resolve)
    const again = buildSeedPlan(first.docs.map(d => d.id), resolve)
    expect(again.docs.length).toBe(0)
    expect(again.history.length).toBe(0)
    expect(again.skipped).toBe(36)
    const partial = buildSeedPlan(first.docs.slice(0, 10).map(d => d.id), resolve)
    expect(partial.docs.length).toBe(26)
  })
  it('找不到對應帳號的名字：email 留空並列在 unresolved', () => {
    const plan = buildSeedPlan([], (n) => (n === 'Yuna' ? { email: '', name: n } : resolve(n)))
    expect(plan.unresolved).toEqual(['Yuna'])
  })
})

describe('buildModel', () => {
  it('沒有任何資料：官網每個子分類都是「尚無負責人」', () => {
    const model = buildModel([])
    const totalSubs = Object.values(OFFICIAL_SUBS).reduce((n, s) => n + s.length, 0)
    expect(model.stats.missing).toBe(totalSubs)
    expect(model.stats.total).toBe(0)
    expect(model.lines.map(l => l.key)).toEqual(['embedded', 'consumer'])
  })
  it('有整個分類的負責人時，該分類底下的子分類不再補「尚無負責人」', () => {
    const model = buildModel([{ id: 'a', line: 'consumer', category: 'dashcam', sub: '', owners: [{ name: 'Yuna' }] }])
    const cat = model.lines[1].categories.find(c => c.key === 'dashcam')
    expect(cat.covered).toBe(true)
    expect(cat.rows.map(r => r.kind)).toEqual(['doc'])
  })
  it('自訂項目排在官網子分類之後，並標為官網未列；官網已無的分類歸入 orphans', () => {
    const model = buildModel([
      { id: 'a', line: 'consumer', category: 'usb', sub: 'usb20', owners: [{ name: 'Yuna' }] },
      { id: 'b', line: 'consumer', category: 'usb', sub: 'x-otg', subLabel: 'OTG', owners: [{ name: 'Yuna' }] },
      { id: 'c', line: 'consumer', category: 'old-cat', sub: '', owners: [{ name: 'Yuna' }] },
    ])
    const usb = model.lines[1].categories.find(c => c.key === 'usb')
    expect(usb.rows.map(r => r.id)).toEqual([rowId('consumer', 'usb', 'usb32'), 'a', rowId('consumer', 'usb', 'android'), 'b'])
    expect(usb.rows[0].kind).toBe('missing')
    expect(model.orphans.map(o => o.id)).toEqual(['c'])
    expect(model.stats.notOnSite).toBe(2) // x-otg 與 old-cat
  })
  it('統計：待確認、預計刪除', () => {
    const model = buildModel([
      { id: 'a', line: 'consumer', category: 'usb', sub: 'usb20', owners: [{ name: 'Y' }], confirmed: true },
      { id: 'b', line: 'consumer', category: 'usb', sub: 'usb32', owners: [{ name: 'Y' }], confirmed: false, status: 'to_remove' },
    ])
    expect(model.stats).toMatchObject({ total: 2, unconfirmed: 1, toRemove: 1 })
  })
})

describe('diffOwners / validateRow / 其他', () => {
  it('負責人順序不同不算變更；新增、移除各自找得出來；有 email 以 email 為準', () => {
    expect(diffOwners([{ name: 'A', email: 'a@x' }, { name: 'B', email: 'b@x' }], [{ name: 'B', email: 'b@x' }, { name: 'A', email: 'a@x' }]).changed).toBe(false)
    const d = diffOwners([{ name: 'A', email: 'a@x' }], [{ name: 'A', email: 'a@x' }, { name: 'B', email: 'b@x' }])
    expect(d.added.map(o => o.name)).toEqual(['B'])
    expect(d.removed).toEqual([])
    expect(diffOwners([{ name: 'A', email: 'a@x' }], [{ name: 'A2', email: 'a@x' }]).changed).toBe(false) // 改顯示名稱不算換人
    expect(diffOwners([{ name: 'Yuna', email: '' }], [{ name: 'yuna', email: '' }]).changed).toBe(false)
    expect(diffOwners([], [{ name: 'A', email: 'a@x' }]).changed).toBe(true)
  })
  it('validateRow', () => {
    const ok = { line: 'consumer', category: 'usb', sub: 'usb20', owners: [{ name: 'Y' }] }
    expect(validateRow(ok)).toBe('')
    expect(validateRow({ ...ok, line: '' })).toBe('請選擇產品線')
    expect(validateRow({ ...ok, category: 'nope' })).toBe('請選擇分類')
    expect(validateRow({ ...ok, owners: [] })).toBe('請至少選擇一位負責設計師')
    expect(validateRow({ ...ok, sub: 'x-abc', subLabel: ' ' })).toBe('請輸入項目名稱')
    expect(validateRow({ ...ok, sub: 'x-abc', subLabel: 'ABC' })).toBe('')
  })
  it('customSubKey 與 rowPath、subLabelOf', () => {
    expect(customSubKey('Jet Drive / Lite')).toBe('x-jet-drive-lite')
    expect(customSubKey('JetDrive')).toBe('x-jetdrive')
    const r = { line: 'embedded', category: 'ssd', sub: 'u2' }
    expect(rowPath(r)).toBe('嵌入式解決方案 › 工業用SSD解決方案 › U.2 SSD')
    expect(subLabelOf({ ...r, sub: '' })).toBe('整個分類')
    expect(subLabelOf({ line: 'consumer', category: 'usb', sub: 'x-otg', subLabel: 'OTG' })).toBe('OTG')
  })
  it('summarizeByDesigner：依名字彙總，沒負責人歸未指派，指定的設計師即使沒有列也會出現', () => {
    const out = summarizeByDesigner([
      { id: 1, owners: [{ name: 'Yuna' }, { name: 'Sherry' }] },
      { id: 2, owners: [{ name: 'Yuna' }] },
      { id: 3, owners: [] },
    ], ['Sherry', 'Tingwei', 'Yuna'])
    const by = Object.fromEntries(out.map(o => [o.name, o.rows.length]))
    expect(by).toEqual({ Sherry: 1, Tingwei: 0, Yuna: 2, 未指派: 1 })
  })
})
