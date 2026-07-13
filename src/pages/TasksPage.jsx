import { useEffect, useState } from 'react'
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { statusMeta, NEXT_STATUS, NEXT_STATUS_LABEL, STATUS_TIMESTAMP, ACTIVE_STATUSES } from '../utils/requestConstants'
import Attachments from '../components/Attachments'

function fmt(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function TasksPage() {
  const { email } = useAuth()
  const [tasks, setTasks] = useState([])
  const [tab, setTab] = useState('active')
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    if (!email) return
    const q = query(collection(db, 'requests'), where('assignedDesigner', '==', email))
    const unsub = onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      rows.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
      setTasks(rows)
    })
    return unsub
  }, [email])

  async function advance(t) {
    const next = NEXT_STATUS[t.status]
    if (!next) return
    setBusy(t.id)
    try {
      const patch = { status: next }
      const tsField = STATUS_TIMESTAMP[next]
      if (tsField) patch[tsField] = serverTimestamp()
      await updateDoc(doc(db, 'requests', t.id), patch)
    } catch (e) { console.error(e); alert('更新失敗：' + (e.code || e.message)) }
    setBusy(null)
  }

  const active = tasks.filter(t => ACTIVE_STATUSES.includes(t.status))
  const history = tasks.filter(t => t.status === 'completed')
  const shown = tab === 'active' ? active : history

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">我的任務</h1>
      <p className="text-sm text-gray-400 mb-5">指派給你的設計任務,依交期排序</p>

      <div className="flex gap-2 mb-5">
        <button onClick={() => setTab('active')}
          className={`text-sm px-4 py-1.5 rounded-full ${tab === 'active' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
          進行中 ({active.length})
        </button>
        <button onClick={() => setTab('history')}
          className={`text-sm px-4 py-1.5 rounded-full ${tab === 'history' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
          歷史紀錄 ({history.length})
        </button>
      </div>

      <div className="space-y-3">
        {shown.map(t => {
          const meta = statusMeta(t.status)
          const next = NEXT_STATUS[t.status]
          return (
            <div key={t.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-800">
                    {t.urgent && <span className="text-red-500 mr-1">🔥</span>}
                    {t.projectName || t.title}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {t.region ? t.region + ' · ' : ''}{(t.docTypes || []).join('、')} · 交期 {t.dueDate || '未指定'}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">來自：{t.submittedByName || t.submittedBy}</p>
                  {t.description && <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap bg-gray-50 rounded-lg p-2">{t.description}</p>}
                  {t.reviewNote && <p className="text-xs text-gray-500 mt-1">主管備註：{t.reviewNote}</p>}
                  {t.attachments?.length > 0 && <div className="mt-2"><Attachments items={t.attachments} /></div>}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${meta.color}`}>{meta.label}</span>
              </div>

              {next && (
                <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-xs text-gray-400">
                    {t.startedAt && `開始 ${fmt(t.startedAt)}`}
                    {t.reviewingAt && ` · 送確認 ${fmt(t.reviewingAt)}`}
                  </span>
                  <button onClick={() => advance(t)} disabled={busy === t.id}
                    className={`text-sm px-4 py-2 rounded-lg text-white disabled:opacity-50 ${
                      next === 'completed' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'
                    }`}>
                    {next === 'completed' ? '✓ ' : ''}{NEXT_STATUS_LABEL[t.status]}
                  </button>
                </div>
              )}
              {t.status === 'completed' && (
                <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-emerald-600">
                  ✓ 已於 {fmt(t.completedAt)} 結案
                </div>
              )}
            </div>
          )
        })}
        {shown.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-12 bg-white rounded-xl border border-gray-100">
            {tab === 'active' ? '目前沒有進行中的任務' : '尚無已結案的任務'}
          </div>
        )}
      </div>
    </div>
  )
}
