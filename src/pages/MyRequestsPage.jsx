import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { statusMeta } from '../utils/requestConstants'
import { groupRequestsForList, sortByDueDate } from '../utils/requestActions'
import RequestDetailModal from '../components/RequestDetailModal'

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待審核' },
  { key: 'rejected', label: '已駁回' },
  { key: 'active', label: '進行中' },
  { key: 'completed', label: '已結案' },
]

// null = 預設排序(建立時間新到舊，已結案另外依結案時間排，見 groupRequestsForList)
const SORT_OPTIONS = [
  { key: null, label: '預設' },
  { key: 'asc', label: '交期：近到遠' },
  { key: 'desc', label: '交期：遠到近' },
]

export default function MyRequestsPage() {
  const { email } = useAuth()
  const navigate = useNavigate()
  const [requests, setRequests] = useState([])
  const [filter, setFilter] = useState('all')
  const [dueDateSort, setDueDateSort] = useState(null) // null | 'asc' | 'desc'
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
  // 已結案的另外分一組排在最下面，不要跟其他狀態混著依建立時間排序(見 groupRequestsForList
  // 的說明)——篩選成「只看已結案」或「只看其他單一狀態」時，其中一組必然是空的，這裡不用
  // 特別處理，反正空陣列就是不渲染那一段。
  const { active: activeDefault, completed: completedDefault } = groupRequestsForList(filtered)
  // 選了依交期排序時，兩組各自改用交期排序覆蓋掉預設排序；分組本身(已結案永遠在最下面)
  // 不受排序選項影響，只是「組內」怎麼排的差別。
  const active = dueDateSort ? sortByDueDate(activeDefault, dueDateSort) : activeDefault
  const completed = dueDateSort ? sortByDueDate(completedDefault, dueDateSort) : completedDefault

  // 彈窗顯示的是即時資料(讓狀態變更即時反映)
  const detailLive = detail ? requests.find(r => r.id === detail.id) || detail : null

  function RequestRow(r) {
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
          <p className="text-xs text-gray-500 mt-0.5">
            {r.region ? r.region + ' · ' : ''}{(r.docTypes || []).join('、') || ''} · 交期 {r.dueDate || '未指定'}
          </p>
        </div>
        {r.status === 'pending' && <span className="text-xs text-blue-400">可編輯</span>}
        <span className={`text-xs px-2 py-0.5 rounded-full ${meta.color}`}>{meta.label}</span>
      </button>
    )
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">我的需求</h1>
      <p className="text-sm text-gray-500 mb-5">追蹤你送出的設計需求進度,點擊查看完整內容;待審核時可編輯</p>

      <div className="flex gap-2 mb-3 flex-wrap">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`text-sm px-3 py-1.5 rounded-full transition-colors ${
              filter === f.key ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <span className="text-xs text-gray-500">排序</span>
        {SORT_OPTIONS.map(s => (
          <button key={s.label} onClick={() => setDueDateSort(s.key)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              dueDateSort === s.key ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {active.map(RequestRow)}

        {completed.length > 0 && (
          <div className="pt-3 mt-3 border-t border-gray-200">
            <p className="text-xs text-gray-500 font-medium mb-3">已結案（{completed.length}）</p>
            <div className="space-y-3">
              {completed.map(RequestRow)}
            </div>
          </div>
        )}

        {filtered.length === 0 && (
          <div className="text-center text-gray-500 text-sm py-12 bg-white rounded-xl border border-gray-100">
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
