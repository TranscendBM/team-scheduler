import { useEffect, useState } from 'react'
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'

const LEAVE_TYPES = ['特休', '病假', '事假', '出差', '其他']

const LEAVE_COLORS = {
  '特休': '#8b5cf6',
  '病假': '#f59e0b',
  '事假': '#6b7280',
  '出差': '#0ea5e9',
  '其他': '#d1d5db',
}

const emptyForm = {
  personId: '', startDate: '', startTime: '', endDate: '', endTime: '',
  type: '特休', note: '', allDay: true,
}

const TODAY = new Date().toISOString().split('T')[0]

function formatTimeRange(leave) {
  const sameDay = leave.startDate === leave.endDate
  if (sameDay && leave.startTime && leave.endTime) {
    return `${leave.startDate} ${leave.startTime} ~ ${leave.endTime}`
  }
  if (leave.startTime || leave.endTime) {
    const start = leave.startTime ? `${leave.startDate} ${leave.startTime}` : leave.startDate
    const end = leave.endTime ? `${leave.endDate} ${leave.endTime}` : leave.endDate
    return `${start} ~ ${end}`
  }
  if (leave.startDate === leave.endDate) return leave.startDate
  return `${leave.startDate} ~ ${leave.endDate}`
}

function fmtMonth(ym) {
  const [y, m] = ym.split('-')
  return `${y} 年 ${parseInt(m)} 月`
}

