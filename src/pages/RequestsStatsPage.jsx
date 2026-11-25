import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { statusMeta } from '../utils/requestConstants'
import { URGENT_LEAD_DAYS, buildMonthlyStats, requestsOfMonth, urgentInfo, toLocalDateStr, dateStr } from '../utils/requestUrgency'
import RequestDetailModal from '../components/RequestDetailModal'

function Card({ title, value, sub, tone = 'text-gray-800' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3">
      <p className="text-xs text-gray-500">{title}</p>
      <p className={`text-2xl font-bold mt-0.5 ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

// 一格：發稿數，急件數用紅字小標在旁邊
function Cell({ c, onClick }) {
  if (!c || c.total === 0) return <span className="text-gray-300">–</span>
  return (
    <button onClick={onClick} className="hover:bg-blue-50 rounded px-1.5 py-0.5">
      <span className="font-medium text-gray-800">{c.total}</span>
      {c.urgent > 0 && <span className="ml-1 text-[11px] text-red-500">🔥{c.urgent}</span>}
    </button>
  )
}

export default function RequestsStatsPage() {
  const [requests, setRequests] = useState([])
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [sel, setSel] = useState(null)       // { month, region|null }
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')
  const [today] = useState(() => dateStr(new Date()))

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'requests'),
      snap => setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      e => setError('讀取失敗：' + (e.code || e.message)))
    return unsub
  }, [])

  const stats = useMemo(() => buildMonthlyStats(requests, year), [requests, year])
  const thisMonth = stats.months.find(m => m.month === today.slice(0, 7))
  const list = useMemo(() => (sel ? requestsOfMonth(requests, sel.month, sel.region) : []), [requests, sel])
  const thisYear = Number(today.slice(0, 4))
  const urgentRate = stats.totals.total ? Math.round((stats.totals.urgent / stats.totals.total) * 100) : 0

  const pick = (month, region = null) => setSel(cur => (cur && cur.month === month && cur.region === region ? null : { month, region }))

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b bg-white">
        <h2 className="text-xl font-bold text-gray-800">發稿統計</h2>
        <p className="text-sm text-gray-500">每月各地區的發稿數量與急件數量。發稿日到交期不滿 {URGENT_LEAD_DAYS} 天算急件。</p>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-6xl mx-auto space-y-5">
          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex items-center gap-2">
            <button onClick={() => { setYear(y => y - 1); setSel(null) }} className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 hover:bg-gray-50" aria-label="上一年">◀</button>
            <span className="text-base font-semibold text-gray-800 w-20 text-center">{year} 年</span>
            <button onClick={() => { setYear(y => y + 1); setSel(null) }} className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 hover:bg-gray-50" aria-label="下一年">▶</button>
            {year !== thisYear && <button onClick={() => { setYear(thisYear); setSel(null) }} className="text-xs text-blue-500 hover:underline ml-1">回到今年</button>}
          </div>

          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            <Card title={`${year} 年發稿數`} value={stats.totals.total} />
            <Card title={`${year} 年急件數`} value={stats.totals.urgent} tone="text-red-600" sub={stats.totals.total ? `占 ${urgentRate}%` : ''} />
            <Card title="本月發稿數" value={year === thisYear ? (thisMonth?.total ?? 0) : '—'} sub={year === thisYear ? '' : '只在今年顯示'} />
            <Card title="本月急件數" value={year === thisYear ? (thisMonth?.urgent ?? 0) : '—'} tone="text-red-600" />
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="sticky left-0 bg-gray-50 text-left px-4 py-2 font-medium whitespace-nowrap">月份</th>
                  {stats.regions.map(r => <th key={r} className="text-center px-2 py-2 font-medium whitespace-nowrap">{r}</th>)}
                  <th className="text-center px-3 py-2 font-medium whitespace-nowrap">合計</th>
                  <th className="text-center px-3 py-2 font-medium whitespace-nowrap text-red-500">急件</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {stats.months.map(m => (
                  <tr key={m.month} className={m.month === today.slice(0, 7) ? 'bg-blue-50/50' : ''}>
                    <td className="sticky left-0 bg-white px-4 py-2 whitespace-nowrap text-gray-800">{Number(m.month.slice(5))} 月</td>
                    {stats.regions.map(r => (
                      <td key={r} className="text-center px-2 py-2"><Cell c={m.byRegion[r]} onClick={() => pick(m.month, r)} /></td>
                    ))}
                    <td className="text-center px-3 py-2">
                      {m.total ? <button onClick={() => pick(m.month)} className="font-semibold text-gray-800 hover:bg-blue-50 rounded px-1.5 py-0.5">{m.total}</button> : <span className="text-gray-300">–</span>}
                    </td>
                    <td className="text-center px-3 py-2 text-red-600 font-medium">{m.urgent || <span className="text-gray-300 font-normal">–</span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 font-semibold text-gray-800">
                <tr>
                  <td className="sticky left-0 bg-gray-50 px-4 py-2">全年</td>
                  {stats.regions.map(r => (
                    <td key={r} className="text-center px-2 py-2">
                      {stats.totals.byRegion[r].total}
                      {stats.totals.byRegion[r].urgent > 0 && <span className="ml-1 text-[11px] text-red-500 font-normal">🔥{stats.totals.byRegion[r].urgent}</span>}
                    </td>
                  ))}
                  <td className="text-center px-3 py-2">{stats.totals.total}</td>
                  <td className="text-center px-3 py-2 text-red-600">{stats.totals.urgent}</td>
                </tr>
              </tfoot>
            </table>
            {stats.regions.length === 0 && <p className="text-xs text-gray-500 px-4 py-4">{year} 年還沒有發稿紀錄</p>}
          </div>

          <p className="text-[11px] text-gray-500 leading-relaxed">
            統計說明：以需求「提交日」為發稿日，依提交月份歸月；已駁回的不算。急件 = 發稿日到交期的間隔不滿 {URGENT_LEAD_DAYS} 天(同日或已過交期也算)，或提交時手動勾選急件。
            格內紅色 🔥 數字是該格的急件數。點數字可看明細。
            {(stats.skipped.rejected > 0 || stats.skipped.noDate > 0) && ` 目前未計入：已駁回 ${stats.skipped.rejected} 筆${stats.skipped.noDate ? `、缺提交時間 ${stats.skipped.noDate} 筆` : ''}。`}
          </p>

          {sel && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-800">{sel.month}{sel.region ? ` · ${sel.region}` : ' · 全部地區'} {list.length} 筆</p>
                <button onClick={() => setSel(null)} className="text-xs text-gray-500 hover:text-gray-700">收起</button>
              </div>
              <ul className="divide-y divide-gray-100">
                {list.map(r => {
                  const u = urgentInfo(r)
                  const meta = statusMeta(r.status)
                  return (
                    <li key={r.id}>
                      <button onClick={() => setDetail(r)} className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-3 text-sm">
                        <span className="flex-1 min-w-0 truncate text-gray-800">{u.urgent && <span className="text-red-500 mr-1">🔥</span>}{r.projectName || r.title}</span>
                        <span className="text-xs text-gray-500 shrink-0">{r.region || '未填'}</span>
                        <span className="text-xs text-gray-500 shrink-0 hidden sm:inline">發稿 {toLocalDateStr(r.createdAt)} → 交期 {r.dueDate || '—'}{u.days !== null && `（${u.days} 天）`}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${meta.color}`}>{meta.label}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      </div>

      {detail && <RequestDetailModal r={detail} onClose={() => setDetail(null)} shareable={false} />}
    </div>
  )
}
