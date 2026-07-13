import { useEffect, useState } from 'react'
import { collection, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { statusMeta } from '../utils/requestConstants'
import Attachments from '../components/Attachments'

function fmt(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function ReviewPage() {
  const { email } = useAuth()
  const [requests, setRequests] = useState([])
  const [designers, setDesigners] = useState([])
  const [tab, setTab] = useState('pending')
  const [drafts, setDrafts] = useState({}) // { [id]: { designer, note, rejecting, reason } }
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'requests'), snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      setRequests(rows)
    })
    const u2 = onSnapshot(collection(db, 'users'), snap =>
      setDesigners(snap.docs.map(d => d.data()).filter(u => u.role === 'designer' && u.active !== false)))
    return () => { u1(); u2() }
  }, [])

  const setDraft = (id, patch) => setDrafts(d => ({ ...d, [id]: { ...d[id], ...patch } }))

  async function approve(r) {
    const d = drafts[r.id] || {}
    if (!d.designer) { setDraft(r.id, { err: '請選擇設計師' }); return }
    setBusy(r.id)
    try {
      await updateDoc(doc(db, 'requests', r.id), {
        status: 'assigned',
        assignedDesigner: d.designer,
        reviewedBy: email,
        reviewedAt: serverTimestamp(),
        reviewNote: (d.note || '').trim(),
      })
      setDraft(r.id, { err: '' })
    } catch (e) { setDraft(r.id, { err: e.code || e.message }) }
    setBusy(null)
  }

  async function reject(r) {
    const d = drafts[r.id] || {}
    if (!(d.reason || '').trim()) { setDraft(r.id, { err: '請填寫駁回原因' }); return }
    setBusy(r.id)
    try {
      await updateDoc(doc(db, 'requests', r.id), {
        status: 'rejected',
        reviewedBy: email,
        reviewedAt: serverTimestamp(),
        rejectReason: d.reason.trim(),
      })
    } catch (e) { setDraft(r.id, { err: e.code || e.message }) }
    setBusy(null)
  }

  const pending = requests.filter(r => r.status === 'pending')
  const shown = tab === 'pending' ? pending : requests

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">需求審核</h1>
      <p className="text-sm text-gray-400 mb-5">核准並指派設計師,或駁回並填寫原因</p>

      <div className="flex gap-2 mb-5">
        <button onClick={() => setTab('pending')}
          className={`text-sm px-4 py-1.5 rounded-full ${tab === 'pending' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
          待審核 {pending.length > 0 && <span className="ml-1">({pending.length})</span>}
        </button>
        <button onClick={() => setTab('all')}
          className={`text-sm px-4 py-1.5 rounded-full ${tab === 'all' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
          全部總覽 ({requests.length})
        </button>
      </div>

      <div className="space-y-3">
        {shown.map(r => {
          const meta = statusMeta(r.status)
          const d = drafts[r.id] || {}
          return (
            <div key={r.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-800">
                    {r.urgent && <span className="text-red-500 mr-1">🔥</span>}
                    {r.projectName || r.title}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {r.region ? r.region + ' · ' : ''}{(r.docTypes || []).join('、')} · 交期 {r.dueDate || '未指定'}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">提交：{r.submittedByName || r.submittedBy} · {fmt(r.createdAt)}</p>
                  {r.description && <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap bg-gray-50 rounded-lg p-2">{r.description}</p>}
                  {r.attachments?.length > 0 && <div className="mt-2"><Attachments items={r.attachments} /></div>}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${meta.color}`}>{meta.label}</span>
              </div>

              {/* 審核區（僅待審核） */}
              {r.status === 'pending' && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  {!d.rejecting ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <select value={d.designer || ''} onChange={e => setDraft(r.id, { designer: e.target.value, err: '' })}
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
                        <option value="">選擇設計師…</option>
                        {designers.map(dz => <option key={dz.email} value={dz.email}>{dz.displayName || dz.email}</option>)}
                      </select>
                      <input type="text" placeholder="審核備註（選填）" value={d.note || ''}
                        onChange={e => setDraft(r.id, { note: e.target.value })}
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-[160px]" />
                      <button onClick={() => approve(r)} disabled={busy === r.id}
                        className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                        核准並指派
                      </button>
                      <button onClick={() => setDraft(r.id, { rejecting: true, err: '' })}
                        className="text-sm px-3 py-2 rounded-lg text-red-500 hover:bg-red-50">駁回</button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <input type="text" placeholder="駁回原因" value={d.reason || ''}
                        onChange={e => setDraft(r.id, { reason: e.target.value })}
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]" />
                      <button onClick={() => reject(r)} disabled={busy === r.id}
                        className="bg-red-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50">
                        確認駁回
                      </button>
                      <button onClick={() => setDraft(r.id, { rejecting: false, err: '' })}
                        className="text-sm px-3 py-2 rounded-lg text-gray-500 hover:bg-gray-100">取消</button>
                    </div>
                  )}
                  {d.err && <p className="text-xs text-red-500 mt-2">{d.err}</p>}
                </div>
              )}

              {/* 已處理資訊 */}
              {r.status !== 'pending' && (
                <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
                  {r.assignedDesigner && <span>指派：<b className="text-gray-700">{r.assignedDesigner}</b></span>}
                  {r.reviewNote && <span>備註：{r.reviewNote}</span>}
                  {r.rejectReason && <span className="text-red-500">駁回原因：{r.rejectReason}</span>}
                  {r.completedAt && <span>結案：{fmt(r.completedAt)}</span>}
                </div>
              )}
            </div>
          )
        })}
        {shown.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-12 bg-white rounded-xl border border-gray-100">
            {tab === 'pending' ? '目前沒有待審核的需求 🎉' : '尚無需求'}
          </div>
        )}
      </div>
    </div>
  )
}