export default function LeavePage() {
  const { isManager } = useAuth()
  const [people, setPeople] = useState([])
  const [leaves, setLeaves] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editLeave, setEditLeave] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [filterPerson, setFilterPerson] = useState('all')
  const [showExpired, setShowExpired] = useState(false)

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'people'), snap =>
      setPeople(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name))))
    const u2 = onSnapshot(collection(db, 'leaves'), snap =>
      setLeaves(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return () => { u1(); u2() }
  }, [])

  function openCreate() { setEditLeave(null); setForm(emptyForm); setShowModal(true) }
  function openEdit(leave) {
    setEditLeave(leave)
    setForm({
      personId: leave.personId,
      startDate: leave.startDate,
      startTime: leave.startTime || '',
      endDate: leave.endDate,
      endTime: leave.endTime || '',
      type: leave.type,
      note: leave.note || '',
      allDay: !leave.startTime && !leave.endTime,
    })
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.personId || !form.startDate || !form.endDate) return
    setSaving(true)
    const person = people.find(p => p.id === form.personId)
    const data = {
      personId: form.personId,
      personName: person?.name || '',
      startDate: form.startDate,
      startTime: form.allDay ? '' : (form.startTime || ''),
      endDate: form.endDate,
      endTime: form.allDay ? '' : (form.endTime || ''),
      type: form.type,
      note: form.note,
      updatedAt: new Date().toISOString(),
    }
    try {
      if (editLeave) {
        await updateDoc(doc(db, 'leaves', editLeave.id), data)
      } else {
        await addDoc(collection(db, 'leaves'), { ...data, createdAt: new Date().toISOString() })
      }
      setShowModal(false)
    } catch (err) { alert('儲存失敗：' + err.message) }
    setSaving(false)
  }

  async function handleDelete(id) { await deleteDoc(doc(db, 'leaves', id)); setDeleteConfirm(null) }

  const days = (leave) => {
    if (!leave.startDate || !leave.endDate) return 0
    if (leave.startDate === leave.endDate && leave.startTime && leave.endTime) return '半天'
    return Math.round((new Date(leave.endDate) - new Date(leave.startDate)) / 86400000) + 1
  }

  // ── Filter ──────────────────────────────────────────────────────
  const baseFiltered = leaves
    .filter(l => filterPerson === 'all' || l.personId === filterPerson)
    .filter(l => showExpired || !l.endDate || l.endDate >= TODAY)
    .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''))

  // ── Group by month ────────────────────────────────────────────
  const byMonth = {}
  baseFiltered.forEach(l => {
    const month = l.startDate?.slice(0, 7) || '未知'
    if (!byMonth[month]) byMonth[month] = []
    byMonth[month].push(l)
  })
  const monthKeys = Object.keys(byMonth).sort()

  const expiredCount = leaves.filter(l =>
    (filterPerson === 'all' || l.personId === filterPerson) && l.endDate && l.endDate < TODAY
  ).length

  // ── Leave card ────────────────────────────────────────────────
  function LeaveCard({ leave }) {
    const person = people.find(p => p.id === leave.personId)
    const d = days(leave)
    const isExpired = leave.endDate < TODAY
    return (
      <div className={`bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-start justify-between hover:shadow-sm transition-shadow ${isExpired ? 'opacity-60' : ''}`}>
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-1 h-full min-h-[36px] rounded-full flex-shrink-0 mt-0.5" style={{ backgroundColor: LEAVE_COLORS[leave.type] || '#d1d5db' }} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-800 text-sm">{person?.name || leave.personName}</span>
              <span className="text-xs px-2 py-0.5 rounded-full text-white font-medium" style={{ backgroundColor: LEAVE_COLORS[leave.type] }}>{leave.type}</span>
              <span className="text-xs text-gray-500">{d}{typeof d === 'number' ? ' 天' : ''}</span>
              {isExpired && <span className="text-xs text-gray-500">已過期</span>}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {formatTimeRange(leave)}
              {leave.note && <span className="text-gray-500 ml-2">· {leave.note}</span>}
            </p>
          </div>
        </div>
        {isManager && (
          <div className="flex gap-1.5 flex-shrink-0 ml-2">
            <button onClick={() => openEdit(leave)} className="text-xs text-blue-500 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50">編輯</button>
            <button onClick={() => setDeleteConfirm(leave.id)} className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50">刪除</button>
          </div>
        )}
      </div>
    )
  }

  const designers = people.filter(p => p.role === 'designer')
  const planners = people.filter(p => p.role !== 'designer')

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
        <div>
          <h2 className="text-xl font-bold text-gray-800">休假預排</h2>
          <p className="text-sm text-gray-500">{baseFiltered.length} 筆休假記錄</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select value={filterPerson} onChange={e => setFilterPerson(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700">
            <option value="all">全部成員</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {expiredCount > 0 && (
            <label className="flex items-center gap-1.5 text-sm text-gray-500 cursor-pointer select-none">
              <input type="checkbox" checked={showExpired} onChange={e => setShowExpired(e.target.checked)}
                className="rounded" />
              顯示過期（{expiredCount}）
            </label>
          )}
          {isManager && (
            <button onClick={openCreate}
              className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors">
              + 新增休假
            </button>
          )}
        </div>
      </div>

      {/* Leave list */}
      <div className="flex-1 overflow-auto p-6">
        {/* Type legend */}
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          {LEAVE_TYPES.map(t => (
            <div key={t} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: LEAVE_COLORS[t] }} />
              <span className="text-xs text-gray-500">{t}</span>
            </div>
          ))}
        </div>

        {monthKeys.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-gray-500">
            <div className="text-center">
              <div className="text-4xl mb-2">🏖️</div>
              <p>尚無休假記錄</p>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {monthKeys.map(ym => {
              const monthLeaves = byMonth[ym]
              const designerLeaves = monthLeaves.filter(l => {
                const p = people.find(pp => pp.id === l.personId)
                return p?.role === 'designer'
              })
              const plannerLeaves = monthLeaves.filter(l => {
                const p = people.find(pp => pp.id === l.personId)
                return !p || p.role !== 'designer'
              })
              return (
                <div key={ym}>
                  {/* Month header */}
                  <div className="flex items-center gap-3 mb-3">
                    <h3 className="text-base font-bold text-gray-700">{fmtMonth(ym)}</h3>
                    <div className="flex-1 h-px bg-gray-200" />
                    <span className="text-xs text-gray-500">{monthLeaves.length} 筆</span>
                  </div>

                  {/* Two columns */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* 設計師 */}
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-2 h-2 rounded-full bg-purple-400" />
                        <span className="text-xs font-semibold text-purple-600 uppercase tracking-wide">設計師</span>
                        {designerLeaves.length > 0 && (
                          <span className="text-xs text-gray-500">{designerLeaves.length} 筆</span>
                        )}
                      </div>
                      {designerLeaves.length === 0 ? (
                        <p className="text-xs text-gray-500 pl-4">本月無休假</p>
                      ) : (
                        <div className="space-y-2">
                          {designerLeaves.map(l => <LeaveCard key={l.id} leave={l} />)}
                        </div>
                      )}
                    </div>

                    {/* Planner */}
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-2 h-2 rounded-full bg-teal-400" />
                        <span className="text-xs font-semibold text-teal-600 uppercase tracking-wide">Planner</span>
                        {plannerLeaves.length > 0 && (
                          <span className="text-xs text-gray-500">{plannerLeaves.length} 筆</span>
                        )}
                      </div>
                      {plannerLeaves.length === 0 ? (
                        <p className="text-xs text-gray-500 pl-4">本月無休假</p>
                      ) : (
                        <div className="space-y-2">
                          {plannerLeaves.map(l => <LeaveCard key={l.id} leave={l} />)}
                        </div>
                      )}
                    </div>
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-800">{editLeave ? '編輯休假' : '新增休假'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {/* Person */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">成員 *</label>
                <select value={form.personId} onChange={e => setForm(f => ({ ...f, personId: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                  <option value="">請選擇成員</option>
                  <optgroup label="設計師">
                    {designers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </optgroup>
                  <optgroup label="Planner">
                    {planners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </optgroup>
                </select>
              </div>
              {/* Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">假別</label>
                <div className="flex flex-wrap gap-2">
                  {LEAVE_TYPES.map(t => (
                    <button key={t} onClick={() => setForm(f => ({ ...f, type: t }))}
                      className={`px-3 py-1.5 text-sm rounded-lg border-2 font-medium transition-colors ${form.type === t ? 'text-white border-transparent' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                      style={form.type === t ? { backgroundColor: LEAVE_COLORS[t], borderColor: LEAVE_COLORS[t] } : {}}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              {/* Date range */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">開始日 *</label>
                  <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">結束日 *</label>
                  <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
                </div>
              </div>
              {/* All-day / Specify time */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">時間範圍</label>
                <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm w-fit">
                  <button onClick={() => setForm(f => ({ ...f, allDay: true, startTime: '', endTime: '' }))}
                    className={`px-4 py-1.5 font-medium transition-colors ${form.allDay ? 'bg-purple-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                    整天
                  </button>
                  <button onClick={() => setForm(f => ({ ...f, allDay: false }))}
                    className={`px-4 py-1.5 font-medium transition-colors ${!form.allDay ? 'bg-purple-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                    指定時間
                  </button>
                </div>
                {!form.allDay && (
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    <input type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                      placeholder="開始時間"
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-600" />
                    <input type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                      placeholder="結束時間"
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-600" />
                  </div>
                )}
              </div>
              {/* Note */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">備註（選填）</label>
                <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                  placeholder="例：回國、蜜月旅行"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>
              {/* Preview */}
              {form.startDate && form.endDate && form.endDate >= form.startDate && (
                <div className="bg-purple-50 rounded-lg px-4 py-2 text-sm text-purple-700">
                  {form.allDay
                    ? form.startDate === form.endDate
                      ? `${form.startDate}（整天）`
                      : `共 ${Math.round((new Date(form.endDate) - new Date(form.startDate)) / 86400000) + 1} 天`
                    : form.startDate === form.endDate && form.startTime && form.endTime
                      ? `${form.startTime} ~ ${form.endTime}`
                      : `${form.startDate} ~ ${form.endDate}`
                  }
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t flex gap-3 justify-end">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
              <button onClick={handleSave} disabled={saving || !form.personId || !form.startDate || !form.endDate}
                className="px-5 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-40 font-medium">
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
            <p className="text-sm text-gray-500 mb-6">確定要刪除這筆休假記錄嗎？</p>
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
