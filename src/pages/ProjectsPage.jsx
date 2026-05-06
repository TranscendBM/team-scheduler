import { useEffect, useState } from 'react'
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { TYPE_LABELS, TYPE_COLORS, TYPE_BG, DEFAULT_RULES, getWorkStart, getLoadingLevel, LOADING_COLORS } from '../utils/milestoneUtils'

const EVENT_SUBTYPES = ['尾牙', '春酒', '媒體春酒', 'HBL', '灣聲音樂會']
const AWARD_SUBTYPES = ['25大國際品牌', '台灣精品獎', 'BC Award', '體育推手獎', 'EE Awards']
const KV_CATEGORIES = ['台灣節日', '親情愛情節日', '季節促銷', '購物節', '年末節慶促銷']
const KV_REGIONS = ['WWW', 'CN/SD2', 'SD1', 'SD2']
const DEFAULT_DESIGN_SUBTYPES = ['季節KV', '工規型錄', '商規型錄', '桌曆']

const emptyForm = {
  name: '', type: 'tradeshow', subtype: '',
  startDate: '', endDate: '',
  location: '', showType: '', office: '', year: new Date().getFullYear(),
  assignments: [],
  // tradeshow
  boothSize: '', artworkDone: false,
  // design / kv
  designSubtype: '',
  kvEventDate: '', kvCategory: '', kvRegion: 'WWW', kvNote: '',
}

function addDays(dateStr, days) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

