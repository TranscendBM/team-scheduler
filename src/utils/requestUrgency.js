// 發稿時間到交期的間隔 → 急件判定，以及「每月 × 地區」發稿統計。純函式，方便測試。
//
// 定義(請與使用者確認過的假設一致)：
//   發稿時間 = 需求提交時間(createdAt)，用本地時區的「日曆日」計算
//   間隔天數 = 交期日 − 發稿日(同一天 = 0 天；交期早於發稿日 = 負數)
//   間隔 < 7 天 → 急件(剛好 7 天不算急件)
import { REGIONS } from './requestConstants'

export const URGENT_LEAD_DAYS = 7

const pad = (n) => String(n).padStart(2, '0')
export const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// Firestore Timestamp / Date / ISO 字串 / {seconds} → 本地日期 'yyyy-mm-dd'；無法解析回 ''
export function toLocalDateStr(v) {
  if (!v) return ''
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  let d
  if (typeof v.toDate === 'function') d = v.toDate()
  else if (typeof v.seconds === 'number') d = new Date(v.seconds * 1000)
  else d = new Date(v)
  return d instanceof Date && !isNaN(d) ? dateStr(d) : ''
}

const DAY = 86400000
const utc = (s) => Date.parse(`${s}T00:00:00Z`)

// 發稿日到交期的間隔天數；任一個日期缺少或格式不對回 null
export function leadDays(publishDate, dueDate) {
  const p = toLocalDateStr(publishDate)
  const d = toLocalDateStr(dueDate)
  if (!p || !d) return null
  const diff = Math.round((utc(d) - utc(p)) / DAY)
  return Number.isFinite(diff) ? diff : null
}

// 程式計算的急件：間隔不足 7 天(含交期當天、已過期)。日期不完整時不判定
export function isAutoUrgent(publishDate, dueDate) {
  const n = leadDays(publishDate, dueDate)
  return n !== null && n < URGENT_LEAD_DAYS
}

// 一筆需求目前算不算急件：系統計算命中，或當初送件時手動勾選了急件
export function urgentInfo(r) {
  const days = leadDays(r?.createdAt, r?.dueDate)
  const auto = days !== null && days < URGENT_LEAD_DAYS
  const manual = !!r?.urgent
  return { urgent: auto || manual, auto, manual, days }
}

// 每月 × 地區發稿統計。已駁回的需求不算發稿；沒有提交時間的資料略過。
// 回傳 { regions, months: [{ month, total, urgent, byRegion:{R:{total,urgent}} }], totals }
// regions 依 REGIONS 順序，需求裡出現但不在清單內的地區附在後面；只列出該年有資料的地區。
export function buildMonthlyStats(requests, year) {
  const prefix = `${year}-`
  const months = Array.from({ length: 12 }, (_, i) => ({
    month: `${year}-${pad(i + 1)}`, total: 0, urgent: 0, byRegion: {},
  }))
  const seen = new Set()
  const skipped = { rejected: 0, noDate: 0 }
  for (const r of requests || []) {
    if (r.status === 'rejected') { skipped.rejected++; continue }
    const created = toLocalDateStr(r.createdAt)
    if (!created) { skipped.noDate++; continue }
    if (!created.startsWith(prefix)) continue
    const m = months[Number(created.slice(5, 7)) - 1]
    const region = r.region || '未填'
    const cell = (m.byRegion[region] ||= { total: 0, urgent: 0 })
    const isUrgent = urgentInfo(r).urgent
    cell.total++; m.total++
    if (isUrgent) { cell.urgent++; m.urgent++ }
    seen.add(region)
  }
  const regions = [...REGIONS.filter(x => seen.has(x)), ...[...seen].filter(x => !REGIONS.includes(x)).sort()]
  const totals = { total: 0, urgent: 0, byRegion: Object.fromEntries(regions.map(x => [x, { total: 0, urgent: 0 }])) }
  for (const m of months) {
    totals.total += m.total; totals.urgent += m.urgent
    for (const [region, c] of Object.entries(m.byRegion)) {
      totals.byRegion[region].total += c.total
      totals.byRegion[region].urgent += c.urgent
    }
  }
  return { regions, months, totals, skipped }
}

// 某年某月(可再指定地區)的需求明細，給統計頁點開看清單用；依提交時間新到舊
export function requestsOfMonth(requests, month, region = null) {
  return (requests || [])
    .filter(r => r.status !== 'rejected' && toLocalDateStr(r.createdAt).startsWith(`${month}-`) && (!region || (r.region || '未填') === region))
    .sort((a, b) => toLocalDateStr(b.createdAt).localeCompare(toLocalDateStr(a.createdAt)))
}
