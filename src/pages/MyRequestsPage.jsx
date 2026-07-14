import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { statusMeta } from '../utils/requestConstants'
import RequestDetailModal from '../components/RequestDetailModal'

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待審核' },
  { key: 'rejected', label: '已駁回' },
  { key: 'active', label: '進行中' },
  { key: 'completed', label: '已結案' },
]

export default function MyRequestsPage() {
  const { email } = useAuth()
  const navigate = useNavigate()
  const [requests, setRequests] = useState([])
  const [filter, setFilter] = useState('all')
  const [detail, setDetail] = useState(null)

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

  // 彈窗顯示的是即時資料(讓狀態變更即時反映)
  const detailLive = detail ? requests.find(r => r.id === detail.id) || detail : null

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">我的需求</h1>
      <p className="text-sm text-gray-400 mb-5">追蹤你送出的設計需求進度,點擊查看完整內容;待審核時可編輯</p>

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
          return (
            <button key={r.id} onClick={() => setDetail(r)}
              className="w-full flex items-center gap-3 px-5 py-4 text-left bg-white rounded-xl border border-gray-200 shadow-sm hover:bg-gray-50 transition-colors">
              <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">
                  {r.urgent && <span className="text-red-500 mr-1">🔥</span>}
                  {r.projectName || r.title}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {r.region ? r.region + ' · ' : ''}{(r.docTypes || []).join('、') || ''} · 交期 {r.dueDate || '未指定'}
                </p>
              </div>
              {r.status === 'pending' && <span className="text-xs text-blue-400">可編輯</span>}
              <span className={`text-xs px-2 py-0.5 rounded-full ${meta.color}`}>{meta.label}</span>
            </button>
          )
        })}
        {filtered.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-12 bg-white rounded-xl border border-gray-100">
            {requests.length === 0 ? '你還沒有送出任何需求' : '此篩選沒有符合的需求'}
          </div>
        )}
      </div>

      <RequestDetailModal r={detailLive} onClose={() => setDetail(null)}
        actions={detailLive?.status === 'pending' ? (
          <button onClick={() => navigate(`/request/edit/${detailLive.id}`)}
            className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700">
            ✎ 編輯需求
          </button>
        ) : null} />
    </div>
  )
}
