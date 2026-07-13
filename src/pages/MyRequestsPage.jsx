import { useEffect, useState } from 'react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { STATUS, statusMeta } from '../utils/requestConstants'

function fmt(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待審核' },
  { key: 'rejected', label: '已駁回' },
  { key: 'active', label: '進行中' },
  { key: 'completed', label: '已結案' },
]

export default function MyRequestsPage() {
  const { email } = useAuth()
  const [requests, setRequests] = useState([])
  const [filter, setFilter] = useState('all')
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    if (!email) return
    const q = query(collection(db, 'requests'), where('submittedBy', '==', email))
    const unsub = onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      setRequests(rows)
    })
    return unsub
  }, [email])

  const filtered = requests.filter(r => {
    if (filter === 'all') return true
    if (filter === 'active') return ['assigned', 'in_progress', 'reviewing'].includes(r.status)
    return r.status === filter
  })

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">我的需求</h1>
      <p className="text-sm text-gray-400 mb-5">追蹤你送出的設計需求進度（唯讀）</p>

      <div className="flex gap-2 mb-5 flex-wrap">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`text-sm px-3 py-1.5 rounded-full transition-colors ${
              filter === f.key ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map(r => {
          const meta = statusMeta(r.status)
          const open = expanded === r.id
          return (
            <div key={r.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <button onClick={() => setExpanded(open ? null : r.id)}
                className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50">
                <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {r.urgent && <span className="text-red-500 mr-1">🔥</span>}
                    {r.projectName || r.title}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {r.region ? r.region + ' · ' : ''}{(r.docTypes || []).join('、') || r.type} · 交期 {r.dueDate || '未指定'}
                  </p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${meta.color}`}>{meta.label}</span>
              </button>

              {open && (
                <div className="px-5 pb-4 pt-1 border-t border-gray-100 text-sm space-y-2">
                  {r.description && <p className="text-gray-600 whitespace-pre-wrap">{r.description}</p>}
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-gray-500 mt-2">
                    <div><dt className="inline text-gray-400">送出時間：</dt><dd className="inline text-gray-600">{fmt(r.createdAt)}</dd></div>
                    <div><dt className="inline text-gray-400">指派設計師：</dt><dd className="inline text-gray-600">{r.assignedDesigner || '—'}</dd></div>
                    {r.reviewNote && <div className="col-span-2"><dt className="inline text-gray-400">審核備註：</dt><dd className="inline text-gray-600">{r.reviewNote}</dd></div>}
                    {r.status === 'rejected' && r.rejectReason && <div className="col-span-2"><dt className="inline text-red-400">駁回原因：</dt><dd className="inline text-red-600">{r.rejectReason}</dd></div>}
                    {r.startedAt && <div><dt className="inline text-gray-400">開始設計：</dt><dd className="inline text-gray-600">{fmt(r.startedAt)}</dd></div>}
                    {r.reviewingAt && <div><dt className="inline text-gray-400">送出確認：</dt><dd className="inline text-gray-600">{fmt(r.reviewingAt)}</dd></div>}
                    {r.completedAt && <div><dt className="inline text-gray-400">結案時間：</dt><dd className="inline text-gray-600">{fmt(r.completedAt)}</dd></div>}
                  </dl>
                </div>
              )}
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-12 bg-white rounded-xl border border-gray-100">
            {requests.length === 0 ? '你還沒有送出任何需求' : '此篩選沒有符合的需求'}
          </div>
        )}
      </div>
    </div>
  )
}