export default function ProjectsPage() {
  const { isAdmin } = useAuth()
  const [projects, setProjects] = useState([])
  const [people, setPeople] = useState([])
  const [rules, setRules] = useState(DEFAULT_RULES)
  const [showModal, setShowModal] = useState(false)
  const [editProject, setEditProject] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [filterType, setFilterType] = useState('all')
  const [filterYear, setFilterYear] = useState(new Date().getFullYear())
  const [showCompleted, setShowCompleted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  // Design subtypes (default + custom from Firestore)
  const [customDesignSubtypes, setCustomDesignSubtypes] = useState([])
  const [newSubtypeInput, setNewSubtypeInput] = useState('')
  const [addingSubtype, setAddingSubtype] = useState(false)

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'projects'), snap =>
      setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
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
    const val = newSubtypeInput.trim()
    if (!val || allDesignSubtypes.includes(val)) { setNewSubtypeInput(''); setAddingSubtype(false); return }
    const updated = [...customDesignSubtypes, val]
    await setDoc(doc(db, 'settings', 'designSubtypes'), { subtypes: updated })
    setCustomDesignSubtypes(updated)
    setForm(f => ({ ...f, designSubtype: val }))
    setNewSubtypeInput(''); setAddingSubtype(false)
  }

  async function deleteCustomSubtype(sub) {
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
      name: p.name || '',
      type: p.type || 'tradeshow',
      subtype: p.subtype || '',
      startDate: p.startDate || '',
      endDate: p.endDate || '',
      location: p.location || '',
      showType: p.showType || '',
      office: p.office || '',
      year: p.year || new Date().getFullYear(),
      assignments: p.assignments || [],
      boothSize: p.boothSize || '',
      artworkDone: !!p.artworkDone,
      designSubtype: p.designSubtype || (p.type === 'seasonal_kv' ? '季節KV' : ''),
      kvEventDate: p.endDate || '',
      kvCategory: p.kvCategory || '',
      kvRegion: p.kvRegion || 'WWW',
      kvNote: p.note || '',
    })
    setNewSubtypeInput(''); setAddingSubtype(false)
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.name) return
    const isDesignKV = form.type === 'design' && form.designSubtype === '季節KV'
    const isLegacyKV = form.type === 'seasonal_kv'
    if ((isDesignKV || isLegacyKV) && !form.kvEventDate) return
    if (!isDesignKV && !isLegacyKV && (!form.startDate || !form.endDate)) return
    setSaving(true)

    let data = {
      name: form.name,
      type: form.type,
      subtype: form.subtype,
      location: form.location,
      year: parseInt(form.year),
      assignments: form.assignments,
      updatedAt: new Date().toISOString(),
    }

    if (form.type === 'tradeshow') {
      data = {
        ...data,
        startDate: form.startDate, endDate: form.endDate,
        showType: form.showType, office: form.office,
        boothSize: form.boothSize ? parseInt(form.boothSize) : null,
        artworkDone: !!form.artworkDone,
      }
    } else if (form.type === 'design') {
      data.designSubtype = form.designSubtype
      if (isDesignKV) {
        // KV: auto-calculate kickoff
        const r = { ...DEFAULT_RULES, ...rules }
        const kickoff = addDays(form.kvEventDate, -(r.kvKickoff * 7))
        data = {
          ...data,
          startDate: kickoff,
          endDate: form.kvEventDate,
          kvCategory: form.kvCategory,
          kvRegion: form.kvRegion,
          note: form.kvNote,
        }
      } else {
        data = { ...data, startDate: form.startDate, endDate: form.endDate, note: form.kvNote }
      }
    } else if (isLegacyKV) {
      const r = { ...DEFAULT_RULES, ...rules }
      const kickoff = addDays(form.kvEventDate, -(r.kvKickoff * 7))
      data = {
        ...data,
        startDate: kickoff, endDate: form.kvEventDate,
        kvCategory: form.kvCategory, kvRegion: form.kvRegion, note: form.kvNote,
      }
    } else {
      data = { ...data, startDate: form.startDate, endDate: form.endDate }
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
    await deleteDoc(doc(db, 'projects', id))
    setDeleteConfirm(null)
  }

  async function toggleArtworkDone(p) {
    await updateDoc(doc(db, 'projects', p.id), { artworkDone: !p.artworkDone, updatedAt: new Date().toISOString() })
  }

  function toggleAssignment(personId, role) {
    const existing = form.assignments.findIndex(a => a.personId === personId)
    if (existing >= 0) {
      setForm(f => ({ ...f, assignments: f.assignments.filter((_, i) => i !== existing) }))
    } else {
      setForm(f => ({ ...f, assignments: [...f.assignments, { personId, role }] }))
    }
  }

  const filtered = projects
    .filter(p => {
      if (filterType === 'all') return true
      if (filterType === 'design') return p.type === 'design' || p.type === 'seasonal_kv'
      return p.type === filterType
    })
    .filter(p => !p.year || p.year === filterYear)
    .filter(p => showCompleted || p.status !== '已結束')
    .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''))

  const years = [...new Set(projects.map(p => p.year).filter(Boolean))].sort()
  if (!years.includes(filterYear)) years.push(filterYear)
  years.sort()

  const designers = people.filter(p => p.role === 'designer')
  const planners = people.filter(p => p.role === 'planner')

  const isDesignKV = form.type === 'design' && form.designSubtype === '季節KV'
  const isLegacyKV = form.type === 'seasonal_kv'

  const kvPreviewKickoff = (isDesignKV || isLegacyKV) && form.kvEventDate
    ? addDays(form.kvEventDate, -((rules.kvKickoff || DEFAULT_RULES.kvKickoff) * 7))
    : null
  const kvPreviewRelease = (isDesignKV || isLegacyKV) && form.kvEventDate
    ? addDays(form.kvEventDate, -((rules.kvRelease || DEFAULT_RULES.kvRelease) * 7))
    : null

  const canSave = form.name &&
    ((isDesignKV || isLegacyKV) ? !!form.kvEventDate : (!!form.startDate && !!form.endDate))

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
        <div>
          <h2 className="text-xl font-bold text-gray-800">專案管理</h2>
          <p className="text-sm text-gray-400">{filtered.length} 個專案</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select value={filterYear} onChange={e => setFilterYear(parseInt(e.target.value))}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white text-gray-700">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {[['all','全部'],['tradeshow','秀展'],['event','活動'],['award','報獎'],['design','設計類']].map(([val,label]) => (
              <button key={val} onClick={() => setFilterType(val)}
                className={`px-3 py-1.5 ${filterType === val ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={() => setShowCompleted(v => !v)}
            className={`px-3 py-2 text-sm rounded-lg border transition-colors ${showCompleted ? 'bg-gray-200 text-gray-700 border-gray-300' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
            {showCompleted ? '✓ 顯示已結束' : '已結束已隱藏'}
          </button>
          {isAdmin && (
            <button onClick={openCreate}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
              + 新增專案
            </button>
          )}
        </div>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-auto p-6">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <div className="text-center"><div className="text-4xl mb-2">📋</div><p>尚無專案，點擊「新增專案」開始</p></div>
          </div>
        ) : (
          <div className="grid gap-3">
            {filtered.map(p => {
              const assigned = (p.assignments || []).map(a => {
                const person = people.find(pe => pe.id === a.personId)
                return person ? { ...person, role: a.role } : null
              }).filter(Boolean)
              const loadingLevel = p.type === 'tradeshow' ? getLoadingLevel(p.boothSize, p.name) : null
              const loadingStyle = loadingLevel ? LOADING_COLORS[loadingLevel] : null
              const typeColor = TYPE_COLORS[p.type] || '#6B7280'
              const typeBg = TYPE_BG[p.type] || 'bg-gray-100 text-gray-600'
              const typeLabel = TYPE_LABELS[p.type] || p.type
              // For design type: show designSubtype as subtype label
              const subtypeLabel = p.type === 'design' ? p.designSubtype : p.subtype
              return (
                <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="w-1 h-12 rounded-full flex-shrink-0 mt-0.5" style={{ backgroundColor: typeColor }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-semibold text-gray-800 truncate">{p.name}</h3>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${typeBg}`}>{typeLabel}</span>
                          {subtypeLabel && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 flex-shrink-0">{subtypeLabel}</span>
                          )}
                          {loadingLevel && (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                              style={{ backgroundColor: loadingStyle.bg, color: loadingStyle.text }}>
                              {loadingLevel}
                            </span>
                          )}
                          {p.boothSize > 0 && (
                            <span className="text-xs text-gray-400 flex-shrink-0">{p.boothSize} 攤位</span>
                          )}
                          {(p.type === 'seasonal_kv' || (p.type === 'design' && p.designSubtype === '季節KV')) && p.kvRegion && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 flex-shrink-0">{p.kvRegion}</span>
                          )}
                          {p.type === 'tradeshow' && p.artworkDone && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium flex-shrink-0">✓ 已出稿</span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                          {p.startDate && <span>📅 {p.startDate} ~ {p.endDate}</span>}
                          {p.location && <span>📍 {p.location}</span>}
                          {p.showType && <span>🏷 {p.showType}</span>}
                          {p.kvCategory && <span>🏷 {p.kvCategory}</span>}
                          {p.note && <span>· {p.note}</span>}
                        </div>
                        {assigned.length > 0 && (
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            {assigned.map(a => (
                              <span key={a.id} className={`text-xs px-2 py-0.5 rounded-full ${a.role === 'designer' ? 'bg-purple-100 text-purple-700' : 'bg-teal-100 text-teal-700'}`}>
                                {a.name} ({a.role === 'designer' ? '設計' : 'Planner'})
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex gap-2 flex-shrink-0 items-center">
                        {p.type === 'tradeshow' && (
                          <button onClick={() => toggleArtworkDone(p)}
                            title={p.artworkDone ? '取消出稿完畢' : '標記出稿完畢'}
                            className={`text-xs px-2 py-1 rounded border transition-colors ${p.artworkDone ? 'bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200' : 'text-gray-400 border-gray-200 hover:bg-gray-50'}`}>
                            {p.artworkDone ? '✓ 出稿' : '出稿'}
                          </button>
                        )}
                        <button onClick={() => openEdit(p)} className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50">編輯</button>
                        <button onClick={() => setDeleteConfirm(p.id)} className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50">刪除</button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white z-10">
              <h3 className="text-lg font-semibold text-gray-800">{editProject ? '編輯專案' : '新增專案'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">

              {/* ── Type ── */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">專案類型</label>
                <div className="flex flex-wrap gap-2">
                  {[['tradeshow','秀展'],['event','活動'],['award','報獎'],['design','設計類']].map(([val, label]) => (
                    <button key={val} onClick={() => setForm(f => ({ ...f, type: val, subtype: '', designSubtype: '' }))}
                      className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${form.type === val || (val === 'design' && form.type === 'seasonal_kv') ? 'border-transparent text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                      style={form.type === val || (val === 'design' && form.type === 'seasonal_kv') ? { backgroundColor: TYPE_COLORS[val] } : {}}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Design subtype selector ── */}
              {(form.type === 'design' || form.type === 'seasonal_kv') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">設計類別</label>
                  <div className="flex flex-wrap gap-2">
                    {allDesignSubtypes.map(sub => (
                      <div key={sub} className="relative group">
                        <button onClick={() => setForm(f => ({ ...f, designSubtype: sub }))}
                          className={`px-3 py-1.5 text-sm rounded-lg border-2 font-medium transition-colors ${form.designSubtype === sub ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                          {sub}
                        </button>
                        {/* Delete custom subtype (non-default) */}
                        {!DEFAULT_DESIGN_SUBTYPES.includes(sub) && isAdmin && (
                          <button onClick={() => deleteCustomSubtype(sub)}
                            className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                    {/* Add new subtype */}
                    {isAdmin && !addingSubtype && (
                      <button onClick={() => setAddingSubtype(true)}
                        className="px-3 py-1.5 text-sm rounded-lg border-2 border-dashed border-gray-300 text-gray-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors">
                        + 新增類別
                      </button>
                    )}
                    {isAdmin && addingSubtype && (
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
              )}

              {/* ── Event subtype ── */}
              {form.type === 'event' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">活動類型</label>
                  <select value={form.subtype} onChange={e => setForm(f => ({ ...f, subtype: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    <option value="">請選擇</option>
                    {EVENT_SUBTYPES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}
              {form.type === 'award' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">獎項</label>
                  <select value={form.subtype} onChange={e => setForm(f => ({ ...f, subtype: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    <option value="">請選擇</option>
                    {AWARD_SUBTYPES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}

              {/* ── Name ── */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">專案名稱 *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder={isDesignKV ? '例：農曆新年 2026' : form.type === 'design' ? '例：2026 型錄' : '例：Computex 2026'}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              {/* ── KV-specific fields (design+季節KV or legacy seasonal_kv) ── */}
              {(isDesignKV || isLegacyKV) && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">節慶日期 *</label>
                    <input type="date" value={form.kvEventDate}
                      onChange={e => setForm(f => ({ ...f, kvEventDate: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
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
                      <select value={form.kvCategory} onChange={e => setForm(f => ({ ...f, kvCategory: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                        <option value="">請選擇</option>
                        {KV_CATEGORIES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Region</label>
                      <select value={form.kvRegion} onChange={e => setForm(f => ({ ...f, kvRegion: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                        {KV_REGIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">備註</label>
                    <input value={form.kvNote} onChange={e => setForm(f => ({ ...f, kvNote: e.target.value }))}
                      placeholder="例：eCard、全球版本"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </>
              )}

              {/* ── Non-KV design fields ── */}
              {form.type === 'design' && !isDesignKV && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">開始日期 *</label>
                      <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">結束日期 *</label>
                      <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">備註（選填）</label>
                    <input value={form.kvNote} onChange={e => setForm(f => ({ ...f, kvNote: e.target.value }))}
                      placeholder="例：版本說明"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </>
              )}

              {/* ── Tradeshow / Event / Award date + location ── */}
              {(form.type === 'tradeshow' || form.type === 'event' || form.type === 'award') && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">開始日期 *</label>
                      <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">結束日期 *</label>
                      <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">地點</label>
                    <input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                      placeholder="例：Taipei, TW"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </>
              )}

              {/* ── Tradeshow specific ── */}
              {form.type === 'tradeshow' && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">秀展類型</label>
                      <input value={form.showType} onChange={e => setForm(f => ({ ...f, showType: e.target.value }))}
                        placeholder="例：Automation"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">負責 Office</label>
                      <input value={form.office} onChange={e => setForm(f => ({ ...f, office: e.target.value }))}
                        placeholder="例：TW、US"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">攤位數量</label>
                      <input type="number" min="0" value={form.boothSize}
                        onChange={e => setForm(f => ({ ...f, boothSize: e.target.value }))}
                        placeholder="攤位數"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  </div>
                  {(form.boothSize || form.name) && (() => {
                    const lvl = getLoadingLevel(form.boothSize, form.name)
                    if (!lvl) return null
                    const style = LOADING_COLORS[lvl]
                    return (
                      <div className="rounded-lg px-4 py-2 text-sm font-medium"
                        style={{ backgroundColor: style.bg, color: style.text }}>
                        Loading：{lvl}（{form.name?.toUpperCase().includes('COMPUTEX') ? 'COMPUTEX 固定高度' : `${form.boothSize} 攤位`}）
                      </div>
                    )
                  })()}
                  {/* 出稿完畢 toggle */}
                  <button
                    onClick={() => setForm(f => ({ ...f, artworkDone: !f.artworkDone }))}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border-2 transition-colors w-full justify-center ${
                      form.artworkDone
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                    }`}>
                    {form.artworkDone ? '✓ 已出稿完畢' : '出稿完畢'}
                  </button>
                </>
              )}

              {/* ── Year ── */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">年份</label>
                <input type="number" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              {/* ── Assign people ── */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">指派人員</label>
                {designers.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs text-gray-500 mb-1.5 font-medium">設計師</p>
                    <div className="flex flex-wrap gap-2">
                      {designers.map(p => {
                        const selected = form.assignments.some(a => a.personId === p.id)
                        return (
                          <button key={p.id} onClick={() => toggleAssignment(p.id, 'designer')}
                            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${selected ? 'bg-purple-600 text-white border-purple-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                            {p.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                {planners.length > 0 && !isDesignKV && !isLegacyKV && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1.5 font-medium">Planner</p>
                    <div className="flex flex-wrap gap-2">
                      {planners.map(p => {
                        const selected = form.assignments.some(a => a.personId === p.id)
                        return (
                          <button key={p.id} onClick={() => toggleAssignment(p.id, 'planner')}
                            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${selected ? 'bg-teal-600 text-white border-teal-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                            {p.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                {people.length === 0 && <p className="text-sm text-gray-400">請先在「人員管理」新增成員</p>}
              </div>

              {/* ── Tradeshow work period preview ── */}
              {form.type === 'tradeshow' && form.startDate && form.assignments.length > 0 && (
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-xs font-medium text-blue-700 mb-2">自動計算工作區間預覽</p>
                  {form.assignments.map(a => {
                    const person = people.find(pe => pe.id === a.personId)
                    if (!person) return null
                    const workStart = getWorkStart(form.startDate, a.role, rules)
                    return (
                      <p key={a.personId} className="text-xs text-blue-600">
                        {person.name} ({a.role === 'designer' ? '設計師' : 'Planner'})：
                        {workStart.toLocaleDateString('zh-TW')} ~ {form.endDate}
                      </p>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t flex gap-3 justify-end sticky bottom-0 bg-white">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
              <button onClick={handleSave} disabled={saving || !canSave}
                className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 font-medium">
                {saving ? '儲存中…' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">確認刪除</h3>
            <p className="text-sm text-gray-500 mb-6">刪除後無法復原，確定要刪除這個專案嗎？</p>
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
