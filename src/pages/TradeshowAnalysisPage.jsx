import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, onSnapshot, doc } from 'firebase/firestore'
import { db } from '../firebase'
import { sortByOfficeOrder } from '../utils/officeCurrency'

const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
const BAR_COLORS = ['#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#F97316', '#10B981', '#06B6D4', '#84CC16']

function totalCostUSD(p) {
  return (p.rentUSD || 0) + (p.decorUSD || 0) + (p.prUSD || 0)
}
const fmtUSD = (n) => `$${Math.round(n).toLocaleString()}`

export default function TradeshowAnalysisPage() {
  const [projects, setProjects] = useState([])
  const [year, setYear] = useState(new Date().getFullYear())
  const [target, setTarget] = useState(null)

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'projects'), snap =>
      setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.type === 'tradeshow')))
    return unsub
  }, [])

  const [targetByOffice, setTargetByOffice] = useState({})

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'tradeshowTargets'), snap => {
      const t = snap.exists() ? snap.data()[String(year)] : undefined
      if (typeof t === 'number') {
        // 舊格式（未分公司），尚未在「年度目標」頁轉換
        setTarget(t)
        setTargetByOffice({})
      } else if (t && typeof t === 'object') {
        const sum = Object.values(t).reduce((a, b) => a + (Number(b) || 0), 0)
        setTarget(sum)
        setTargetByOffice(t)
      } else {
        setTarget(null)
        setTargetByOffice({})
      }
    })
    return unsub
  }, [year])

  const years = [...new Set(projects.map(p => p.year).filter(Boolean))].sort()
  if (!years.includes(year)) years.push(year)
  years.sort()

  const yearShows = projects.filter(p => p.year === year)
  const count = yearShows.length
  const pct = target ? Math.min(100, Math.round((count / target) * 100)) : null

  // 月份分布（依 startDate）
  const byMonth = Array(12).fill(0)
  yearShows.forEach(p => {
    if (!p.startDate) return
    const m = parseInt(p.startDate.slice(5, 7)) - 1
    if (m >= 0 && m < 12) byMonth[m]++
  })
  const maxMonthCount = Math.max(1, ...byMonth)

  // 各 Office/地區費用比較（攤位租金+裝潢+PR 總預算 USD）
  const byOffice = {}
  yearShows.forEach(p => {
    const office = p.office || '未指定'
    const cost = totalCostUSD(p)
    if (cost <= 0) return
    byOffice[office] = (byOffice[office] || 0) + cost
  })
  const officeRows = Object.entries(byOffice).sort((a, b) => b[1] - a[1])
  const maxOfficeCost = Math.max(1, ...officeRows.map(([, v]) => v))

  // 各分公司平均秀展租金／PR 費用（USD，只計入有填該筆費用的場次）
  function avgByOffice(field) {
    const sum = {}, cnt = {}
    yearShows.forEach(p => {
      const v = p[field]
      if (!v || v <= 0) return
      const office = p.office || '未指定'
      sum[office] = (sum[office] || 0) + v
      cnt[office] = (cnt[office] || 0) + 1
    })
    return Object.keys(sum).map(o => [o, sum[o] / cnt[o]]).sort((a, b) => b[1] - a[1])
  }
  const avgRentRows = avgByOffice('rentUSD')
  const maxAvgRent = Math.max(1, ...avgRentRows.map(([, v]) => v))
  const avgPrRows = avgByOffice('prUSD')
  const maxAvgPr = Math.max(1, ...avgPrRows.map(([, v]) => v))

  const totalBudget = yearShows.reduce((sum, p) => sum + totalCostUSD(p), 0)
  const missingBudget = yearShows.filter(p => totalCostUSD(p) <= 0).length

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-800">秀展預算分析</h1>
        <select value={year} onChange={e => setYear(parseInt(e.target.value))}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white text-gray-700">
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      <p className="text-sm text-gray-400 mb-6">{year} 年度秀展數量、月份分布與各地區費用比較</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {/* 秀展數量與目標 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-400 mb-2">秀展數量與目標</p>
          <div className="flex items-baseline gap-1.5 mb-2">
            <span className="text-3xl font-bold text-gray-800">{count}</span>
            {target != null && <span className="text-sm text-gray-400">/ {target} 場</span>}
          </div>
          {target != null ? (
            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
          ) : (
            <p className="text-xs text-gray-300">尚未設定年度目標</p>
          )}
          <Link to="/tradeshow-targets" className="text-xs text-blue-500 hover:underline mt-3 inline-block">
            {target != null ? '前往修改目標 →' : '前往設定年度目標 →'}
          </Link>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-400 mb-2">預算總額（USD）</p>
          <p className="text-3xl font-bold text-gray-800">{fmtUSD(totalBudget)}</p>
          <p className="text-xs text-gray-300 mt-2">{missingBudget > 0 ? `${missingBudget} 場尚無預算資料` : '資料齊全'}</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-400 mb-2">平均每場預算（USD）</p>
          <p className="text-3xl font-bold text-gray-800">
            {count - missingBudget > 0 ? fmtUSD(totalBudget / (count - missingBudget)) : '—'}
          </p>
          <p className="text-xs text-gray-300 mt-2">僅計入已有預算資料的場次</p>
        </div>
      </div>

      {/* 各分公司目標達成率 */}
      {Object.keys(targetByOffice).length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <p className="text-sm font-semibold text-gray-700 mb-4">🎯 各分公司目標達成率</p>
          <div className="space-y-2.5">
            {sortByOfficeOrder(Object.keys(targetByOffice)).map(office => {
              const t = targetByOffice[office]
              const c = yearShows.filter(p => (p.office || '未分公司') === office).length
              const p = t ? Math.min(100, Math.round((c / t) * 100)) : 0
              return (
                <div key={office} className="flex items-center gap-3">
                  <span className="w-14 text-xs font-medium text-gray-600 shrink-0">{office}</span>
                  <div className="flex-1 h-6 bg-gray-50 rounded overflow-hidden">
                    <div className={`h-full rounded flex items-center justify-end px-2 transition-all ${p >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                      style={{ width: `${Math.max(p, c > 0 ? 8 : 0)}%`, minWidth: c > 0 ? '2.5rem' : 0 }}>
                      {c > 0 && <span className="text-xs text-white font-medium whitespace-nowrap">{c} / {t}</span>}
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 w-10 text-right">{p}%</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 月份分布 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <p className="text-sm font-semibold text-gray-700 mb-4">📅 月份分布</p>
        <div className="flex items-end gap-2 h-32">
          {byMonth.map((c, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs text-gray-400">{c > 0 ? c : ''}</span>
              <div className="w-full bg-blue-100 rounded-t transition-all"
                style={{ height: `${(c / maxMonthCount) * 90}px`, backgroundColor: c > 0 ? '#3B82F6' : '#F3F4F6' }} />
              <span className="text-xs text-gray-400">{MONTH_LABELS[i]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 各地區費用比較 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <p className="text-sm font-semibold text-gray-700 mb-1">🌏 各地區費用比較（依 Office，USD）</p>
        <p className="text-xs text-gray-400 mb-4">攤位租金＋裝潢費用＋PR 總預算加總</p>
        {officeRows.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">目前沒有可比較的預算資料</p>
        ) : (
          <div className="space-y-2.5">
            {officeRows.map(([office, cost], i) => (
              <div key={office} className="flex items-center gap-3">
                <span className="w-14 text-xs font-medium text-gray-600 shrink-0">{office}</span>
                <div className="flex-1 h-6 bg-gray-50 rounded overflow-hidden">
                  <div className="h-full rounded flex items-center justify-end px-2 transition-all"
                    style={{ width: `${(cost / maxOfficeCost) * 100}%`, backgroundColor: BAR_COLORS[i % BAR_COLORS.length], minWidth: '2.5rem' }}>
                    <span className="text-xs text-white font-medium whitespace-nowrap">{fmtUSD(cost)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 各分公司平均租金比較 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <p className="text-sm font-semibold text-gray-700 mb-1">🏠 各分公司平均秀展租金比較（USD）</p>
        <p className="text-xs text-gray-400 mb-4">每個分公司「平均每場」攤位租金，只計入已填租金的場次</p>
        {avgRentRows.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">目前沒有可比較的租金資料</p>
        ) : (
          <div className="space-y-2.5">
            {avgRentRows.map(([office, avg], i) => (
              <div key={office} className="flex items-center gap-3">
                <span className="w-14 text-xs font-medium text-gray-600 shrink-0">{office}</span>
                <div className="flex-1 h-6 bg-gray-50 rounded overflow-hidden">
                  <div className="h-full rounded flex items-center justify-end px-2 transition-all"
                    style={{ width: `${(avg / maxAvgRent) * 100}%`, backgroundColor: BAR_COLORS[i % BAR_COLORS.length], minWidth: '2.5rem' }}>
                    <span className="text-xs text-white font-medium whitespace-nowrap">{fmtUSD(avg)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 各分公司平均 PR 費用比較 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-sm font-semibold text-gray-700 mb-1">📣 各分公司平均 PR 費用比較（USD）</p>
        <p className="text-xs text-gray-400 mb-4">每個分公司「平均每場」PR 預算，只計入已填 PR 費用的場次</p>
        {avgPrRows.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">目前沒有可比較的 PR 費用資料</p>
        ) : (
          <div className="space-y-2.5">
            {avgPrRows.map(([office, avg], i) => (
              <div key={office} className="flex items-center gap-3">
                <span className="w-14 text-xs font-medium text-gray-600 shrink-0">{office}</span>
                <div className="flex-1 h-6 bg-gray-50 rounded overflow-hidden">
                  <div className="h-full rounded flex items-center justify-end px-2 transition-all"
                    style={{ width: `${(avg / maxAvgPr) * 100}%`, backgroundColor: BAR_COLORS[i % BAR_COLORS.length], minWidth: '2.5rem' }}>
                    <span className="text-xs text-white font-medium whitespace-nowrap">{fmtUSD(avg)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
