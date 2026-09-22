import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { PHASE_DOT, projectPhase } from '../utils/milestoneUtils'
import PageHeader from './ui/PageHeader'
import ModalShell from './ui/ModalShell'
import ConfirmDialog from './ui/ConfirmDialog'
import EmptyState from './ui/EmptyState'

const emptyForm = {
  name: '', subtype: '', startDate: '', endDate: '', location: '',
  year: new Date().getFullYear(), assignments: [],
}

// 「活動」「報獎」共用的單一類型專案管理頁（各自獨立路由，互不干擾）
// props: type（Firestore 的 project.type）、typeLabel（頁面標題）、subtypeOptions（子類型下拉選項）、
//   subtypeFieldLabel、sortBy（列表排序依據欄位，預設 startDate；報獎依 endDate=截止日期排序）
export default function SimpleProjectPage({ type, typeLabel, subtypeOptions, subtypeFieldLabel, sortBy = 'startDate' }) {
  const { isManager } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [projects, setProjects] = useState([])
  const [people, setPeople] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editProject, setEditProject] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [filterYear, setFilterYear] = useState(new Date().getFullYear())
  const [showCompleted, setShowCompleted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'projects'), snap =>
      setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.type === type)))
    const u2 = onSnapshot(collection(db, 'people'), snap =>
      setPeople(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return () => { u1(); u2() }
  }, [type])

  // 從甘特圖等外部連結帶 ?open=id 進來時，直接開該筆的編輯視窗（連年度/已結束篩選都一併切過去，不然可能篩選不到那一列）
  useEffect(() => {
    const openId = searchParams.get('open')
    if (!openId) return
    const target = projects.find(p => p.id === openId)
    if (target) {
      queueMicrotask(() => {
        openEdit(target)
        setFilterYear(target.year || new Date().getFullYear())
        setShowCompleted(true)
        setSearchParams({}, { replace: true })
      })
    }
  }, [searchParams, projects, setSearchParams])

  function openCreate() {
    setEditProject(null)
    setForm({ ...emptyForm, year: filterYear })
    setShowModal(true)
  }

  function openEdit(p) {
    setEditProject(p)
    setForm({
      name: p.name || '', subtype: p.subtype || '',
      startDate: p.startDate || '', endDate: p.endDate || '',
      location: p.location || '', year: p.year || new Date().getFullYear(),
      assignments: p.assignments || [],
    })
    setShowModal(true)
  }

  async function handleSave() {
    if (!isManager || !form.name || !form.startDate || !form.endDate) return
    setSaving(true)
    const data = {
      name: form.name, type, subtype: form.subtype,
      startDate: form.startDate, endDate: form.endDate, location: form.location,
      year: parseInt(form.year), assignments: form.assignments,
      updatedAt: new Date().toISOString(),
    }
    try {
      if (editProject) {
        await updateDoc(doc(db, 'projects', editProject.id), data)
      } else {
        data.createdAt = new Date().toISOString()
        await addDoc(collection(db, 'projects'), data)
      }
      setShowModal(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    if (!isManager) return
    await deleteDoc(doc(db, 'projects', id))
    setDeleteConfirm(null)
  }

  function toggleAssignment(personId, role) {
    if (!isManager) return
    const existing = form.assignments.findIndex(a => a.personId === personId)
    if (existing >= 0) {
      setForm(f => ({ ...f, assignments: f.assignments.filter((_, i) => i !== existing) }))
    } else {
      setForm(f => ({ ...f, assignments: [...f.assignments, { personId, role }] }))
    }
  }

  const todayStr = new Date().toISOString().slice(0, 10)
  const dateField = sortBy === 'endDate' ? 'endDate' : 'startDate'

  const filtered = projects
    .filter(p => !p.year || p.year === filterYear)
    .filter(p => showCompleted || p.status !== '已結束')
    .sort((a, b) => (a[dateField] || '').localeCompare(b[dateField] || ''))

  const years = [...new Set(projects.map(p => p.year).filter(Boolean))].sort()
  if (!years.includes(filterYear)) years.push(filterYear)
  years.sort()

  const designers = people.filter(p => p.role === 'designer')
  const planners = people.filter(p => p.role === 'planner')
  const canSave = !!form.name && !!form.startDate && !!form.endDate

  // 表格 / 手機卡片共用的一列資料整理（避免兩種版型各自算一次、之後改到不一致）
  function rowData(p) {
    const assigned = (p.assignments || []).map(a => {
      const person = people.find(pe => pe.id === a.personId)
      return person ? { ...person, role: a.role } : null
    }).filter(Boolean)
    const phase = projectPhase(p, todayStr)
    return { assigned, phase, expired: phase === 'ended', dot: phase ? PHASE_DOT[phase] : null }
  }
  const assignedText = (assigned) => assigned.length > 0
    ? assigned.map(a => `${a.name}${a.role === 'designer' ? '(設計)' : '(Planner)'}`).join('、')
    : '—'

  return (
    <div className="flex flex-col h-full min-w-0">
      <PageHeader
        title={typeLabel}
        subtitle={`${filtered.length} 個專案`}
        actions={
          <>
            <select value={filterYear} onChange={e => setFilterYear(parseInt(e.target.value))}
              aria-label="年度"
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 min-h-[44px] bg-white text-gray-700">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={() => setShowCompleted(v => !v)}
              className={`px-3 py-2 min-h-[44px] text-sm rounded-lg border transition-colors ${showCompleted ? 'bg-gray-200 text-gray-700 border-gray-300' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
              {showCompleted ? '✓ 顯示已結束' : '已結束已隱藏'}
            </button>
            {isManager && (
              <button onClick={openCreate}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 min-h-[44px] rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                + 新增{typeLabel}
              </button>
            )}
          </>
        }
      />

      <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-6">
        {filtered.length === 0 ? (
          <EmptyState icon="📋" title={`尚無${typeLabel}，點擊「新增${typeLabel}」開始`} />
        ) : (
          <>
          {/* 手機：卡片列表（欄位與操作都保留，不隱藏任何資料） */}
          <div className="md:hidden space-y-2">
            {filtered.map(p => {
              const { assigned, expired, dot } = rowData(p)
              return (
                <div key={p.id}
                  className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 active:bg-blue-50"
                  onClick={() => openEdit(p)}>
                  <div className="flex items-start justify-between gap-2">
                    <p className={`font-medium break-words min-w-0 ${expired ? 'text-gray-500' : 'text-gray-800'}`}>
                      {dot && <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ backgroundColor: dot.color }} title={dot.label} />}
                      {p.name}
                    </p>
                    {isManager && (
                      <button onClick={e => { e.stopPropagation(); setDeleteConfirm(p.id) }}
                        className="shrink-0 text-xs text-red-400 hover:text-red-600 px-2 py-2 min-h-[36px]">刪除</button>
                    )}
                  </div>
                  <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs text-gray-600">
                    <dt className="text-gray-500">{subtypeFieldLabel}</dt><dd className="break-words">{p.subtype || '—'}</dd>
                    <dt className="text-gray-500">日期</dt><dd className="break-words">{p.startDate ? `${p.startDate} ~ ${p.endDate}` : '—'}</dd>
                    <dt className="text-gray-500">地點</dt><dd className="break-words">{p.location || '—'}</dd>
                    <dt className="text-gray-500">指派人員</dt><dd className="break-words">{assignedText(assigned)}</dd>
                  </dl>
                </div>
              )
            })}
          </div>

          {/* md 以上：維持原本的高密度表格 */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-gray-50 z-10">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-500 border-b border-r border-gray-200 sticky left-0 bg-gray-50 min-w-[200px]">名稱</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500 border-b border-gray-200 whitespace-nowrap">{subtypeFieldLabel}</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500 border-b border-gray-200 whitespace-nowrap">日期</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500 border-b border-gray-200">地點</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500 border-b border-gray-200">指派人員</th>
                  {isManager && <th className="px-3 py-2 border-b border-gray-200"></th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => {
                  const { assigned, expired, dot } = rowData(p)
                  return (
                    <tr key={p.id} onClick={() => openEdit(p)}
                      className={`cursor-pointer hover:bg-blue-50 ${i % 2 ? 'bg-gray-50/50' : 'bg-white'}`}>
                      <td className={`px-3 py-2 border-r border-gray-100 sticky left-0 bg-inherit font-medium whitespace-nowrap ${expired ? 'text-gray-500' : 'text-gray-800'}`}>
                        {dot && (
                          <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: dot.color }} title={dot.label} />
                        )}
                        {p.name}
                      </td>
                      <td className={`px-3 py-2 whitespace-nowrap ${expired ? 'text-gray-500' : 'text-gray-600'}`}>{p.subtype || '—'}</td>
                      <td className={`px-3 py-2 whitespace-nowrap ${expired ? 'text-gray-500' : 'text-gray-600'}`}>
                        {p.startDate ? `${p.startDate} ~ ${p.endDate}` : '—'}
                      </td>
                      <td className={`px-3 py-2 ${expired ? 'text-gray-500' : 'text-gray-600'}`}>{p.location || '—'}</td>
                      <td className={`px-3 py-2 whitespace-nowrap ${expired ? 'text-gray-500' : 'text-gray-600'}`}>
                        {assignedText(assigned)}
                      </td>
                      {isManager && (
                        <td className="px-3 py-2 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          <button onClick={() => setDeleteConfirm(p.id)} className="text-xs text-red-400 hover:text-red-600 hover:underline">刪除</button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {showModal && (
        <ModalShell
          onClose={() => setShowModal(false)}
          title={!isManager ? `檢視${typeLabel}` : editProject ? `編輯${typeLabel}` : `新增${typeLabel}`}
          footer={
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 sm:justify-end">
              <button onClick={() => setShowModal(false)} className="w-full sm:w-auto px-4 py-2.5 min-h-[44px] text-sm text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200 sm:border-0">
                {isManager ? '取消' : '關閉'}
              </button>
              {isManager && (
                <button onClick={handleSave} disabled={saving || !canSave}
                  className="w-full sm:w-auto px-5 py-2.5 min-h-[44px] text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 font-medium">
                  {saving ? '儲存中…' : '儲存'}
                </button>
              )}
            </div>
          }
        >
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{subtypeFieldLabel}</label>
                <select value={form.subtype} disabled={!isManager} onChange={e => setForm(f => ({ ...f, subtype: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500">
                  <option value="">請選擇</option>
                  {subtypeOptions.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">名稱 *</label>
                <input value={form.name} disabled={!isManager} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="min-w-0">
                  <label className="block text-sm font-medium text-gray-700 mb-1">開始日期 *</label>
                  <input type="date" value={form.startDate} disabled={!isManager} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500" />
                </div>
                <div className="min-w-0">
                  <label className="block text-sm font-medium text-gray-700 mb-1">結束日期 *</label>
                  <input type="date" value={form.endDate} disabled={!isManager} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">地點</label>
                <input value={form.location} disabled={!isManager} onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                  placeholder="例：Taipei, TW"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">年份</label>
                <input type="number" value={form.year} disabled={!isManager} onChange={e => setForm(f => ({ ...f, year: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">指派人員</label>
                {designers.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs text-gray-500 mb-1.5 font-medium">設計師</p>
                    <div className="flex flex-wrap gap-2">
                      {designers.map(p => {
                        const selected = form.assignments.some(a => a.personId === p.id)
                        return (
                          <button key={p.id} type="button" disabled={!isManager} onClick={() => toggleAssignment(p.id, 'designer')}
                            className={`px-3 py-2 min-h-[40px] text-sm rounded-lg border transition-colors disabled:cursor-default ${selected ? 'bg-purple-600 text-white border-purple-600' : 'border-gray-200 text-gray-600 hover:enabled:bg-gray-50'}`}>
                            {p.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                {planners.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1.5 font-medium">Planner</p>
                    <div className="flex flex-wrap gap-2">
                      {planners.map(p => {
                        const selected = form.assignments.some(a => a.personId === p.id)
                        return (
                          <button key={p.id} type="button" disabled={!isManager} onClick={() => toggleAssignment(p.id, 'planner')}
                            className={`px-3 py-2 min-h-[40px] text-sm rounded-lg border transition-colors disabled:cursor-default ${selected ? 'bg-teal-600 text-white border-teal-600' : 'border-gray-200 text-gray-600 hover:enabled:bg-gray-50'}`}>
                            {p.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                {people.length === 0 && <p className="text-sm text-gray-500">請先在「人員管理」新增成員</p>}
              </div>
        </ModalShell>
      )}

      {deleteConfirm && (
        <ConfirmDialog
          message="刪除後無法復原，確定要刪除嗎？"
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={() => handleDelete(deleteConfirm)}
        />
      )}
    </div>
  )
}
