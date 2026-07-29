import { useEffect, useState } from 'react'
import { collection, query, where, onSnapshot, doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { useNotifications } from '../contexts/NotificationsContext'
import { STATUS, statusMeta, STATUS_TIMESTAMP } from '../utils/requestConstants'
import RequestDetailModal from '../components/RequestDetailModal'
import Attachments from '../components/Attachments'

const shortEmail = (e) => (e || '—').split('@')[0]
const submitterName = (r) => r.submittedByName || shortEmail(r.submittedBy)

// 設計師可切換的狀態
const DESIGNER_STATUSES = ['assigned', 'in_progress', 'reviewing', 'completed']

const SORTS = [
  { key: 'due-asc', label: '交期 舊→新' },
  { key: 'due-desc', label: '交期 新→舊' },
  { key: 'created-desc', label: '提交 新→舊' },
  { key: 'created-asc', label: '提交 舊→新' },
]

// 專案列表依設計師分組的固定順序，不在清單內的設計師依字母序排在後面，未指派排最後
const DESIGNER_ORDER = ['Sherry', 'Tingwei', 'Yuna', 'Abby']
function designerGroupKey(r) {
  return r.assignedDesignersNames?.[0] || (r.assignedDesigners?.[0] ? shortEmail(r.assignedDesigners[0]) : '') || '未指派'
}
function designerRank(name) {
  const i = DESIGNER_ORDER.indexOf(name)
  if (i !== -1) return i
  return name === '未指派' ? 999 : 500
}
function groupByDesigner(list) {
  const groups = new Map()
  for (const r of list) {
    const key = designerGroupKey(r)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  return [...groups.entries()].sort((a, b) => {
    const ra = designerRank(a[0]), rb = designerRank(b[0])
    return ra !== rb ? ra - rb : a[0].localeCompare(b[0])
  })
}

export default function RequestsTablePage() {
  const { role, email, regions } = useAuth()
  const { newIds, markSeen } = useNotifications()
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(null)
  const [noRegion, setNoRegion] = useState(false)
  const [detail, setDetail] = useState(null)
  const [fDesigners, setFDesigners] = useState([])   // 空陣列 = 不篩選
  const [fStatuses, setFStatuses] = useState([])
  const [fRegions, setFRegions] = useState([])
  const [sort, setSort] = useState('due-asc')
  const [modalDeleteConfirm, setModalDeleteConfirm] = useState(false)

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

  async function handleDelete(r) {
    setBusy(r.id)
    try {
      await deleteDoc(doc(db, 'requests', r.id))
      setModalDeleteConfirm(false)
      setDetail(null)
    } catch (e) { alert('刪除失敗：' + (e.code || e.message)) }
    setBusy(null)
  }

  function openDetail(r) {
    setDetail(r)
    setModalDeleteConfirm(false)
    markSeen(r.id)
  }

  // 篩選
  const allDesignerOpts = [...new Map(rows.flatMap(r =>
    (r.assignedDesigners || []).map((e, i) => [e, r.assignedDesignersNames?.[i] || shortEmail(e)])
  )).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const allRegionOpts = [...new Set(rows.map(r => r.region).filter(Boolean))].sort()

  function toggleFilter(setFn, value) {
    setFn(cur => cur.includes(value) ? cur.filter(v => v !== value) : [...cur, value])
  }

  const filtered = rows.filter(r =>
    (fDesigners.length === 0 || (r.assignedDesigners || []).some(d => fDesigners.includes(d))) &&
    (fStatuses.length === 0 || fStatuses.includes(r.status)) &&
    (fRegions.length === 0 || fRegions.includes(r.region))
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

  // 主管沒有列表內動作(刪除已移到詳情視窗)，動作欄整欄隱藏；設計師/Planner 仍有狀態切換/結案按鈕，保留
  const showAction = role !== 'manager'
  const colCount = showAction ? 6 : 5

  function ActionCell({ r }) {
    // 主管:刪除已移到需求詳情視窗內，點進去才會出現，避免列表上誤觸
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
    const isNew = newIds.has(r.id)
    return (
      <tr onClick={() => openDetail(r)}
        className={`border-t border-gray-100 cursor-pointer ${faded ? 'text-gray-400 hover:bg-gray-50/50' : 'hover:bg-gray-50'} ${isNew ? 'bg-blue-50/40' : ''}`}>
        <td className="px-3 py-2.5 overflow-hidden">
          <div className={`text-sm truncate ${faded ? '' : 'text-gray-800 font-medium'}`}>
            {isNew && (
              <span className="inline-block text-[10px] font-bold bg-red-500 text-white rounded px-1 py-0.5 mr-1.5 align-middle leading-none">NEW</span>
            )}
            {r.urgent && !faded && <span className="text-red-500 mr-1">🔥</span>}
            {r.projectName || r.title}
          </div>
          {r.attachments?.length > 0 && (
            <div className="mt-1" onClick={e => e.stopPropagation()}>
              <Attachments items={r.attachments} requestId={r.id} />
            </div>
          )}
        </td>
        <td className="px-3 py-2.5 text-xs truncate">{r.region}</td>
        <td className="px-3 py-2.5 text-xs whitespace-nowrap">{r.dueDate || '—'}</td>
        <td className="px-3 py-2.5 text-xs truncate">{submitterName(r)}</td>
        <td className="px-3 py-2.5">
          <span className={`text-xs px-2 py-0.5 rounded-full ${faded ? 'bg-gray-100 text-gray-400' : meta.color}`}>{meta.label}</span>
        </td>
        {showAction && <td className="px-3 py-2.5 text-right"><ActionCell r={r} /></td>}
      </tr>
    )
  }

  // 固定欄寬（table-layout: fixed + 同一組 colgroup），讓每個設計師分組的表格欄位對得齊，不會因為內容長短各自伸縮
  // 設計師欄位已隱藏（分組標題已顯示設計師名稱，欄位重複）；動作欄只有 designer/planner 有按鈕才顯示
  function Table({ data, faded, empty }) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full" style={{ tableLayout: 'fixed', minWidth: 640 }}>
          <colgroup>
            {showAction ? (
              <>
                <col style={{ width: '34%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '10%' }} />
              </>
            ) : (
              <>
                <col style={{ width: '40%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '14%' }} />
              </>
            )}
          </colgroup>
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-3 py-2.5 font-medium">專案名稱</th>
              <th className="text-left px-3 py-2.5 font-medium">地區</th>
              <th className="text-left px-3 py-2.5 font-medium">交期</th>
              <th className="text-left px-3 py-2.5 font-medium">提交人</th>
              <th className="text-left px-3 py-2.5 font-medium">狀態</th>
              {showAction && <th className="text-right px-3 py-2.5 font-medium">動作</th>}
            </tr>
          </thead>
          <tbody>
            {data.map(r => <Row key={r.id} r={r} faded={faded} />)}
            {data.length === 0 && (
              <tr><td colSpan={colCount} className="px-3 py-8 text-center text-gray-400 text-sm">{empty}</td></tr>
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
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <select value={sort} onChange={e => setSort(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white">
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            {(fDesigners.length > 0 || fStatuses.length > 0 || fRegions.length > 0) && (
              <button onClick={() => { setFDesigners([]); setFStatuses([]); setFRegions([]) }}
                className="text-xs text-gray-400 hover:text-gray-600">✕ 清除篩選</button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            <span className="text-xs text-gray-400 mr-1">設計師</span>
            {allDesignerOpts.map(([e, name]) => (
              <button key={e} onClick={() => toggleFilter(setFDesigners, e)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  fDesigners.includes(e) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>
                {name}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            <span className="text-xs text-gray-400 mr-1">狀態</span>
            {Object.entries(STATUS).map(([k, v]) => (
              <button key={k} onClick={() => toggleFilter(setFStatuses, k)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  fStatuses.includes(k) ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>
                {v.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-gray-400 mr-1">地區</span>
            {allRegionOpts.map(r => (
              <button key={r} onClick={() => toggleFilter(setFRegions, r)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  fRegions.includes(r) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>
                {r}
              </button>
            ))}
          </div>
        </div>
      )}

      {noRegion ? (
        <div className="text-center text-amber-600 text-sm py-12 bg-amber-50 rounded-xl border border-amber-100">
          你尚未被指派負責區域,請聯絡主管在「使用者管理」設定。
        </div>
      ) : (
        <>
          {active.length === 0 ? (
            <Table data={[]} empty="目前沒有進行中的需求" />
          ) : (
            groupByDesigner(active).map(([designer, list]) => (
              <div key={designer} className="mb-6">
                <h2 className="text-sm font-semibold text-gray-600 mb-2">{designer}（{list.length}）</h2>
                <Table data={list} empty="" />
              </div>
            ))
          )}

          {done.length > 0 && (
            <>
              <h2 className="text-sm font-medium text-gray-400 mt-8 mb-3">已結案（{done.length}）</h2>
              {groupByDesigner(done).map(([designer, list]) => (
                <div key={designer} className="mb-4">
                  <h3 className="text-xs font-medium text-gray-400 mb-2">{designer}（{list.length}）</h3>
                  <Table data={list} faded empty="" />
                </div>
              ))}
            </>
          )}
        </>
      )}

      <RequestDetailModal
        r={detail ? rows.find(x => x.id === detail.id) || detail : null}
        onClose={() => setDetail(null)}
        actions={role === 'manager' && detail ? (
          modalDeleteConfirm ? (
            <>
              <button onClick={() => handleDelete(detail)} disabled={busy === detail.id}
                className="flex-1 bg-red-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50">
                確認刪除
              </button>
              <button onClick={() => setModalDeleteConfirm(false)}
                className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">取消</button>
            </>
          ) : (
            <button onClick={() => setModalDeleteConfirm(true)}
              className="text-sm text-red-500 hover:text-red-700 px-4 py-2 rounded-lg hover:bg-red-50">
              🗑 刪除此需求
            </button>
          )
        ) : null}
      />
    </div>
  )
}
