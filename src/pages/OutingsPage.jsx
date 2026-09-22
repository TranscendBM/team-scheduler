import { useEffect, useState } from 'react'
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import PageHeader from '../components/ui/PageHeader'
import ModalShell from '../components/ui/ModalShell'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import EmptyState from '../components/ui/EmptyState'

const emptyForm = { personId: '', dates: [''], time: '', timeTBD: false, note: '' }

const TODAY = new Date().toISOString().split('T')[0]

// 半小時一格，06:00 ~ 22:00(外出/布展常見的時段範圍)
const TIME_OPTIONS = Array.from({ length: 33 }, (_, i) => {
  const totalMinutes = 6 * 60 + i * 30
  const h = String(Math.floor(totalMinutes / 60)).padStart(2, '0')
  const m = String(totalMinutes % 60).padStart(2, '0')
  return `${h}:${m}`
})
const TIME_TBD = '時間未定'

function fmtMonth(ym) {
  const [y, m] = ym.split('-')
  return `${y} 年 ${parseInt(m)} 月`
}

export default function OutingsPage() {
  const { isManager } = useAuth()
  const [people, setPeople] = useState([])
  const [outings, setOutings] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editOuting, setEditOuting] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [filterPerson, setFilterPerson] = useState('all')
  const [showExpired, setShowExpired] = useState(false)

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'people'), snap =>
      setPeople(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name))))
    const u2 = onSnapshot(collection(db, 'outings'), snap =>
      setOutings(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return () => { u1(); u2() }
  }, [])

  function openCreate() { setEditOuting(null); setForm(emptyForm); setSaveError(''); setShowModal(true) }
  function openEdit(o) {
    setEditOuting(o)
    const isTBD = o.time === TIME_TBD
    setForm({ personId: o.personId, dates: [o.date], time: isTBD ? '' : (o.time || ''), timeTBD: isTBD, note: o.note || '' })
    setSaveError('')
    setShowModal(true)
  }

  // 一次可以幫同一位同仁登記多天外出(例如「10/13、10/19 展前一天都會外出」)，
  // 每天各自建立一筆記錄(各自獨立判斷「前一天」該不該寄提醒信)，但共用同一段說明文字，
  // 不用同樣的內容重複輸入好幾次。編輯模式僅針對單一筆記錄，所以只顯示一個日期欄位。
  function addDateField() { setForm(f => ({ ...f, dates: [...f.dates, ''] })) }
  function removeDateField(i) { setForm(f => ({ ...f, dates: f.dates.filter((_, idx) => idx !== i) })) }
  function setDateField(i, v) { setForm(f => ({ ...f, dates: f.dates.map((d, idx) => idx === i ? v : d) })) }

  async function handleSave() {
    const validDates = [...new Set(form.dates.map(d => d.trim()).filter(Boolean))]
    if (!form.personId) { setSaveError('請選擇成員'); return }
    if (validDates.length === 0) { setSaveError('請至少填一個日期'); return }
    if (!form.note.trim()) { setSaveError('請填寫外出內容'); return }
    setSaveError('')
    setSaving(true)
    const person = people.find(p => p.id === form.personId)
    const base = {
      personId: form.personId,
      personName: person?.name || '',
      personEmail: (person?.email || '').trim().toLowerCase(),
      time: form.timeTBD ? TIME_TBD : form.time,
      note: form.note.trim(),
      updatedAt: new Date().toISOString(),
    }
    try {
      if (editOuting) {
        await updateDoc(doc(db, 'outings', editOuting.id), { ...base, date: validDates[0] })
      } else {
        await Promise.all(validDates.map(date =>
          addDoc(collection(db, 'outings'), { ...base, date, createdAt: new Date().toISOString() })
        ))
      }
      setShowModal(false)
    } catch (err) { setSaveError('儲存失敗：' + err.message) }
    setSaving(false)
  }

  async function handleDelete(id) { await deleteDoc(doc(db, 'outings', id)); setDeleteConfirm(null) }

  // ── Filter ──────────────────────────────────────────────────────
  const baseFiltered = outings
    .filter(o => filterPerson === 'all' || o.personId === filterPerson)
    .filter(o => showExpired || !o.date || o.date >= TODAY)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))

  // ── Group by month ────────────────────────────────────────────
  const byMonth = {}
  baseFiltered.forEach(o => {
    const month = o.date?.slice(0, 7) || '未知'
    if (!byMonth[month]) byMonth[month] = []
    byMonth[month].push(o)
  })
  const monthKeys = Object.keys(byMonth).sort()

  const expiredCount = outings.filter(o =>
    (filterPerson === 'all' || o.personId === filterPerson) && o.date && o.date < TODAY
  ).length

  // ── Outing card ────────────────────────────────────────────────
  function OutingCard({ outing }) {
    const person = people.find(p => p.id === outing.personId)
    const isExpired = outing.date < TODAY
    return (
      <div className={`bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-start justify-between gap-2 hover:shadow-sm transition-shadow min-w-0 ${isExpired ? 'opacity-60' : ''}`}>
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-1 h-full min-h-[36px] rounded-full flex-shrink-0 mt-0.5 bg-blue-400" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-800 text-sm">{person?.name || outing.personName}</span>
              <span className="text-xs text-gray-500">{outing.date}{outing.time ? ` · ${outing.time}` : ''}</span>
              {isExpired && <span className="text-xs text-gray-500">已過期</span>}
              {!outing.personEmail && (
                <span className="text-xs text-amber-600" title="這位成員沒有登記公司信箱，前一天提醒信將只會寄給主管">
                  ⚠️ 無法通知本人
                </span>
              )}
            </div>
            {outing.note && <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap break-words">{outing.note}</p>}
          </div>
        </div>
        {isManager && (
          <div className="flex gap-1.5 flex-shrink-0">
            <button onClick={() => openEdit(outing)} className="text-xs text-blue-500 hover:text-blue-700 px-2 py-2 min-h-[36px] rounded hover:bg-blue-50">編輯</button>
            <button onClick={() => setDeleteConfirm(outing.id)} className="text-xs text-red-400 hover:text-red-600 px-2 py-2 min-h-[36px] rounded hover:bg-red-50">刪除</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Header */}
      <PageHeader
        title="外出通知"
        subtitle={`${baseFiltered.length} 筆外出記錄，提前 3 天會彙整提醒主管、前一天會提醒當事人本人`}
        actions={
          <>
            <select value={filterPerson} onChange={e => setFilterPerson(e.target.value)}
              aria-label="篩選成員"
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 min-h-[44px] bg-white text-gray-700">
              <option value="all">全部成員</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {expiredCount > 0 && (
              <label className="flex items-center gap-1.5 text-sm text-gray-500 cursor-pointer select-none px-1 py-2 min-h-[44px]">
                <input type="checkbox" checked={showExpired} onChange={e => setShowExpired(e.target.checked)}
                  className="rounded" />
                顯示過期（{expiredCount}）
              </label>
            )}
            {isManager && (
              <button onClick={openCreate}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 min-h-[44px] rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                + 新增外出
              </button>
            )}
          </>
        }
      />

      {/* Outing list */}
      <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-6">
        {monthKeys.length === 0 ? (
          <EmptyState icon="🚗" title="尚無外出記錄" />
        ) : (
          <div className="space-y-8">
            {monthKeys.map(ym => (
              <div key={ym}>
                <div className="flex items-center gap-3 mb-3">
                  <h3 className="text-base font-bold text-gray-700">{fmtMonth(ym)}</h3>
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-xs text-gray-500">{byMonth[ym].length} 筆</span>
                </div>
                <div className="space-y-2">
                  {byMonth[ym].map(o => <OutingCard key={o.id} outing={o} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <ModalShell
          onClose={() => setShowModal(false)}
          title={editOuting ? '編輯外出' : '新增外出'}
          maxWidth="max-w-md"
          footer={
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 sm:justify-end">
              <button onClick={() => setShowModal(false)} className="w-full sm:w-auto px-4 py-2.5 min-h-[44px] text-sm text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200 sm:border-0">取消</button>
              <button onClick={handleSave} disabled={saving}
                className="w-full sm:w-auto px-5 py-2.5 min-h-[44px] text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 font-medium">
                {saving ? '儲存中…' : '儲存'}
              </button>
            </div>
          }
        >
              {/* Person */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">成員 *</label>
                <select value={form.personId} onChange={e => setForm(f => ({ ...f, personId: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">請選擇成員</option>
                  {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {form.personId && !people.find(p => p.id === form.personId)?.email && (
                  <p className="text-xs text-amber-600 mt-1">這位成員沒有登記公司信箱，前一天提醒信將只會寄給主管</p>
                )}
              </div>
              {/* Dates */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {editOuting ? '日期 *' : '日期 *（可新增多天，共用同一段內容）'}
                </label>
                <div className="space-y-2">
                  {form.dates.map((d, i) => (
                    <div key={i} className="flex gap-2">
                      <input type="date" value={d} onChange={e => setDateField(i, e.target.value)}
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      {!editOuting && form.dates.length > 1 && (
                        <button onClick={() => removeDateField(i)} aria-label="移除這個日期"
                          className="shrink-0 w-11 h-11 flex items-center justify-center rounded-lg text-gray-500 hover:text-red-500 hover:bg-gray-100">×</button>
                      )}
                    </div>
                  ))}
                </div>
                {!editOuting && (
                  <button onClick={addDateField} className="text-xs text-blue-500 hover:underline mt-2 py-2 min-h-[36px]">+ 新增日期</button>
                )}
              </div>
              {/* Time */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">時間（選填）</label>
                <select value={form.time} disabled={form.timeTBD}
                  onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400">
                  <option value="">請選擇時間</option>
                  {form.time && !TIME_OPTIONS.includes(form.time) && <option value={form.time}>{form.time}</option>}
                  {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <label className="flex items-center gap-1.5 text-xs text-gray-500 mt-2 py-2 min-h-[40px] cursor-pointer select-none">
                  <input type="checkbox" checked={form.timeTBD}
                    onChange={e => setForm(f => ({ ...f, timeTBD: e.target.checked }))} />
                  <span className="break-words">時間未定（會再跟大會/客戶確認）</span>
                </label>
              </div>
              {/* Note */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">外出內容 *</label>
                <textarea rows={3} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                  placeholder="例：會和業務外出去布展"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {saveError && <p className="text-red-500 text-xs break-words">{saveError}</p>}
        </ModalShell>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <ConfirmDialog
          message="確定要刪除這筆外出記錄嗎？"
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={() => handleDelete(deleteConfirm)}
        />
      )}
    </div>
  )
}
