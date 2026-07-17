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
  const [drafts, setDrafts] = useState({})
  const [busy, setBusy] = useState(null)
  const [editing, setEditing] = useState(null) // 非待審核時的編輯中 id

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

  // 有效草稿：未編輯的欄位回退到需求現值
  function eff(r) {
    const d = drafts[r.id] || {}
    return {
      designers: d.designers ?? (r.assignedDesigners || []),
      note: d.note ?? (r.reviewNote || ''),
      comment: d.comment ?? (r.comment || ''),
      dueDate: d.dueDate ?? (r.dueDate || ''),
      rejecting: d.rejecting || false,
      reason: d.reason || '',
      err: d.err || '',
    }
  }
  const setDraft = (id, patch) => setDrafts(d => ({ ...d, [id]: { ...d[id], ...patch } }))
  // email → 顯示名稱(存進需求,讓各頁顯示名字而非帳號)
  const namesOf = (emails) => emails.map(e => designers.find(x => x.email === e)?.displayName || e)
  function toggleDesigner(r, dEmail) {
    const cur = eff(r).designers
    setDraft(r.id, { designers: cur.includes(dEmail) ? cur.filter(x => x !== dEmail) : [...cur, dEmail], err: '' })
  }

  async function approve(r) {
    const d = eff(r)
    if (d.designers.length === 0) { setDraft(r.id, { err: '請至少選一位設計師' }); return }
    setBusy(r.id)
    try {
      await updateDoc(doc(db, 'requests', r.id), {
        status: 'assigned',
        assignedDesigners: d.designers,
        assignedDesignersNames: namesOf(d.designers),
        reviewedBy: email,
        reviewedAt: serverTimestamp(),
        reviewNote: d.note.trim(),
        comment: d.comment.trim(),
        dueDate: d.dueDate,
      })
      setDraft(r.id, { err: '' })
    } catch (e) { setDraft(r.id, { err: e.code || e.message }) }
    setBusy(null)
  }

  async function reject(r) {
    const d = eff(r)
    if (!d.reason.trim()) { setDraft(r.id, { err: '請填寫駁回原因' }); return }
    setBusy(r.id)
    try {
      await updateDoc(doc(db, 'requests', r.id), {
        status: 'rejected', reviewedBy: email, reviewedAt: serverTimestamp(), rejectReason: d.reason.trim(),
      })
    } catch (e) { setDraft(r.id, { err: e.code || e.message }) }
    setBusy(null)
  }

  // 已處理需求:主管變更設計師 / 交期 / 注意事項
  async function saveChanges(r) {
    const d = eff(r)
    setBusy(r.id)
    try {
      await updateDoc(doc(db, 'requests', r.id), {
        assignedDesigners: d.designers,
        assignedDesignersNames: namesOf(d.designers),
        dueDate: d.dueDate,
        comment: d.comment.trim(),
        reviewNote: d.note.trim(),
      })
      setEditing(null)
    } catch (e) { setDraft(r.id, { err: e.code || e.message }) }
    setBusy(null)
  }

  const pending = requests.filter(r => r.status === 'pending')
  const shown = tab === 'pending' ? pending : requests

  function DesignerPicker({ r }) {
    const d = eff(r)
    return (
      <div className="flex flex-wrap gap-1.5">
        {designers.map(dz => {
          const on = d.designers.includes(dz.email)
          return (
            <button type="button" key={dz.email} onClick={() => toggleDesigner(r, dz.email)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                on ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}>
              {on ? '✓ ' : ''}{dz.displayName || dz.email}
            </button>
          )
        })}
        {designers.length === 0 && <span className="text-xs text-gray-400">尚無設計師,請先到使用者管理新增</span>}
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">需求審核</h1>
      <p className="text-sm text-gray-400 mb-5">核准並指派設計師(可多位)、填寫注意事項、可變更交期,或駁回</p>

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
          const d = eff(r)
          const isEditing = editing === r.id
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
                  {r.attachments?.length > 0 && <div className="mt-2"><Attachments items={r.attachments} requestId={r.id} /></div>}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${meta.color}`}>{meta.label}</span>
              </div>

              {/* 待審核:核准/駁回 */}
              {r.status === 'pending' && (
                <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                  {!d.rejecting ? (
                    <>
                      <div>
                        <p className="text-xs font-medium text-gray-600 mb-1.5">指派設計師(可多位)</p>
                        <DesignerPicker r={r} />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs font-medium text-gray-600 mb-1">交期</p>
                          <input type="date" value={d.dueDate} onChange={e => setDraft(r.id, { dueDate: e.target.value })}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                        </div>
                        <div>
                          <p className="text-xs font-medium text-gray-600 mb-1">審核備註(選填)</p>
                          <input type="text" value={d.note} onChange={e => setDraft(r.id, { note: e.target.value })}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="給團隊的審核說明" />
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-600 mb-1">注意事項 Comment(planner / 設計師看得到)</p>
                        <textarea rows={2} value={d.comment} onChange={e => setDraft(r.id, { comment: e.target.value })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="回給 planner 或設計師的注意事項" />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => approve(r)} disabled={busy === r.id}
                          className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">核准並指派</button>
                        <button onClick={() => setDraft(r.id, { rejecting: true, err: '' })}
                          className="text-sm px-3 py-2 rounded-lg text-red-500 hover:bg-red-50">駁回</button>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <input type="text" placeholder="駁回原因" value={d.reason}
                        onChange={e => setDraft(r.id, { reason: e.target.value })}
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]" />
                      <button onClick={() => reject(r)} disabled={busy === r.id}
                        className="bg-red-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50">確認駁回</button>
                      <button onClick={() => setDraft(r.id, { rejecting: false, err: '' })}
                        className="text-sm px-3 py-2 rounded-lg text-gray-500 hover:bg-gray-100">取消</button>
                    </div>
                  )}
                  {d.err && <p className="text-xs text-red-500">{d.err}</p>}
                </div>
              )}

              {/* 已處理:顯示資訊 + 可編輯(設計師/交期/注意事項) */}
              {r.status !== 'pending' && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  {!isEditing ? (
                    <div className="text-xs text-gray-500 space-y-1">
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {(r.assignedDesigners?.length > 0) && <span>指派：<b className="text-gray-700">{r.assignedDesigners.join('、')}</b></span>}
                        <span>交期：<b className="text-gray-700">{r.dueDate || '未指定'}</b></span>
                        {r.completedAt && <span>結案：{fmt(r.completedAt)}</span>}
                      </div>
                      {r.reviewNote && <div>審核備註：{r.reviewNote}</div>}
                      {r.comment && <div className="text-amber-700 bg-amber-50 rounded px-2 py-1 inline-block">📌 注意事項：{r.comment}</div>}
                      {r.rejectReason && <div className="text-red-500">駁回原因：{r.rejectReason}</div>}
                      {r.status !== 'rejected' && (
                        <button onClick={() => { setEditing(r.id); setDraft(r.id, {}) }}
                          className="text-blue-500 hover:underline mt-1">✎ 編輯指派 / 交期 / 注意事項</button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-medium text-gray-600 mb-1.5">指派設計師(可多位)</p>
                        <DesignerPicker r={r} />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs font-medium text-gray-600 mb-1">交期</p>
                          <input type="date" value={d.dueDate} onChange={e => setDraft(r.id, { dueDate: e.target.value })}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-600 mb-1">注意事項 Comment</p>
                        <textarea rows={2} value={d.comment} onChange={e => setDraft(r.id, { comment: e.target.value })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => saveChanges(r)} disabled={busy === r.id}
                          className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">儲存變更</button>
                        <button onClick={() => { setEditing(null); setDrafts(p => ({ ...p, [r.id]: {} })) }}
                          className="text-sm px-3 py-2 rounded-lg text-gray-500 hover:bg-gray-100">取消</button>
                      </div>
                      {d.err && <p className="text-xs text-red-500">{d.err}</p>}
                    </div>
                  )}
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
