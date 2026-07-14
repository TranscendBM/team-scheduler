import { useEffect, useState } from 'react'
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { STATUS, statusMeta, STATUS_TIMESTAMP } from '../utils/requestConstants'
import RequestDetailModal from '../components/RequestDetailModal'
import Attachments from '../components/Attachments'

const shortEmail = (e) => (e || '—').split('@')[0]
const designerNames = (r) =>
  (r.assignedDesignersNames?.length ? r.assignedDesignersNames : (r.assignedDesigners || []).map(shortEmail)).join('、') || '—'
const submitterName = (r) => r.submittedByName || shortEmail(r.submittedBy)

// 設計師可切換的狀態
const DESIGNER_STATUSES = ['assigned', 'in_progress', 'reviewing', 'completed']

const SORTS = [
  { key: 'due-asc', label: '交期 舊→新' },
  { key: 'due-desc', label: '交期 新→舊' },
  { key: 'created-desc', label: '提交 新→舊' },
  { key: 'created-asc', label: '提交 舊→新' },
]

export default function RequestsTablePage() {
  const { role, email, regions } = useAuth()
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(null)
  const [noRegion, setNoRegion] = useState(false)
  const [detail, setDetail] = useState(null)
  const [fDesigner, setFDesigner] = useState('all')
  const [fStatus, setFStatus] = useState('all')
  const [sort, setSort] = useState('due-asc')

  useEffect(() => {
    let q
    if (role === 'manager') {
      q = collection(db, 'requests')
    } else if (role === 'designer') {
      q = query(collection(db, 'requests'), where('assignedDesigners', 'array-contains', email))
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

  // 篩選
  const allDesignerOpts = [...new Map(rows.flatMap(r =>
    (r.assignedDesigners || []).map((e, i) => [e, r.assignedDesignersNames?.[i] || shortEmail(e)])
  )).entries()].sort((a, b) => a[1].localeCompare(b[1]))

  const filtered = rows.filter(r =>
    (fDesigner === 'all' || (r.assignedDesigners || []).includes(fDesigner)) &&
    (fStatus === 'all' || r.status === fStatus)
  )

  // 排序
  const sortFn = (a, b) => {
    switch (sort) {
      case 'due-desc': return (b.dueDate || '').localeCompare(a.dueDate || '')
      case 'created-desc': return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
      case 'created-asc': return (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)
      default: return (a.dueDate || '').localeCompare(b.dueDate || '')
    }
  }
  const active = filtered.filter(r => r.status !== 'completed').sort(sortFn)
  const done = filtered.filter(r => r.status === 'completed').sort(sortFn)

  function ActionCell({ r }) {
    if (role === 'designer' && (r.assignedDesigners || []).includes(email)) {
      return (
        <select value={r.status} disabled={busy === r.id}
          onClick={e => e.stopPropagation()}
          onChange={e => setStatus(r, e.target.value)}
          className="text-xs border border-gray-300 rounded-lg px-2 py-1">
          {DESIGNER_STATUSES.map(s => <option key={s} value={s}>{statusMeta(s).label}</option>)}
        </select>
      )
    }
    if (role === 'planner' && r.status !== 'completed' && r.status !== 'rejected') {
      return (
        <button onClick={e => { e.stopPropagation(); plannerClose(r) }} disabled={busy === r.id}
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
      <tr onClick={() => setDetail(r)}
        className={`border-t border-gray-100 cursor-pointer ${faded ? 'text-gray-400 hover:bg-gray-50/50' : 'hover:bg-gray-50'}`}>
        <td className="px-3 py-2.5">
          <div className={`text-sm ${faded ? '' : 'text-gray-800 font-medium'}`}>
            {r.urgent && !faded && <span className="text-red-500 mr-1">🔥</span>}
            {r.projectName || r.title}
          </div>
          {r.attachments?.length > 0 && (
            <div className="mt-1" onClick={e => e.stopPropagation()}>
              <Attachments items={r.attachments} />
            </div>
          )}
        </td>
        <td className="px-3 py-2.5 text-xs">{r.region}</td>
        <td className="px-3 py-2.5 text-xs whitespace-nowrap">{r.dueDate || '—'}</td>
        <td className="px-3 py-2.5 text-xs">{designerNames(r)}</td>
        <td className="px-3 py-2.5 text-xs">{submitterName(r)}</td>
        <td className="px-3 py-2.5">
          <span className={`text-xs px-2 py-0.5 rounded-full ${faded ? 'bg-gray-100 text-gray-400' : meta.color}`}>{meta.label}</span>
        </td>
        <td className="px-3 py-2.5 text-right"><ActionCell r={r} /></td>
      </tr>
    )
  }

  function Table({ data, faded, empty }) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-3 py-2.5 font-medium">專案名稱</th>
              <th className="text-left px-3 py-2.5 font-medium">地區</th>
              <th className="text-left px-3 py-2.5 font-medium">交期</th>
              <th className="text-left px-3 py-2.5 font-medium">設計師</th>
              <th className="text-left px-3 py-2.5 font-medium">提交人</th>
              <th className="text-left px-3 py-2.5 font-medium">狀態</th>
              <th className="text-right px-3 py-2.5 font-medium">動作</th>
            </tr>
          </thead>
          <tbody>
            {data.map(r => <Row key={r.id} r={r} faded={faded} />)}
            {data.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400 text-sm">{empty}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">需求總表</h1>
      <p className="text-sm text-gray-400 mb-5">
        {role === 'manager' && '全部需求一覽,點擊任一列查看完整內容'}
        {role === 'designer' && '指派給你的需求,可調整進度'}
        {role === 'planner' && `你負責區域(${(regions || []).join('、') || '未設定'})的需求,可勾選結案`}
      </p>

      {/* 篩選 + 排序 */}
      {!noRegion && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <select value={fDesigner} onChange={e => setFDesigner(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white">
            <option value="all">全部設計師</option>
            {allDesignerOpts.map(([e, name]) => <option key={e} value={e}>{name}</option>)}
          </select>
          <select value={fStatus} onChange={e => setFStatus(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white">
            <option value="all">全部狀態</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={sort} onChange={e => setSort(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white">
            {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          {(fDesigner !== 'all' || fStatus !== 'all') && (
            <button onClick={() => { setFDesigner('all'); setFStatus('all') }}
              className="text-xs text-gray-400 hover:text-gray-600">✕ 清除篩選</button>
          )}
        </div>
      )}

      {noRegion ? (
        <div className="text-center text-amber-600 text-sm py-12 bg-amber-50 rounded-xl border border-amber-100">
          你尚未被指派負責區域,請聯絡主管在「使用者管理」設定。
        </div>
      ) : (
        <>
          <Table data={active} empty="目前沒有進行中的需求" />

          {done.length > 0 && (
            <>
              <h2 className="text-sm font-medium text-gray-400 mt-8 mb-3">已結案（{done.length}）</h2>
              <Table data={done} faded empty="" />
            </>
          )}
        </>
      )}

      <RequestDetailModal r={detail ? rows.find(x => x.id === detail.id) || detail : null} onClose={() => setDetail(null)} />
    </div>
  )
}
