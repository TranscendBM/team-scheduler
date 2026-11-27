import { sortByOfficeOrder } from './officeCurrency.js'
import { REGIONS } from './regionPlanners.js'

export const BOOTH_FORMAT_ORDER = ['Show Kit', '標準', '特裝', '空地', 'Counter Booth']
export const NO_FORMAT = '未填'
export const NO_SIZE = '未填'
export const SIZE_BUCKETS = ['1 個', '2 個', '3 個', '4 個以上']

// 秀展算「已結束」：結束日期已過，或手動把狀態標為已結束
export function isTradeshowEnded(p, today) {
  if (p?.status === '已結束') return true
  return !!p?.endDate && p.endDate < today
}

// 秀展預算分析預設要看哪一年：
// 今年的秀展都已經結束(協助完)就自動看明年；今年沒有任何秀展則維持今年(不會跳到空白年度)
export function defaultAnalysisYear(shows, today) {
  const thisYear = Number(String(today).slice(0, 4))
  const mine = (shows || []).filter(p => p.year === thisYear)
  if (mine.length > 0 && mine.every(p => isTradeshowEnded(p, today))) return thisYear + 1
  return thisYear
}

// 圖表可切換的區域：全部 + HQ / TW / US / EU / JPKR / CN(分組定義在 regionPlanners.js)。offices = null 代表全部(含沒填分公司的)
export const MONTH_REGIONS = [{ key: 'all', label: '全部', offices: null }, ...REGIONS]

// 只留下指定分公司的秀展；offices = null 不篩選
export function filterByOffices(shows, offices) {
  if (!offices) return shows || []
  return (shows || []).filter(p => offices.includes(String(p.office || '').trim()))
}

// 各月份(依開始日期)的秀展場數，長度 12；offices 給陣列就只算這些分公司
export function monthlyCounts(shows, offices = null) {
  const out = Array(12).fill(0)
  for (const p of shows || []) {
    if (offices && !offices.includes(String(p.office || '').trim())) continue
    const m = parseInt(String(p.startDate || '').slice(5, 7), 10) - 1
    if (m >= 0 && m < 12) out[m]++
  }
  return out
}

// 攤位形式：空字串歸「未填」；已知形式照固定順序，其他自訂值接在後面，「未填」放最後
export function boothFormatOf(p) {
  return String(p?.boothFormat || '').trim() || NO_FORMAT
}

// 攤位數量分組：1、2、3、4 以上；沒填或 <= 0 歸「未填」
export function boothSizeBucket(p) {
  const n = Number(p?.boothSize)
  if (!(n > 0)) return NO_SIZE
  const r = Math.max(1, Math.round(n))
  return r >= 4 ? SIZE_BUCKETS[3] : SIZE_BUCKETS[r - 1]
}

// 分公司 × 分類 交叉統計(場數)。columnOrder 之外的分類接在後面；「未填」固定最後；
// 沒出現過的分類不列欄(未填也一樣，沒有就不顯示)。
export function crosstabByOffice(shows, keyFn, columnOrder = [], lastKey = null) {
  const cells = new Map() // office -> Map(col -> n)
  const seen = new Set()
  for (const p of shows || []) {
    const office = String(p.office || '').trim() || '未指定'
    const col = keyFn(p)
    seen.add(col)
    if (!cells.has(office)) cells.set(office, new Map())
    const m = cells.get(office)
    m.set(col, (m.get(col) || 0) + 1)
  }
  const known = columnOrder.filter(c => seen.has(c))
  const extra = [...seen].filter(c => !columnOrder.includes(c) && c !== lastKey).sort((a, b) => a.localeCompare(b))
  const columns = [...known, ...extra, ...(lastKey && seen.has(lastKey) ? [lastKey] : [])]
  const rows = sortByOfficeOrder([...cells.keys()]).map(office => {
    const m = cells.get(office)
    const counts = Object.fromEntries(columns.map(c => [c, m.get(c) || 0]))
    return { office, counts, total: columns.reduce((n, c) => n + counts[c], 0) }
  })
  const totals = Object.fromEntries(columns.map(c => [c, rows.reduce((n, r) => n + r.counts[c], 0)]))
  return { columns, rows, totals, total: rows.reduce((n, r) => n + r.total, 0) }
}

export const boothFormatByOffice = (shows) =>
  crosstabByOffice(shows, boothFormatOf, BOOTH_FORMAT_ORDER, NO_FORMAT)
export const boothSizeByOffice = (shows) =>
  crosstabByOffice(shows, boothSizeBucket, SIZE_BUCKETS, NO_SIZE)

// 各分公司費用總額(租金+裝潢+PR，USD)連同場數與平均，用來說明「總額 = 場數 × 平均」
export function costByOffice(shows) {
  const map = new Map()
  for (const p of shows || []) {
    const cost = (Number(p.rentUSD) || 0) + (Number(p.decorUSD) || 0) + (Number(p.prUSD) || 0)
    if (cost <= 0) continue
    const office = String(p.office || '').trim() || '未指定'
    const cur = map.get(office) || { office, shows: 0, total: 0 }
    cur.shows++
    cur.total += cost
    map.set(office, cur)
  }
  return [...map.values()].map(r => ({ ...r, avg: r.total / r.shows })).sort((a, b) => b.total - a.total)
}
