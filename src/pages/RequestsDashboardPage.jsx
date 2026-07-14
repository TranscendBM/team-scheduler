import { useEffect, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { statusMeta, ACTIVE_STATUSES } from '../utils/requestConstants'
import RequestDetailModal from '../components/RequestDetailModal'

const DAY = 24 * 60 * 60 * 1000
const BAR_COLORS = {
  assigned: 'bg-blue-400',
  in_progress: 'bg-indigo-500',
  reviewing: 'bg-purple-500',
}

function toDate(v) {
  if (!v) return null
  if (v.toDate) return v.toDate()
  const d = new Date(v)
  return isNaN(d) ? null : d
}
function dayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function fmtMD(d) { return `${d.getMonth() + 1}/${d.getDate()}` }

// loading 等級:進行中任務數 → 顏色
function loadingMeta(n) {
  if (n === 0) return { label: '無任務', cls: 'bg-gray-100 text-gray-400' }
  if (n <= 2) return { label: `${n} 件 · 輕度`, cls: 'bg-emerald-100 text-emerald-700' }
  if (n <= 4) return { label: `${n} 件 · 中度`, cls: 'bg-amber-100 text-amber-700' }
  return { label: `${n} 件 · 高度`, cls: 'bg-red-100 text-red-700' }
}

export default function RequestsDashboardPage() {
  const [designers, setDesigners] = useState([])
  const [requests, setRequests] = useState([])
  const [detail, setDetail] = useState(null)

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'users'), snap =>
      setDesigners(snap.docs.map(d => d.data()).filter(u => u.role === 'designer' && u.active !== false)))
    const u2 = onSnapshot(collection(db, 'requests'), snap =>
      setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return () => { u1(); u2() }
  }, [])

  // 時間窗:今天往前 3 天 ~ 往後 25 天(共 4 週)
  const today = dayStart(new Date())
  const winStart = new Date(today.getTime() - 3 * DAY)
  const winEnd = new Date(today.getTime() + 25 * DAY)
  const span = winEnd - winStart
  const pos = (d) => Math.max(0, Math.min(100, ((d - winStart) / span) * 100))

  // 週刻度
  const ticks = []
  for (let t = new Date(winStart); t <= winEnd; t = new Date(t.getTime() + 7 * DAY)) ticks.push(new Date(t))

  const activeReqs = requests.filter(r => ACTIVE_STATUSES.includes(r.status))

  function barsFor(email) {
    return activeReqs
      .filter(r => (r.assignedDesigners || []).includes(email))
      .map(r => {
        const start = dayStart(toDate(r.reviewedAt) || toDate(r.createdAt) || today)
        let end = r.dueDate ? dayStart(new Date(r.dueDate)) : new Date(start.getTime() + 3 * DAY)
        if (end < start) end = start
        const overdue = r.dueDate && dayStart(new Date(r.dueDate)) < today
        return { r, left: pos(start), width: Math.max(pos(new Date(end.getTime() + DAY)) - pos(start), 2), overdue }
      })
      .sort((a, b) => (a.r.dueDate || '').localeCompare(b.r.dueDate || ''))
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">設計師儀表板</h1>
      <p className="text-sm text-gray-400 mb-5">監控每位設計師的需求 loading(僅計進行中:已發稿/設計中/確認中),點色塊看詳情</p>

      {/* 圖例 */}
      <div className="flex flex-wrap gap-4 mb-4 text-xs text-gray-500">
        {Object.entries(BAR_COLORS).map(([k, cls]) => (
          <span key={k} className="flex items-center gap-1.5"><span className={`w-3 h-3 rounded-sm ${cls}`} />{statusMeta(k).label}</span>
        ))}
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-500" />逾期</span>
        <span className="flex items-center gap-1.5"><span className="w-0.5 h-3 bg-red-400" />今天</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* 時間刻度 */}
        <div className="flex border-b border-gray-100 text-xs text-gray-400">
          <div className="w-44 shrink-0 px-4 py-2 font-medium">設計師</div>
          <div className="flex-1 relative h-8">
            {ticks.map(t => (
              <span key={t.toISOString()} className="absolute top-2" style={{ left: `${pos(t)}%` }}>{fmtMD(t)}</span>
            ))}
          </div>
        </div>

        {designers.map(d => {
          const bars = barsFor(d.email)
          const lm = loadingMeta(bars.length)
          return (
            <div key={d.email} className="flex border-b border-gray-50 last:border-0">
              <div className="w-44 shrink-0 px-4 py-3">
                <p className="text-sm font-medium text-gray-700">{d.displayName || d.email}</p>
                <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full ${lm.cls}`}>{lm.label}</span>
              </div>
              <div className="flex-1 relative py-2 pr-2 min-h-[52px]">
                {/* 今天線 */}
                <div className="absolute top-0 bottom-0 w-px bg-red-300 z-10" style={{ left: `${pos(today)}%` }} />
                {/* 週刻度虛線 */}
                {ticks.map(t => (
                  <div key={t.toISOString()} className="absolute top-0 bottom-0 w-px bg-gray-50" style={{ left: `${pos(t)}%` }} />
                ))}
                {bars.map((b, i) => (
                  <button key={b.r.id} onClick={() => setDetail(b.r)}
                    className={`absolute h-5 rounded text-[10px] text-white px-1.5 truncate text-left hover:opacity-80 transition-opacity ${
                      b.overdue ? 'bg-red-500' : BAR_COLORS[b.r.status] || 'bg-gray-400'
                    }`}
                    style={{ left: `${b.left}%`, width: `${b.width}%`, top: `${8 + i * 24}px` }}
                    title={`${b.r.projectName} · 交期 ${b.r.dueDate || '未定'}`}>
                    {b.r.urgent ? '🔥' : ''}{b.r.projectName}
                  </button>
                ))}
                {bars.length > 0 && <div style={{ height: `${bars.length * 24}px` }} />}
                {bars.length === 0 && <p className="text-xs text-gray-300 pt-2 pl-2">— 目前沒有進行中任務 —</p>}
              </div>
            </div>
          )
        })}
        {designers.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-10">尚無設計師,請先到使用者管理新增</p>
        )}
      </div>

      <RequestDetailModal r={detail} onClose={() => setDetail(null)} />
    </div>
  )
}
