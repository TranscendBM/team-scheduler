import { useEffect, useState } from 'react'
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { statusMeta, STATUS_TIMESTAMP } from '../utils/requestConstants'

function fmt(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' })
}
const shortEmail = (e) => (e || '—').split('@')[0]

// 設計師可切換的狀態
const DESIGNER_STATUSES = ['assigned', 'in_progress', 'reviewing', 'completed']

export default function RequestsTablePage() {
  const { role, email, regions } = useAuth()
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(null)
  const [noRegion, setNoRegion] = useState(false)

  useEffect(() => {
    let q
    if (role === 'manager') {
      q = collection(db, 'requests')
    } else if (role === 'designer') {
      q = query(collection(db, 'requests'), where('assignedDesigner', '==', email))
    } else if (role === 'planner') {
      if (!regions || regions.length === 0) { setNoRegion(true); setRows([]); return }
      q = query(collection(db, 'requests'), where('region', 'in', regions.slice(0, 30)))
    } else { return }
    const unsub = onSnapshot(q, snap => setRows(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return unsub
  }, [role, email, regions])

  async function setStatus(r, next) {
    setBusy(r.id)
    try {
      const patch = { status: next }
      const tsField = STATUS_TIMESTAMP[next]
      if (tsField) patch[tsField] = serverTimestamp()
      await updateDoc(doc(db, 'requests', r.id), patch)
    } catch (e) { alert('更新失敗：' + (e.code || e.message)) }
    setBusy(null)
  }
  const plannerClose = (r) => setStatus(r, 'completed')

  const sortFn = (a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')
  const active = rows.filter(r => r.status !== 'completed').sort(sortFn)
  const done = rows.filter(r => r.status === 'completed').sort(sortFn)

  function ActionCell({ r }) {
    if (role === 'designer' && r.assignedDesigner === email) {
      return (
        <select value={r.status} disabled={busy === r.id}
          onChange={e => setStatus(r, e.target.value)}
          className="text-xs border border-gray-300 rounded-lg px-2 py-1">
          {DESIGNER_STATUSES.map(s => <option key={s} value={s}>{statusMeta(s).label}</option>)}
        </select>
      )
    }
    if (role === 'planner' && r.status !== 'completed' && r.status !== 'rejected') {
      return (
        <button onClick={() => plannerClose(r)} disabled={busy === r.id}
          className="text-xs bg-emerald-600 text-white px-3 py-1 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
          ✓ 結案
        </button>
      )
    }
    return <span className="text-xs text-gray-300">—</span>
  }

  function Row({ r, faded }) {
    const meta = statusMeta(r.status)
    return (
      <tr className={`border-t border-gray-100 ${faded ? 'text-gray-400' : 'hover:bg-gray-50'}`}>
        <td className="px-3 py-2.5">
          <div className={`text-sm ${faded ? '' : 'text-gray-800 font-medium'}`}>
            {r.urgent && !faded && <span className="text-red-500 mr-1">🔥</span>}
            {r.projectName || r.title}
          </div>
          {r.attachments?.length > 0 && (
            <div className="mt-0.5">
              {r.attachments.map(a => (
                <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline mr-2">📎{a.name}</a>
              ))}
            </div>
          )}
        </td>
        <td className="px-3 py-2.5 text-xs">{r.region}</td>
        <td className="px-3 py-2.5 text-xs">{(r.docTypes || []).join('、')}</td>
        <td className="px-3 py-2.5 text-xs whitespace-nowrap">{r.dueDate || '—'}</td>
        <td className="px-3 py-2.5 text-xs">{shortEmail(r.assignedDesigner)}</td>
        <td className="px-3 py-2.5 text-xs">{shortEmail(r.submittedBy)}</td>
        <td className="px-3 py-2.5">
          <span className={`text-xs px-2 py-0.5 rounded-full ${faded ? 'bg-gray-100 text-gray-400' : meta.color}`}>{meta.label}</span>
        </td>
        <td className="px-3 py-2.5 text-right"><ActionCell r={r} /></td>
      </tr>
    )
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">需求總表</h1>
      <p className="text-sm text-gray-400 mb-5">
        {role === 'manager' && '全部需求一覽'}
        {role === 'designer' && '指派給你的需求,可調整進度'}
        {role === 'planner' && `你負責區域(${(regions || []).join('、') || '未設定'})的需求,可勾選結案`}
      </p>

      {noRegion ? (
        <div className="text-center text-amber-600 text-sm py-12 bg-amber-50 rounded-xl border border-amber-100">
          你尚未被指派負責區域,請聯絡設計主管在「使用者管理」設定。
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left px-3 py-2.5 font-medium">專案名稱</th>
                <th className="text-left px-3 py-2.5 font-medium">地區</th>
                <th className="text-left px-3 py-2.5 font-medium">稿件類型</th>
                <th className="text-left px-3 py-2.5 font-medium">交期</th>
                <th className="text-left px-3 py-2.5 font-medium">設計師</th>
                <th className="text-left px-3 py-2.5 font-medium">提交人</th>
                <th className="text-left px-3 py-2.5 font-medium">狀態</th>
                <th className="text-right px-3 py-2.5 font-medium">動作</th>
              </tr>
            </thead>
            <tbody>
              {active.map(r => <Row key={r.id} r={r} />)}
              {done.length > 0 && (
                <tr><td colSpan={8} className="px-3 pt-4 pb-1 text-xs text-gray-400 bg-gray-50/50">已結案</td></tr>
              )}
              {done.map(r => <Row key={r.id} r={r} faded />)}
              {active.length === 0 && done.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400 text-sm">目前沒有需求</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
