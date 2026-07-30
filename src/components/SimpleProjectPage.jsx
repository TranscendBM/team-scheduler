import { useEffect, useState } from 'react'
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { TYPE_COLORS } from '../utils/milestoneUtils'

const emptyForm = {
  name: '', subtype: '', startDate: '', endDate: '', location: '',
  year: new Date().getFullYear(), assignments: [],
}

// 「活動」「報獎」共用的單一類型專案管理頁（各自獨立路由，互不干擾）
// props: type（Firestore 的 project.type）、typeLabel（頁面標題）、subtypeOptions（子類型下拉選項）、
//   subtypeFieldLabel、sortBy（列表排序依據欄位，預設 startDate；報獎依 endDate=截止日期排序）
export default function SimpleProjectPage({ type, typeLabel, subtypeOptions, subtypeFieldLabel, sortBy = 'startDate' }) {
  const { isManager } = useAuth()
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
  const typeColor = TYPE_COLORS[type] || '#6B7280'

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
        <div>
          <h2 className="text-xl font-bold text-gray-800">{typeLabel}</h2>
          <p className="text-sm text-gray-500">{filtered.length} 個專案</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select value={filterYear} onChange={e => setFilterYear(parseInt(e.target.value))}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white text-gray-700">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={() => setShowCompleted(v => !v)}
            className={`px-3 py-2 text-sm rounded-lg border transition-colors ${showCompleted ? 'bg-gray-200 text-gray-700 border-gray-300' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
            {showCompleted ? '✓ 顯示已結束' : '已結束已隱藏'}
          </button>
          {isManager && (
            <button onClick={openCreate}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
              + 新增{typeLabel}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-gray-500">
            <div className="text-center"><div className="text-4xl mb-2">📋</div><p>尚無{typeLabel}，點擊「新增{typeLabel}」開始</p></div>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
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
                  const assigned = (p.assignments || []).map(a => {
                    const person = people.find(pe => pe.id === a.personId)
                    return person ? { ...person, role: a.role } : null
                  }).filter(Boolean)
                  const expired = p.endDate && p.endDate < todayStr
                  return (
                    <tr key={p.id} onClick={() => openEdit(p)}
                      className={`cursor-pointer hover:bg-blue-50 ${i % 2 ? 'bg-gray-50/50' : 'bg-white'}`}>
                      <td className={`px-3 py-2 border-r border-gray-100 sticky left-0 bg-inherit font-medium whitespace-nowrap ${expired ? 'text-gray-500' : 'text-gray-800'}`}>
                        <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: typeColor }} />
                        {p.name}
                      </td>
                      <td className={`px-3 py-2 whitespace-nowrap ${expired ? 'text-gray-500' : 'text-gray-600'}`}>{p.subtype || '—'}</td>
                      <td className={`px-3 py-2 whitespace-nowrap ${expired ? 'text-gray-500' : 'text-gray-600'}`}>
                        {p.startDate ? `${p.startDate} ~ ${p.endDate}` : '—'}
                      </td>
                      <td className={`px-3 py-2 ${expired ? 'text-gray-500' : 'text-gray-600'}`}>{p.location || '—'}</td>
                      <td className={`px-3 py-2 whitespace-nowrap ${expired ? 'text-gray-500' : 'text-gray-600'}`}>
                        {assigned.length > 0 ? assigned.map(a => `${a.name}${a.role === 'designer' ? '(設計)' : '(Planner)'}`).join('、') : '—'}
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
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white z-10">
              <h3 className="text-lg font-semibold text-gray-800">
                {!isManager ? `檢視${typeLabel}` : editProject ? `編輯${typeLabel}` : `新增${typeLabel}`}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">開始日期 *</label>
                  <input type="date" value={form.startDate} disabled={!isManager} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500" />
                </div>
                <div>
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
                            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors disabled:cursor-default ${selected ? 'bg-purple-600 text-white border-purple-600' : 'border-gray-200 text-gray-600 hover:enabled:bg-gray-50'}`}>
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
                            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors disabled:cursor-default ${selected ? 'bg-teal-600 text-white border-teal-600' : 'border-gray-200 text-gray-600 hover:enabled:bg-gray-50'}`}>
                            {p.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                {people.length === 0 && <p className="text-sm text-gray-500">請先在「人員管理」新增成員</p>}
              </div>
            </div>
            <div className="px-6 py-4 border-t flex gap-3 justify-end sticky bottom-0 bg-white">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                {isManager ? '取消' : '關閉'}
              </button>
              {isManager && (
                <button onClick={handleSave} disabled={saving || !canSave}
                  className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 font-medium">
                  {saving ? '儲存中…' : '儲存'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">確認刪除</h3>
            <p className="text-sm text-gray-500 mb-6">刪除後無法復原，確定要刪除嗎？</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
              <button onClick={() => handleDelete(deleteConfirm)} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">刪除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
