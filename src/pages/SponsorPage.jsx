import { useEffect, useState } from 'react'
import { collection, onSnapshot, doc, setDoc, addDoc, updateDoc, deleteDoc, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'

// ── Payment schedule ──────────────────────────────────────────────────────────
const PAYMENT_SCHEDULE = [
  { id: '113-1', contractYear: 113, period: 1, label: '第一期款', amount: 150, dueDate: '2024-11-01' },
  { id: '113-2', contractYear: 113, period: 2, label: '第二期款', amount: 150, dueDate: '2025-03-30' },
  { id: '113-3', contractYear: 113, period: 3, label: '第三期款', amount: 70,  dueDate: '2025-07-31' },
  { id: '114-1', contractYear: 114, period: 1, label: '第一期款', amount: 150, dueDate: '2025-11-01' },
  { id: '114-2', contractYear: 114, period: 2, label: '第二期款', amount: 150, dueDate: '2026-03-30' },
  { id: '114-3', contractYear: 114, period: 3, label: '第三期款', amount: 70,  dueDate: '2026-07-31' },
  { id: '115-1', contractYear: 115, period: 1, label: '第一期款', amount: 150, dueDate: '2026-11-01' },
  { id: '115-2', contractYear: 115, period: 2, label: '第二期款', amount: 150, dueDate: '2027-03-30' },
  { id: '115-3', contractYear: 115, period: 3, label: '第三期款', amount: 70,  dueDate: '2027-07-31' },
]
const ROC_TO_GREG = { 113: 2024, 114: 2025, 115: 2026 }

// ── Advertising deliverables (from contract 廣告期程表) ───────────────────────
// ROC 114 = 2025, ROC 115 = 2026
const AD_SCHEDULE = [
  { id: 'ad01', rocDate: '114/10/6',  dueDate: '2025-10-06', leagues: 'HBL',                       item: 'LED 輪轉',             size: '請參考 PPT',           qty: null,     note: '',             star: false },
  { id: 'ad02', rocDate: '114/10/6',  dueDate: '2025-10-06', leagues: 'HBL',                       item: '預賽秩序冊廣告稿',      size: 'A5 (W14.85×H21cm)',   qty: '100份',  note: '球隊&媒體',      star: true  },
  { id: 'ad03', rocDate: '114/12/2',  dueDate: '2025-12-02', leagues: 'HBL',                       item: '複賽戰報廣告稿',        size: 'W9×H12cm',             qty: '3000份', note: '現場觀眾&媒體',  star: false },
  { id: 'ad04', rocDate: '114/12/12', dueDate: '2025-12-12', leagues: 'HVL',                       item: 'LED 輪轉',             size: '請參考 PPT',           qty: null,     note: '',             star: false },
  { id: 'ad05', rocDate: '114/12/12', dueDate: '2025-12-12', leagues: 'HVL',                       item: '球員手冊廣告稿',        size: 'A4 (W21×H29.7cm)',    qty: '200本',  note: '現場觀眾&媒體',  star: true  },
  { id: 'ad06', rocDate: '115/01/16', dueDate: '2026-01-16', leagues: 'HBL',                       item: '準決賽觀戰手冊廣告稿',  size: 'B5 (W19×H26cm)',      qty: '300本',  note: '現場觀眾&媒體',  star: false },
  { id: 'ad07', rocDate: '115/02/06', dueDate: '2026-02-06', leagues: 'HBL、HVL',                  item: '決賽戰報廣告稿',        size: 'W9×H12cm',             qty: '2000份', note: '現場觀眾&媒體',  star: false },
  { id: 'ad08', rocDate: '115/02/06', dueDate: '2026-02-06', leagues: 'HVL、JHBL、JHVL、HFL',      item: 'LED 輪轉',             size: '請參考 PPT',           qty: null,     note: '',             star: false },
  { id: 'ad09', rocDate: '115/02/06', dueDate: '2026-02-06', leagues: 'HVL、JHBL、JHVL、HFL、HSL', item: '秩序冊廣告頁',          size: 'A5 (W14.85×H21cm)',   qty: '200本',  note: '球隊&媒體',      star: true  },
  { id: 'ad10', rocDate: '115/03/27', dueDate: '2026-03-27', leagues: 'JHBL',                      item: '決賽戰報廣告稿',        size: 'W9×H12cm',             qty: '1000份', note: '',             star: false },
]

// Group AD_SCHEDULE by dueDate
const AD_GROUPS = AD_SCHEDULE.reduce((acc, item) => {
  const key = item.dueDate
  if (!acc[key]) acc[key] = { dueDate: item.dueDate, rocDate: item.rocDate, items: [] }
  acc[key].items.push(item)
  return acc
}, {})
const AD_GROUP_LIST = Object.values(AD_GROUPS).sort((a, b) => a.dueDate.localeCompare(b.dueDate))

// ── Events preset ─────────────────────────────────────────────────────────────
const EVENTS_2026 = [
  { name: '高中籃球甲級聯賽', code: 'HBL',   startDate: '2026-02-05', endDate: '2026-02-12', note: '準決賽 前8強' },
  { name: '會員大會',         code: 'CTSSF', startDate: '2026-02-25', endDate: '2026-02-26', note: '' },
  { name: '國中排球聯賽',     code: 'JHVL',  startDate: '2026-03-06', endDate: '2026-03-08', note: '' },
  { name: '足球聯賽',         code: 'HFL',   startDate: '2026-03-10', endDate: '2026-03-15', note: '' },
  { name: '高中組壘球聯賽',   code: 'HSL',   startDate: '2026-03-12', endDate: '2026-03-18', note: '' },
  { name: '高中籃球甲級聯賽', code: 'HBL',   startDate: '2026-03-21', endDate: '2026-03-22', note: '決賽' },
  { name: '國中組壘球聯賽',   code: 'HSL',   startDate: '2026-03-25', endDate: '2026-03-31', note: '' },
  { name: '高中排球聯賽',     code: 'HVL',   startDate: '2026-03-27', endDate: '2026-03-29', note: '' },
  { name: '高中籃球乙級聯賽決賽', code: 'HBL乙', startDate: '2026-04-08', endDate: '2026-04-12', note: '' },
  { name: '國中籃球聯賽',     code: 'JHBL',  startDate: '2026-04-15', endDate: '2026-04-19', note: '' },
  { name: '3*3籃球錦標賽',   code: 'CTSSF', startDate: '',            endDate: '',            note: '日期待確認' },
  { name: '熱舞大賽',         code: 'HDC',   startDate: '2026-08-29', endDate: '2026-08-29', note: '' },
]

// ── Code colors ───────────────────────────────────────────────────────────────
const CODE_COLORS = {
  'HBL':   'bg-orange-100 text-orange-700 border-orange-200',
  'HBL乙': 'bg-amber-100 text-amber-700 border-amber-200',
  'JHBL':  'bg-yellow-100 text-yellow-700 border-yellow-200',
  'HVL':   'bg-sky-100 text-sky-700 border-sky-200',
  'JHVL':  'bg-blue-100 text-blue-700 border-blue-200',
  'HSL':   'bg-green-100 text-green-700 border-green-200',
  'HFL':   'bg-emerald-100 text-emerald-700 border-emerald-200',
  'CTSSF': 'bg-purple-100 text-purple-700 border-purple-200',
  'HDC':   'bg-pink-100 text-pink-700 border-pink-200',
}
function codeColor(code) { return CODE_COLORS[code] || 'bg-gray-100 text-gray-600 border-gray-200' }

// Render league string as badge list
function LeagueBadges({ leagues }) {
  const codes = (leagues || '').split('、').map(s => s.trim()).filter(Boolean)
  return (
    <div className="flex flex-wrap gap-1">
      {codes.map(c => (
        <span key={c} className={`text-xs font-semibold px-1.5 py-0.5 rounded border ${codeColor(c)}`}>{c}</span>
      ))}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysFromToday(dateStr) {
  const t = new Date(dateStr), n = new Date()
  t.setHours(0,0,0,0); n.setHours(0,0,0,0)
  return Math.round((t - n) / 86400000)
}
function fmtRange(s, e) {
  if (!s) return null
  const sd = new Date(s), fmt = d => `${d.getMonth()+1}/${d.getDate()}`
  if (!e || e === s) return fmt(sd)
  const ed = new Date(e)
  return sd.getMonth() === ed.getMonth() ? `${sd.getMonth()+1}/${sd.getDate()}-${ed.getDate()}` : `${fmt(sd)}-${fmt(ed)}`
}
function getEventStatus(s, e) {
  if (!s) return { label: '待確認', dot: 'bg-gray-300', cls: 'bg-gray-100 text-gray-400', progress: null }
  const today = new Date(); today.setHours(0,0,0,0)
  const start = new Date(s), end = e ? new Date(e) : start
  if (today > end)  return { label: '已結束', dot: 'bg-gray-300', cls: 'bg-gray-100 text-gray-400', progress: 100 }
  if (today < start) {
    const d = Math.round((start - today) / 86400000)
    return { label: `${d} 天後`, dot: 'bg-blue-400', cls: 'bg-blue-50 text-blue-600', progress: null }
  }
  const total = Math.max(1, Math.round((end - start) / 86400000) + 1)
  const pct = Math.min(100, Math.round((Math.round((today - start) / 86400000) + 1) / total * 100))
  return { label: `進行中 ${pct}%`, dot: 'bg-orange-400', cls: 'bg-orange-100 text-orange-600', progress: pct }
}

const MONTH_ZH = ['', '一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
const emptyForm = { name: '', code: '', startDate: '', endDate: '', note: '' }

// ── Component ─────────────────────────────────────────────────────────────────
export default function SponsorPage() {
  const { isManager } = useAuth()
  const [paymentStatus, setPaymentStatus] = useState({})
  const [adStatus, setAdStatus]           = useState({})  // { ad01: { submitted, date } }
  const [events, setEvents]               = useState([])
  const [activeTab, setActiveTab]         = useState('payments')
  const [filterYear, setFilterYear]       = useState(2026)
  const [adFilter, setAdFilter]           = useState('all') // all | pending | done
  const [editingId, setEditingId]         = useState(null)
  const [editForm, setEditForm]           = useState(emptyForm)
  const [showAdd, setShowAdd]             = useState(false)
  const [addForm, setAddForm]             = useState(emptyForm)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [importing, setImporting]         = useState(false)
  const [saving, setSaving]               = useState(false)

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'hblPayments'), snap => {
      const d = {}; snap.docs.forEach(s => { d[s.id] = s.data() }); setPaymentStatus(d)
    })
    const u2 = onSnapshot(collection(db, 'hblAdStatus'), snap => {
      const d = {}; snap.docs.forEach(s => { d[s.id] = s.data() }); setAdStatus(d)
    })
    const q = query(collection(db, 'hblSchedule'), where('year', '==', filterYear))
    const u3 = onSnapshot(q, snap => {
      const items = snap.docs.map(s => ({ id: s.id, ...s.data() }))
      items.sort((a, b) => (!a.startDate ? 1 : !b.startDate ? -1 : a.startDate.localeCompare(b.startDate)))
      setEvents(items)
    })
    return () => { u1(); u2(); u3() }
  }, [filterYear])

  // ── Payment handlers ── (Firestore rules 也擋非 manager 寫入，這裡是防禦性檢查，避免前端誤觸發出 permission-denied)
  async function togglePaid(id, cur) {
    if (!isManager) return
    await setDoc(doc(db, 'hblPayments', id), { paid: !cur, paidDate: !cur ? new Date().toISOString().split('T')[0] : '' }, { merge: true })
  }

  // ── Ad submission handlers ──
  async function toggleSubmitted(adId, cur) {
    if (!isManager) return
    await setDoc(doc(db, 'hblAdStatus', adId), {
      submitted: !cur,
      submittedDate: !cur ? new Date().toISOString().split('T')[0] : '',
    }, { merge: true })
  }

  // ── Events CRUD ──
  async function handleAdd() {
    if (!isManager || !addForm.name) return
    setSaving(true)
    await addDoc(collection(db, 'hblSchedule'), { year: filterYear, name: addForm.name.trim(), code: addForm.code.trim().toUpperCase(), startDate: addForm.startDate, endDate: addForm.endDate || addForm.startDate, note: addForm.note.trim(), createdAt: new Date().toISOString() })
    setAddForm(emptyForm); setShowAdd(false); setSaving(false)
  }
  function startEdit(ev) {
    if (!isManager) return
    setEditingId(ev.id); setEditForm({ name: ev.name, code: ev.code || '', startDate: ev.startDate || '', endDate: ev.endDate || '', note: ev.note || '' }); setShowAdd(false)
  }
  async function saveEdit() {
    if (!isManager) return
    setSaving(true)
    await updateDoc(doc(db, 'hblSchedule', editingId), { name: editForm.name.trim(), code: editForm.code.trim().toUpperCase(), startDate: editForm.startDate, endDate: editForm.endDate || editForm.startDate, note: editForm.note.trim(), updatedAt: new Date().toISOString() })
    setEditingId(null); setSaving(false)
  }
  async function handleDelete(id) {
    if (!isManager) return
    await deleteDoc(doc(db, 'hblSchedule', id)); setDeleteConfirm(null)
  }
  async function importPreset() {
    if (!isManager) return
    setImporting(true)
    await Promise.all(EVENTS_2026.map(e => addDoc(collection(db, 'hblSchedule'), { year: 2026, ...e, createdAt: new Date().toISOString() })))
    setImporting(false)
  }

  // ── Stats ──
  const paidList     = PAYMENT_SCHEDULE.filter(p => paymentStatus[p.id]?.paid)
  const paidAmount   = paidList.reduce((s, p) => s + p.amount, 0)
  const overdueList  = PAYMENT_SCHEDULE.filter(p => !paymentStatus[p.id]?.paid && daysFromToday(p.dueDate) < 0)

  const submittedCount = AD_SCHEDULE.filter(a => adStatus[a.id]?.submitted).length
  const adOverdue = AD_SCHEDULE.filter(a => !adStatus[a.id]?.submitted && daysFromToday(a.dueDate) < 0)

  // filtered ad groups
  const filteredGroups = AD_GROUP_LIST.map(group => ({
    ...group,
    items: group.items.filter(item => {
      if (adFilter === 'done')    return !!adStatus[item.id]?.submitted
      if (adFilter === 'pending') return !adStatus[item.id]?.submitted
      return true
    })
  })).filter(g => g.items.length > 0)

  // ── Event form row ──
  function formRow({ form, setForm, onSave, onCancel, isNew }) {
    return (
      <div className={`px-4 py-3 border-b ${isNew ? 'bg-blue-50/40' : 'bg-yellow-50/40'}`}>
        <div className="grid gap-2 mb-2" style={{ gridTemplateColumns: '1fr 72px 110px 110px 1fr' }}>
          <div><label className="block text-xs text-gray-500 mb-0.5">賽事名稱 *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="例：高中籃球甲級聯賽"
              className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div><label className="block text-xs text-gray-500 mb-0.5">代碼</label>
            <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="HBL"
              className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div><label className="block text-xs text-gray-500 mb-0.5">開始日期</label>
            <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div><label className="block text-xs text-gray-500 mb-0.5">結束日期</label>
            <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div><label className="block text-xs text-gray-500 mb-0.5">備註</label>
            <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="例：準決賽 前8強"
              className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-200 rounded-lg">取消</button>
          <button onClick={onSave} disabled={saving || !form.name}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 font-medium">
            {saving ? '儲存中…' : isNew ? '新增' : '儲存'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
        <div>
          <h2 className="text-xl font-bold text-gray-800">高中體總贊助管理</h2>
          <p className="text-sm text-gray-400">中華民國高中體育總會 · 合約年度：民國 113–115 年（2024–2026）</p>
        </div>
        <a href="https://www.hhsaa.org.tw" target="_blank" rel="noopener noreferrer"
          className="text-sm text-blue-500 hover:text-blue-700 px-3 py-1.5 rounded-lg border border-blue-200 hover:bg-blue-50 transition-colors">
          高中體總官網 ↗
        </a>
      </div>

      {/* ── Summary cards ── */}
      <div className="px-6 py-3 grid grid-cols-5 gap-3 border-b bg-gray-50/60">
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-400">合約總金額</p>
          <p className="text-xl font-bold text-gray-800 mt-0.5">1,110 <span className="text-sm font-normal text-gray-400">萬</span></p>
          <p className="text-xs text-gray-400">3 年 · 9 期</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-400">已付款</p>
          <p className="text-xl font-bold text-emerald-600 mt-0.5">{paidAmount} <span className="text-sm font-normal text-gray-400">萬</span></p>
          <p className="text-xs text-gray-400">{paidList.length}/9 期</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-400">款項逾期</p>
          <p className={`text-xl font-bold mt-0.5 ${overdueList.length > 0 ? 'text-red-500' : 'text-gray-400'}`}>
            {overdueList.length} <span className="text-sm font-normal text-gray-400">筆</span>
          </p>
          <p className="text-xs text-gray-400">{overdueList.length > 0 ? `${overdueList.reduce((s,p)=>s+p.amount,0)} 萬元` : '全部正常 ✓'}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-400">廣告素材交稿</p>
          <p className="text-xl font-bold text-blue-600 mt-0.5">{submittedCount}<span className="text-sm font-normal text-gray-400">/{AD_SCHEDULE.length}</span></p>
          <p className="text-xs text-gray-400">已完成交稿</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-400">素材逾期</p>
          <p className={`text-xl font-bold mt-0.5 ${adOverdue.length > 0 ? 'text-red-500' : 'text-gray-400'}`}>
            {adOverdue.length} <span className="text-sm font-normal text-gray-400">筆</span>
          </p>
          <p className="text-xs text-gray-400">{adOverdue.length > 0 ? '未交稿' : '全部正常 ✓'}</p>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="px-6 bg-white border-b flex">
        {[['payments', '💳 付款進度'], ['events', '🏅 贊助賽事'], ['ads', '📁 廣告交稿']].map(([key, label]) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-auto p-6">

        {/* ══════════ PAYMENT TAB ══════════ */}
        {activeTab === 'payments' && (
          <div className="space-y-5 max-w-2xl">
            {[113, 114, 115].map(rocYear => {
              const gregYear = ROC_TO_GREG[rocYear]
              const yearPmts = PAYMENT_SCHEDULE.filter(p => p.contractYear === rocYear)
              const yearPaid = yearPmts.reduce((s, p) => s + (paymentStatus[p.id]?.paid ? p.amount : 0), 0)
              return (
                <div key={rocYear} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-800">民國 {rocYear} 年度</span>
                      <span className="text-xs text-gray-400">（{gregYear} 年合約）</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-28 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.round(yearPaid/370*100)}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 w-20 text-right">{yearPaid} / 370 萬</span>
                    </div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {yearPmts.map(payment => {
                      const pData = paymentStatus[payment.id] || {}, isPaid = !!pData.paid, days = daysFromToday(payment.dueDate)
                      let statusEl
                      if (isPaid)       statusEl = <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">✓ 已付款{pData.paidDate ? ` · ${pData.paidDate}` : ''}</span>
                      else if (days<0)  statusEl = <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full font-medium">⚠ 逾期 {Math.abs(days)} 天</span>
                      else if (days<=30) statusEl = <span className="text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full font-medium">⏰ {days} 天後到期</span>
                      else              statusEl = <span className="text-xs text-gray-400">{days} 天後到期</span>
                      return (
                        <div key={payment.id} className={`flex items-center justify-between px-5 py-3.5 ${isPaid ? 'bg-emerald-50/20' : ''}`}>
                          <div className="flex items-center gap-4">
                            {isManager ? (
                              <button onClick={() => togglePaid(payment.id, isPaid)}
                                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${isPaid ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 hover:border-emerald-400'}`}>
                                {isPaid && <span className="text-xs font-bold">✓</span>}
                              </button>
                            ) : (
                              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${isPaid ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300'}`}>
                                {isPaid && <span className="text-xs font-bold">✓</span>}
                              </div>
                            )}
                            <div>
                              <p className={`text-sm font-medium ${isPaid ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{payment.label}</p>
                              <p className="text-xs text-gray-400">到期日：{payment.dueDate}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-6">
                            {statusEl}
                            <span className={`text-base font-bold w-16 text-right ${isPaid ? 'text-gray-300' : 'text-gray-800'}`}>{payment.amount} 萬</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            <div className="bg-gray-800 rounded-xl px-5 py-4 flex items-center justify-between text-white">
              <div>
                <p className="text-sm font-semibold">合約總計</p>
                <p className="text-xs text-gray-400 mt-0.5">民國 113–115 年 · 9 期款項</p>
              </div>
              <div className="text-right">
                <p className="text-xl font-bold">{paidAmount} / 1,110 <span className="text-sm font-normal text-gray-400">萬</span></p>
                <p className="text-xs text-gray-400 mt-0.5">{paidList.length} / 9 期已付</p>
              </div>
            </div>
          </div>
        )}

        {/* ══════════ EVENTS TAB ══════════ */}
        {activeTab === 'events' && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
                {[2024, 2025, 2026].map(y => (
                  <button key={y} onClick={() => { setFilterYear(y); setEditingId(null); setShowAdd(false) }}
                    className={`px-4 py-1.5 ${filterYear === y ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                    {y} 年
                  </button>
                ))}
              </div>
              <span className="text-sm text-gray-400">{events.length} 筆賽事</span>
              {isManager && filterYear === 2026 && events.length === 0 && (
                <button onClick={importPreset} disabled={importing}
                  className="text-sm bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                  {importing ? '匯入中…' : '⬇ 匯入 2026 賽程'}
                </button>
              )}
              {isManager && (
                <button onClick={() => { setShowAdd(v => !v); setEditingId(null); setAddForm(emptyForm) }}
                  className="ml-auto text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700">
                  {showAdd ? '✕ 取消' : '+ 新增賽事'}
                </button>
              )}
            </div>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="hidden sm:grid px-4 py-2 border-b bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide"
                style={{ gridTemplateColumns: '1fr 72px 130px 110px 100px 72px' }}>
                <div>賽事名稱</div><div>代碼</div><div>賽事日期</div><div>備註</div><div>狀態</div><div className="text-right">操作</div>
              </div>
              {isManager && showAdd && formRow({ form: addForm, setForm: setAddForm, onSave: handleAdd, onCancel: () => setShowAdd(false), isNew: true })}
              {events.length === 0 && !showAdd && (
                <div className="py-16 text-center text-gray-400">
                  <div className="text-3xl mb-2">🏅</div>
                  <p className="text-sm">尚無賽程資料</p>
                  {isManager && filterYear === 2026 && <button onClick={importPreset} disabled={importing} className="mt-3 text-sm text-blue-500 hover:underline">{importing ? '匯入中…' : '一鍵匯入 2026 賽程'}</button>}
                </div>
              )}
              {events.map(ev => {
                const status = getEventStatus(ev.startDate, ev.endDate)
                const range  = fmtRange(ev.startDate, ev.endDate)
                return (
                  <div key={ev.id} className="border-b last:border-0">
                    {isManager && editingId === ev.id ? (
                      formRow({ form: editForm, setForm: setEditForm, onSave: saveEdit, onCancel: () => setEditingId(null), isNew: false })
                    ) : (
                      <div className="sm:grid px-4 py-3 items-center gap-3 hover:bg-gray-50/60"
                        style={{ gridTemplateColumns: '1fr 72px 130px 110px 100px 72px' }}>
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${status.dot}`} />
                          <span className="text-sm font-medium text-gray-800 truncate">{ev.name}</span>
                        </div>
                        <div>{ev.code && <span className={`text-xs font-semibold px-1.5 py-0.5 rounded border ${codeColor(ev.code)}`}>{ev.code}</span>}</div>
                        <div className="text-sm text-gray-700 font-mono">
                          {range ?? <span className="text-gray-300 italic text-xs">未排定</span>}
                          {ev.startDate && ev.endDate && ev.startDate !== ev.endDate && (
                            <span className="text-xs text-gray-400 ml-1">({Math.round((new Date(ev.endDate)-new Date(ev.startDate))/86400000)+1}天)</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 truncate">{ev.note || '—'}</div>
                        <div>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${status.cls}`}>{status.label}</span>
                          {status.progress !== null && status.progress < 100 && (
                            <div className="w-16 h-1 bg-gray-100 rounded-full overflow-hidden mt-1">
                              <div className="h-full bg-orange-400 rounded-full" style={{ width: `${status.progress}%` }} />
                            </div>
                          )}
                        </div>
                        <div className="flex items-center justify-end gap-1">
                          {isManager && <button onClick={() => startEdit(ev)} className="text-xs text-blue-500 hover:text-blue-700 px-1.5 py-1 rounded hover:bg-blue-50">編輯</button>}
                          {isManager && <button onClick={() => setDeleteConfirm(ev.id)} className="text-xs text-red-400 hover:text-red-600 px-1.5 py-1 rounded hover:bg-red-50">刪除</button>}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ══════════ ADS TAB ══════════ */}
        {activeTab === 'ads' && (
          <div>
            {/* Notes from contract */}
            <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-700 space-y-1">
              <p>📋 文宣品檔案：請提供 AI 檔（cs6 以下版本、出血 0.3cm，文字請轉外框）及 JPG，以便確認及製作</p>
              <p>📺 LED 檔案：若為圖片檔，請一起提供 AI 檔，以供臨時異動調整</p>
            </div>

            {/* Toolbar */}
            <div className="flex items-center gap-3 mb-4">
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
                {[['all','全部'], ['pending','待交稿'], ['done','已完成']].map(([key, label]) => (
                  <button key={key} onClick={() => setAdFilter(key)}
                    className={`px-4 py-1.5 ${adFilter === key ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <span className="text-sm text-gray-400">{submittedCount}/{AD_SCHEDULE.length} 已完成</span>
              {adOverdue.length > 0 && (
                <span className="text-xs text-red-600 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full font-medium">
                  ⚠ {adOverdue.length} 筆素材逾期未交
                </span>
              )}
            </div>

            {/* Groups by due date */}
            <div className="space-y-4">
              {filteredGroups.map(group => {
                const days   = daysFromToday(group.dueDate)
                const date   = new Date(group.dueDate)
                const monthZh = MONTH_ZH[date.getMonth() + 1]
                const allDone = group.items.every(i => adStatus[i.id]?.submitted)
                let groupBadge
                if (allDone)       groupBadge = <span className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">✓ 全部完成</span>
                else if (days < 0) groupBadge = <span className="text-xs text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full font-medium">逾期 {Math.abs(days)} 天</span>
                else if (days <= 14) groupBadge = <span className="text-xs text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full font-medium">⏰ {days} 天後截止</span>
                else               groupBadge = <span className="text-xs text-blue-500 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">{days} 天後截止</span>

                return (
                  <div key={group.dueDate} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    {/* Group header */}
                    <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b">
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-gray-800">{monthZh}</span>
                        <span className="text-sm text-gray-600">提供日期：{group.rocDate}</span>
                        <span className="text-xs text-gray-400">（{group.dueDate}）</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">{group.items.filter(i => adStatus[i.id]?.submitted).length}/{group.items.length} 完成</span>
                        {groupBadge}
                      </div>
                    </div>

                    {/* Table header */}
                    <div className="hidden sm:grid px-4 py-1.5 border-b bg-gray-50/60 text-xs font-medium text-gray-400"
                      style={{ gridTemplateColumns: '28px 1fr 130px 150px 80px 130px' }}>
                      <div></div><div>項目</div><div>聯賽</div><div>露出尺寸</div><div>數量</div><div>備註／對象</div>
                    </div>

                    {/* Item rows */}
                    <div className="divide-y divide-gray-100">
                      {group.items.map(item => {
                        const isSubmitted = !!adStatus[item.id]?.submitted
                        const sData = adStatus[item.id] || {}
                        return (
                          <div key={item.id}
                            className={`sm:grid px-4 py-3 items-center gap-3 transition-colors ${isSubmitted ? 'bg-emerald-50/30' : ''}`}
                            style={{ gridTemplateColumns: '28px 1fr 130px 150px 80px 130px' }}>

                            {/* Checkbox */}
                            {isManager ? (
                              <button onClick={() => toggleSubmitted(item.id, isSubmitted)}
                                title={isSubmitted ? '取消標記' : '標記已交稿'}
                                className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${isSubmitted ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 hover:border-emerald-400'}`}>
                                {isSubmitted && <span className="text-xs font-bold leading-none">✓</span>}
                              </button>
                            ) : (
                              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${isSubmitted ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300'}`}>
                                {isSubmitted && <span className="text-xs font-bold leading-none">✓</span>}
                              </div>
                            )}

                            {/* Item name */}
                            <div>
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-medium ${isSubmitted ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                                  {item.item}
                                </span>
                                {item.star && !isSubmitted && (
                                  <span className="text-xs bg-yellow-200 text-yellow-800 px-1.5 py-0.5 rounded font-medium">重點</span>
                                )}
                              </div>
                              {isSubmitted && sData.submittedDate && (
                                <p className="text-xs text-emerald-600 mt-0.5">已交稿 · {sData.submittedDate}</p>
                              )}
                            </div>

                            {/* Leagues */}
                            <div><LeagueBadges leagues={item.leagues} /></div>

                            {/* Size */}
                            <div className={`text-xs font-mono ${isSubmitted ? 'text-gray-300' : 'text-gray-600'}`}>{item.size}</div>

                            {/* Qty */}
                            <div>
                              {item.qty && (
                                <span className={`text-sm font-semibold ${item.star && !isSubmitted ? 'text-yellow-700 bg-yellow-100 px-1.5 py-0.5 rounded' : isSubmitted ? 'text-gray-300' : 'text-gray-700'}`}>
                                  {item.qty}
                                </span>
                              )}
                            </div>

                            {/* Note */}
                            <div className={`text-xs ${isSubmitted ? 'text-gray-300' : 'text-gray-500'}`}>
                              {item.note || '—'}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}

              {filteredGroups.length === 0 && (
                <div className="bg-white rounded-xl border border-gray-200 py-16 text-center text-gray-400">
                  <div className="text-3xl mb-2">✅</div>
                  <p className="text-sm">所有素材已完成交稿</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Delete confirm ── */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">確認刪除</h3>
            <p className="text-sm text-gray-500 mb-6">確定要刪除這筆賽事記錄嗎？</p>
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
