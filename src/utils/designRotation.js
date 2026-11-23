// 每月輪值設計師 —— 純函式與常數，方便測試。
//
// 一個月一份文件(文件 ID = 'yyyy-mm')，三條輪值線各自記錄當月負責的設計師：
//   transcendInfo = Transcend Info、ig = IG、industrialDm = 工控 DM
// 每條線存「負責人陣列」[{ email, name }]，通常一位，偶爾共同負責就多位。
import { localTodayStr } from './newProducts'
import { ownerKey } from './productLineOwners'

export const TRACKS = [
  { key: 'transcendInfo', label: 'Transcend Info' },
  { key: 'ig', label: 'IG' },
  { key: 'industrialDm', label: '工控 DM' },
]

export const trackLabel = (key) => TRACKS.find(t => t.key === key)?.label || key

const pad = (n) => String(n).padStart(2, '0')
export const monthKey = (year, month) => `${year}-${pad(month)}`
export const currentMonthKey = (todayStr = localTodayStr()) => todayStr.slice(0, 7)

// 'yyyy-mm' 往前/往後推 n 個月(跨年也正確)
export function shiftMonth(key, n) {
  const [y, m] = key.split('-').map(Number)
  const idx = y * 12 + (m - 1) + n
  return monthKey(Math.floor(idx / 12), (idx % 12) + 1)
}

export const monthsOfYear = (year) => Array.from({ length: 12 }, (_, i) => monthKey(year, i + 1))
export const monthLabel = (key) => `${Number(key.split('-')[1])} 月`

export const ownersOf = (doc, track) => (Array.isArray(doc?.[track]) ? doc[track] : [])
export const hasAnyDuty = (doc) => TRACKS.some(t => ownersOf(doc, t.key).length > 0)

// 一整年的列：沒資料的月份也會有一列(duties 都是空陣列)，介面才能顯示「尚未排班」
export function buildYearModel(docs, year, todayMonth = currentMonthKey()) {
  const byId = new Map((docs || []).map(d => [d.id, d]))
  return monthsOfYear(year).map(key => {
    const doc = byId.get(key) || null
    return {
      key,
      label: monthLabel(key),
      doc,
      duties: Object.fromEntries(TRACKS.map(t => [t.key, ownersOf(doc, t.key)])),
      note: doc?.note || '',
      isCurrent: key === todayMonth,
      isPast: key < todayMonth,
    }
  })
}

// 本月與接下來 horizon 個月裡，還沒排人的輪值線(提醒主管提早排)
export function upcomingGaps(docs, todayMonth = currentMonthKey(), horizon = 1) {
  const byId = new Map((docs || []).map(d => [d.id, d]))
  const out = []
  for (let i = 0; i <= horizon; i++) {
    const key = shiftMonth(todayMonth, i)
    const missing = TRACKS.filter(t => ownersOf(byId.get(key), t.key).length === 0).map(t => t.key)
    if (missing.length > 0) out.push({ month: key, missing })
  }
  return out
}

// 某一年裡每位設計師各輪了幾次(看輪得公不公平)。共同負責的月份每個人各算一次。
export function countByDesigner(docs, year, nameOrder = []) {
  const prefix = `${year}-`
  const map = new Map()
  for (const d of docs || []) {
    if (!d.id?.startsWith(prefix)) continue
    for (const t of TRACKS) {
      for (const o of ownersOf(d, t.key)) {
        const k = ownerKey(o)
        if (!map.has(k)) map.set(k, { name: o.name, counts: Object.fromEntries(TRACKS.map(x => [x.key, 0])), total: 0 })
        const row = map.get(k)
        row.counts[t.key]++
        row.total++
      }
    }
  }
  const rank = (n) => { const i = nameOrder.indexOf(n); return i === -1 ? 99 : i }
  return [...map.values()].sort((a, b) => rank(a.name) - rank(b.name) || b.total - a.total || a.name.localeCompare(b.name))
}

// 存檔用的內容；三條線都沒人、也沒備註時回 null(代表可以直接刪掉那個月份的文件)
export function buildPayload(key, duties, note) {
  const payload = { month: key, note: (note || '').trim() }
  for (const t of TRACKS) payload[t.key] = duties[t.key] || []
  const empty = TRACKS.every(t => payload[t.key].length === 0) && !payload.note
  return empty ? null : payload
}
