import { useEffect, useState } from 'react'
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { TYPE_COLORS, DEFAULT_RULES } from '../utils/milestoneUtils'

const KV_CATEGORIES = ['台灣節日', '親情愛情節日', '季節促銷', '購物節', '年末節慶促銷']
const KV_REGIONS = ['WWW', 'CN/SD2', 'SD1', 'SD2']
const DEFAULT_DESIGN_SUBTYPES = ['季節KV', '工規型錄', '商規型錄', '桌曆']

const emptyForm = {
  name: '', startDate: '', endDate: '', year: new Date().getFullYear(), assignments: [],
  designSubtype: '', kvEventDate: '', kvCategory: '', kvRegion: 'WWW', kvNote: '',
}

function addDays(dateStr, days) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

// 設計類專案管理（含季節KV自動排程）。獨立於活動/報獎頁，各自維護互不干擾
export default function DesignPage() {
  const { isManager } = useAuth()
  const [projects, setProjects] = useState([])
  const [people, setPeople] = useState([])
  const [rules, setRules] = useState(DEFAULT_RULES)
  const [showModal, setShowModal] = useState(false)
  const [editProject, setEditProject] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [filterYear, setFilterYear] = useState(new Date().getFullYear())
  const [showCompleted, setShowCompleted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [customDesignSubtypes, setCustomDesignSubtypes] = useState([])
  const [newSubtypeInput, setNewSubtypeInput] = useState('')
  const [addingSubtype, setAddingSubtype] = useState(false)

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'projects'), snap =>
      setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.type === 'design' || p.type === 'seasonal_kv')))
    const u2 = onSnapshot(collection(db, 'people'), snap =>
      setPeople(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    const loadSettings = async () => {
      const rd = await getDoc(doc(db, 'settings', 'milestoneRules'))
      if (rd.exists()) setRules({ ...DEFAULT_RULES, ...rd.data() })
      const ds = await getDoc(doc(db, 'settings', 'designSubtypes'))
      if (ds.exists()) setCustomDesignSubtypes(ds.data().subtypes || [])
    }
    loadSettings()
    return () => { u1(); u2() }
  }, [])

  const allDesignSubtypes = [
    ...DEFAULT_DESIGN_SUBTYPES,
    ...customDesignSubtypes.filter(s => !DEFAULT_DESIGN_SUBTYPES.includes(s)),
  ]

  async function saveCustomSubtype() {
    if (!isManager) return
    const val = newSubtypeInput.trim()
    if (!val || allDesignSubtypes.includes(val)) { setNewSubtypeInput(''); setAddingSubtype(false); return }
    const updated = [...customDesignSubtypes, val]
    await setDoc(doc(db, 'settings', 'designSubtypes'), { subtypes: updated })
    setCustomDesignSubtypes(updated)
    setForm(f => ({ ...f, designSubtype: val }))
    setNewSubtypeInput(''); setAddingSubtype(false)
  }

  async function deleteCustomSubtype(sub) {
    if (!isManager) return
    const updated = customDesignSubtypes.filter(s => s !== sub)
    await setDoc(doc(db, 'settings', 'designSubtypes'), { subtypes: updated })
    setCustomDesignSubtypes(updated)
    if (form.designSubtype === sub) setForm(f => ({ ...f, designSubtype: '' }))
  }

  function openCreate() {
    setEditProject(null)
    setForm({ ...emptyForm, year: filterYear })
    setNewSubtypeInput(''); setAddingSubtype(false)
    setShowModal(true)
  }

  function openEdit(p) {
    setEditProject(p)
    setForm({
      name: p.name || '', startDate: p.startDate || '', endDate: p.endDate || '',
      year: p.year || new Date().getFullYear(), assignments: p.assignments || [],
      designSubtype: p.designSubtype || (p.type === 'seasonal_kv' ? '季節KV' : ''),
      kvEventDate: p.endDate || '', kvCategory: p.kvCategory || '',
      kvRegion: p.kvRegion || 'WWW', kvNote: p.note || '',
    })
    setNewSubtypeInput(''); setAddingSubtype(false)
    setShowModal(true)
  }

  async function handleSave() {
    if (!isManager || !form.name) return
    const isKV = form.designSubtype === '季節KV'
    if (isKV && !form.kvEventDate) return
    if (!isKV && (!form.startDate || !form.endDate)) return
    setSaving(true)

    let data = {
      name: form.name, type: 'design', subtype: '',
      designSubtype: form.designSubtype,
      year: parseInt(form.year), assignments: form.assignments,
      updatedAt: new Date().toISOString(),
    }

    if (isKV) {
      const r = { ...DEFAULT_RULES, ...rules }
      const kickoff = addDays(form.kvEventDate, -(r.kvKickoff * 7))
      data = {
        ...data, startDate: kickoff, endDate: form.kvEventDate,
        kvCategory: form.kvCategory, kvRegion: form.kvRegion, note: form.kvNote,
      }
    } else {
      data = { ...data, startDate: form.startDate, endDate: form.endDate, note: form.kvNote }
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

  const filtered = projects
    .filter(p => !p.year || p.year === filterYear)
    .filter(p => showCompleted || p.status !== '已結束')
    .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''))

  const years = [...new Set(projects.map(p => p.year).filter(Boolean))].sort()
  if (!years.includes(filterYear)) years.push(filterYear)
  years.sort()

  const designers = people.filter(p => p.role === 'designer')
  const planners = people.filter(p => p.role === 'planner')
  const isKV = form.designSubtype === '季節KV'
  const typeColor = TYPE_COLORS.design
  const todayStr = new Date().toISOString().slice(0, 10)

  const kvPreviewKickoff = isKV && form.kvEventDate
    ? addDays(form.kvEventDate, -((rules.kvKickoff || DEFAULT_RULES.kvKickoff) * 7))
    : null
  const kvPreviewRelease = isKV && form.kvEventDate
    ? addDays(form.kvEventDate, -((rules.kvRelease || DEFAULT_RULES.kvRelease) * 7))
    : null

  const canSave = form.name && (isKV ? !!form.kvEventDate : (!!form.startDate && !!form.endDate))

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
        <div>
          <h2 className="text-xl font-bold text-gray-800">設計</h2>
          <p className="text-sm text-gray-400">{filtered.length} 個專案</p>
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
              + 新增設計專案
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <div className="text-center"><div className="text-4xl mb-2">🎨</div><p>尚無設計專案，點擊「新增設計專案」開始</p></div>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-gray-50 z-10">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-500 border-b border-r border-gray-200 sticky left-0 bg-gray-50 min-w-[200px]">名稱</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500 border-b border-gray-200 whitespace-nowrap">類別</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500 border-b border-gray-200 whitespace-nowrap">日期</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500 border-b border-gray-200">說明</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500 border-b border-gray-200">指派人員</th>
                  {isManager && <th className="px-3 py-2 border-b border-gray-200"></th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => {
                  const subtypeLabel = p.designSubtype || ''
                  const region = (p.type === 'seasonal_kv' || p.designSubtype === '季節KV') ? p.kvRegion : ''
                  const assigned = (p.assignments || []).map(a => {
                    const person = people.find(pe => pe.id === a.personId)
                    return person ? { ...person, role: a.role } : null
                  }).filter(Boolean)
                  const expired = p.endDate && p.endDate < todayStr
                  return (
                    <tr key={p.id} onClick={() => openEdit(p)}
                      className={`cursor-pointer hover:bg-blue-50 ${i % 2 ? 'bg-gray-50/50' : 'bg-white'}`}>
                      <td className={`px-3 py-2 border-r border-gray-100 sticky left-0 bg-inherit font-medium whitespace-nowrap ${expired ? 'text-gray-400' : 'text-gray-800'}`}>
                        <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: typeColor }} />
                        {p.name}
                      </td>
                      <td className={`px-3 py-2 whitespace-nowrap ${expired ? 'text-gray-400' : 'text-gray-600'}`}>
                        {[subtypeLabel, region].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className={`px-3 py-2 whitespace-nowrap ${expired ? 'text-gray-400' : 'text-gray-600'}`}>
                        {p.startDate ? `${p.startDate} ~ ${p.endDate}` : '—'}
                      </td>
                      <td className={`px-3 py-2 ${expired ? 'text-gray-400' : 'text-gray-600'}`}>
                        {[p.kvCategory, p.note].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className={`px-3 py-2 whitespace-nowrap ${expired ? 'text-gray-400' : 'text-gray-600'}`}>
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
                {!isManager ? '檢視設計專案' : editProject ? '編輯設計專案' : '新增設計專案'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">設計類別</label>
                <div className="flex flex-wrap gap-2">
                  {allDesignSubtypes.map(sub => (
                    <div key={sub} className="relative group">
                      <button type="button" disabled={!isManager} onClick={() => setForm(f => ({ ...f, designSubtype: sub }))}
                        className={`px-3 py-1.5 text-sm rounded-lg border-2 font-medium transition-colors disabled:cursor-default ${form.designSubtype === sub ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-200 text-gray-600 hover:enabled:bg-gray-50'}`}>
                        {sub}
                      </button>
                      {!DEFAULT_DESIGN_SUBTYPES.includes(sub) && isManager && (
                        <button onClick={() => deleteCustomSubtype(sub)}
                          className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                  {isManager && !addingSubtype && (
                    <button onClick={() => setAddingSubtype(true)}
                      className="px-3 py-1.5 text-sm rounded-lg border-2 border-dashed border-gray-300 text-gray-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors">
                      + 新增類別
                    </button>
                  )}
                  {isManager && addingSubtype && (
                    <div className="flex items-center gap-1.5">
                      <input autoFocus value={newSubtypeInput}
                        onChange={e => setNewSubtypeInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveCustomSubtype(); if (e.key === 'Escape') { setAddingSubtype(false); setNewSubtypeInput('') } }}
                        placeholder="類別名稱"
                        className="border border-indigo-400 rounded-lg px-2.5 py-1.5 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                      <button onClick={saveCustomSubtype} className="text-xs bg-indigo-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-indigo-700">確認</button>
                      <button onClick={() => { setAddingSubtype(false); setNewSubtypeInput('') }} className="text-xs text-gray-400 hover:text-gray-600 px-1.5 py-1.5">✕</button>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">專案名稱 *</label>
                <input value={form.name} disabled={!isManager} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder={isKV ? '例：農曆新年 2026' : '例：2026 型錄'}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500" />
              </div>

              {isKV ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">節慶日期 *</label>
                    <input type="date" value={form.kvEventDate} disabled={!isManager}
                      onChange={e => setForm(f => ({ ...f, kvEventDate: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-500" />
                    <p className="text-xs text-gray-400 mt-1">KV 發稿與發佈日期依里程碑設定自動計算</p>
                  </div>
                  {kvPreviewKickoff && (
                    <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-3 text-sm space-y-1">
                      <p className="font-medium text-indigo-700 mb-1">自動計算預覽</p>
                      <p className="text-indigo-600">📋 發稿（Kick off）：{kvPreviewKickoff}</p>
                      <p className="text-indigo-600">🚀 發佈KV：{kvPreviewRelease}</p>
                      <p className="text-indigo-600">🎯 節慶日期：{form.kvEventDate}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">類別</label>
                      <select value={form.kvCategory} disabled={!isManager} onChange={e => setForm(f => ({ ...f, kvCategory: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500">
                        <option value="">請選擇</option>
                        {KV_CATEGORIES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Region</label>
                      <select value={form.kvRegion} disabled={!isManager} onChange={e => setForm(f => ({ ...f, kvRegion: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500">
                        {KV_REGIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">備註</label>
                    <input value={form.kvNote} disabled={!isManager} onChange={e => setForm(f => ({ ...f, kvNote: e.target.value }))}
                      placeholder="例：eCard、全球版本"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-500" />
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">開始日期 *</label>
                      <input type="date" value={form.startDate} disabled={!isManager} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-500" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">結束日期 *</label>
                      <input type="date" value={form.endDate} disabled={!isManager} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-500" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">備註（選填）</label>
                    <input value={form.kvNote} disabled={!isManager} onChange={e => setForm(f => ({ ...f, kvNote: e.target.value }))}
                      placeholder="例：版本說明"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-500" />
                  </div>
                </>
              )}

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
                {planners.length > 0 && !isKV && (
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
                {people.length === 0 && <p className="text-sm text-gray-400">請先在「人員管理」新增成員</p>}
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
