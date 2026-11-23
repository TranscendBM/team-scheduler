import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, doc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import CountBadge from '../components/CountBadge'
import { PRODUCT_LINES, lineMeta, categoryMeta, categoryUrl } from '../utils/newProducts'
import {
  OFFICIAL_CHECKED_AT, officialSubsOf, rowId, rowPath, subLabelOf, buildModel, summarizeByDesigner, diffOwners,
  validateRow, customSubKey, buildSeedPlan, ownerNames, ownerKey, PHOTO_METHODS, STATUSES, SEED_ROWS, CUSTOM_SUB_PREFIX,
} from '../utils/productLineOwners'

const KNOWN_ORDER = ['Sherry', 'Tingwei', 'Yuna', 'Abby']
const orderRank = (n) => { const i = KNOWN_ORDER.indexOf(n); return i === -1 ? 99 : i }

const pillClass = (active) =>
  `text-sm px-3 py-1.5 rounded-full transition-colors ${
    active ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
  }`
const smallPill = (active) =>
  `text-xs px-2.5 py-1 rounded-full border transition-colors flex items-center gap-1.5 ${
    active ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
  }`
const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

const emptyForm = { id: '', line: '', category: '', sub: '', subLabel: '', aliasesText: '', photoMethod: '', owners: [], status: 'active', note: '' }

function fmtTime(ts) {
  const d = ts?.toDate ? ts.toDate() : (typeof ts === 'string' && ts ? new Date(ts) : null)
  if (!d || Number.isNaN(d.getTime())) return '剛剛'
  return d.toLocaleString('zh-TW', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function historyText(h) {
  const from = (h.fromNames || []).join('、') || '—'
  const to = (h.toNames || []).join('、') || '—'
  switch (h.kind) {
    case 'handover': return `交接：${from} → ${to}`
    case 'owners': return `負責人：${from} → ${to}`
    case 'created': return `新增，負責人：${to}`
    case 'deleted': return `刪除此列(原負責人：${from})`
    case 'status': return h.note || '狀態變更'
    default: return h.note || h.kind
  }
}

function OwnerChips({ owners }) {
  if (!owners || owners.length === 0) return <span className="text-xs text-red-500">尚無負責人</span>
  return (
    <div className="flex gap-1 flex-wrap">
      {owners.map(o => (
        <span key={ownerKey(o)} className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">{o.name}</span>
      ))}
    </div>
  )
}

function Row({ r, canEdit, onEdit, onConfirm, onAssign, onHistory }) {
  if (r.kind === 'missing') {
    return (
      <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap bg-red-50/40">
        <div className="min-w-0">
          <p className="text-sm text-gray-700">{r.label}</p>
          <p className="text-xs text-red-500 mt-0.5">官網有這個項目，但還沒有負責設計師</p>
        </div>
        {canEdit && (
          <button onClick={() => onAssign(r)} className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium">指派負責人</button>
        )}
      </div>
    )
  }
  const d = r.doc
  const removed = d.status === 'to_remove'
  return (
    <div className={`px-4 py-3 ${removed ? 'bg-gray-50' : ''}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1" style={{ minWidth: '12rem' }}>
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`text-sm font-medium ${removed ? 'text-gray-500 line-through' : 'text-gray-800'}`}>{subLabelOf(d)}</p>
            {d.photoMethod && <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{d.photoMethod}</span>}
            {removed && <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">預計刪除</span>}
            {!d.officialListed && <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600" title="官網分類頁沒有這個項目">官網未列</span>}
            {d.confirmed !== true
              ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">待確認</span>
              : <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-100 text-green-700" title={`${d.confirmedBy || ''} 於 ${fmtTime(d.confirmedAt)} 確認`}>✓ 已確認</span>}
          </div>
          {(d.aliases || []).length > 0 && <p className="text-xs text-gray-500 mt-0.5">舊稱：{d.aliases.join('、')}</p>}
          {d.note && <p className="text-xs text-gray-500 mt-1 break-words">{d.note}</p>}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <OwnerChips owners={d.owners} />
          <div className="flex items-center gap-1">
            <button onClick={() => onHistory(d)} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100">歷史</button>
            {canEdit && (
              <>
                {d.confirmed !== true && (
                  <button onClick={() => onConfirm(d)} className="text-xs text-green-700 hover:bg-green-50 px-2 py-1 rounded">確認</button>
                )}
                <button onClick={() => onEdit(d)} className="text-xs text-blue-500 hover:text-blue-700 hover:bg-blue-50 px-2 py-1 rounded">編輯</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ProductLineOwnersPage() {
  const { isManager, email: myEmail, user } = useAuth()
  const canEdit = isManager
  const myName = user?.displayName || myEmail || ''

  const [docs, setDocs] = useState([])
  const [history, setHistory] = useState([])
  const [users, setUsers] = useState([])
  const [view, setView] = useState('line') // 'line' | 'designer'
  const [lineFilter, setLineFilter] = useState('all')
  const [designerFilter, setDesignerFilter] = useState('all')
  const [attention, setAttention] = useState('all') // all | unconfirmed | missing | notOnSite | toRemove
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [confirmAll, setConfirmAll] = useState(false)
  const [seedOpen, setSeedOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyRow, setHistoryRow] = useState(null) // { id, path } | null

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'productLineOwners'), snap => setDocs(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    const u2 = onSnapshot(collection(db, 'productLineOwnerHistory'), snap => setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return () => { u1(); u2() }
  }, [])

  // users 整表只有 manager 讀得到(安全規則)；非 manager 不訂閱，設計師名單就由資料列上的負責人推出
  useEffect(() => {
    if (!isManager) return
    const unsub = onSnapshot(collection(db, 'users'), snap => setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return () => { unsub(); setUsers([]) }
  }, [isManager])

  const designers = useMemo(() => users
    .filter(u => u.role === 'designer' && u.active !== false)
    .map(u => ({ email: u.id, name: u.displayName || u.id }))
    .sort((a, b) => orderRank(a.name) - orderRank(b.name) || a.name.localeCompare(b.name)), [users])

  const model = useMemo(() => buildModel(docs), [docs])
  const { stats } = model

  const designerNamesAll = useMemo(() => {
    const set = new Set(designers.map(d => d.name))
    for (const d of docs) for (const n of ownerNames(d.owners)) set.add(n)
    return [...set].sort((a, b) => orderRank(a) - orderRank(b) || a.localeCompare(b))
  }, [designers, docs])

  // ── 篩選 ──
  const rowVisible = (r) => {
    if (attention === 'unconfirmed' && !(r.kind === 'doc' && r.doc.confirmed !== true)) return false
    if (attention === 'missing' && r.kind !== 'missing') return false
    if (attention === 'notOnSite' && !(r.kind === 'doc' && !r.doc.officialListed)) return false
    if (attention === 'toRemove' && !(r.kind === 'doc' && r.doc.status === 'to_remove')) return false
    if (designerFilter !== 'all') {
      if (r.kind === 'missing') return false
      if (!ownerNames(r.doc.owners).includes(designerFilter)) return false
    }
    return true
  }
  const visibleLines = model.lines
    .filter(l => lineFilter === 'all' || l.key === lineFilter)
    .map(l => ({ ...l, categories: l.categories.map(c => ({ ...c, rows: c.rows.filter(rowVisible) })).filter(c => c.rows.length > 0) }))
    .filter(l => l.categories.length > 0)
  const visibleOrphans = model.orphans.filter(d => rowVisible({ kind: 'doc', doc: d }))

  // ── 新增 / 編輯 ──
  function openCreate(preset = {}) {
    setIsNew(true)
    setForm({ ...emptyForm, line: lineFilter !== 'all' ? lineFilter : '', ...preset })
    setSaveError('')
    setShowModal(true)
  }
  function openAssign(m) { // 「尚無負責人」的官網項目，帶入位置直接指派
    openCreate({ line: m.line, category: m.category, sub: m.sub })
  }
  function openEdit(d) {
    setIsNew(false)
    setForm({
      id: d.id, line: d.line, category: d.category, sub: d.sub || '', subLabel: d.subLabel || '',
      aliasesText: (d.aliases || []).join('、'), photoMethod: d.photoMethod || '', owners: d.owners || [],
      status: d.status || 'active', note: d.note || '',
    })
    setSaveError('')
    setShowModal(true)
  }

  const historyEntry = (batch, r, extra) => {
    batch.set(doc(collection(db, 'productLineOwnerHistory')), {
      rowId: r.id, rowLabel: rowPath(r), fromNames: [], toNames: [], note: '',
      by: myEmail, byName: myName, at: serverTimestamp(), ...extra,
    })
  }

  async function handleSave() {
    const sub = form.sub === '__custom' ? customSubKey(form.subLabel) : form.sub
    const draft = { ...form, sub }
    const err = validateRow(draft)
    if (err) { setSaveError(err); return }
    if (sub === CUSTOM_SUB_PREFIX) { setSaveError('請輸入項目名稱'); return }
    const id = isNew ? rowId(form.line, form.category, sub) : form.id
    const existing = docs.find(d => d.id === id)
    if (isNew && existing) { setSaveError('這個項目已經有資料了，請直接編輯那一列'); return }

    const aliases = form.aliasesText.split(/[、,，]/).map(s => s.trim()).filter(Boolean)
    const data = {
      line: form.line, category: form.category, sub, subLabel: sub.startsWith(CUSTOM_SUB_PREFIX) ? form.subLabel.trim() : '',
      aliases, photoMethod: form.photoMethod, owners: form.owners, status: form.status, note: form.note.trim(),
      // 主管親手存檔就代表看過、確認過
      confirmed: true, confirmedBy: myName, confirmedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(), updatedBy: myEmail,
    }
    const target = { id, line: data.line, category: data.category, sub: data.sub, subLabel: data.subLabel }
    setSaving(true)
    setSaveError('')
    try {
      const batch = writeBatch(db)
      if (isNew) batch.set(doc(db, 'productLineOwners', id), { ...data, createdAt: new Date().toISOString() })
      else batch.update(doc(db, 'productLineOwners', id), data)
      if (isNew) {
        historyEntry(batch, target, { kind: 'created', toNames: ownerNames(form.owners) })
      } else {
        if (diffOwners(existing.owners, form.owners).changed) {
          historyEntry(batch, target, { kind: 'owners', fromNames: ownerNames(existing.owners), toNames: ownerNames(form.owners) })
        }
        if ((existing.status || 'active') !== form.status) {
          historyEntry(batch, target, { kind: 'status', note: `狀態：${STATUSES[existing.status || 'active']} → ${STATUSES[form.status]}` })
        }
      }
      await batch.commit()
      setShowModal(false)
    } catch (e) { setSaveError('儲存失敗：' + e.message) }
    setSaving(false)
  }

  async function handleConfirm(d) {
    setActionError('')
    try {
      const batch = writeBatch(db)
      batch.update(doc(db, 'productLineOwners', d.id), { confirmed: true, confirmedBy: myName, confirmedAt: new Date().toISOString() })
      await batch.commit()
    } catch (e) { setActionError('確認失敗：' + e.message) }
  }

  async function handleConfirmAll() {
    const pending = docs.filter(d => d.confirmed !== true)
    setBusy(true)
    setActionError('')
    try {
      // Firestore 一個 batch 最多 500 筆，這裡分段送
      for (let i = 0; i < pending.length; i += 400) {
        const batch = writeBatch(db)
        for (const d of pending.slice(i, i + 400)) {
          batch.update(doc(db, 'productLineOwners', d.id), { confirmed: true, confirmedBy: myName, confirmedAt: new Date().toISOString() })
        }
        await batch.commit()
      }
      setNotice(`已確認 ${pending.length} 列`)
    } catch (e) { setActionError('全部確認失敗：' + e.message) }
    setBusy(false)
    setConfirmAll(false)
  }

  async function handleDelete(d) {
    setBusy(true)
    setActionError('')
    try {
      const batch = writeBatch(db)
      batch.delete(doc(db, 'productLineOwners', d.id))
      historyEntry(batch, d, { kind: 'deleted', fromNames: ownerNames(d.owners) })
      await batch.commit()
      setShowModal(false)
    } catch (e) { setActionError('刪除失敗：' + e.message) }
    setBusy(false)
    setDeleteTarget(null)
  }

  // 套用試算表的初始資料：全部標「待確認」；已存在的列跳過，所以重複按不會蓋掉改過的資料
  async function handleSeed() {
    setBusy(true)
    setActionError('')
    try {
      const byName = new Map(designers.map(d => [d.name.trim().toLowerCase(), d]))
      const plan = buildSeedPlan(docs.map(d => d.id), (name) => byName.get(name.toLowerCase()) || { email: '', name })
      const batch = writeBatch(db)
      const now = new Date().toISOString()
      for (const d of plan.docs) batch.set(doc(db, 'productLineOwners', d.id), { ...d.data, createdAt: now, updatedAt: now, updatedBy: myEmail })
      for (const h of plan.history) {
        batch.set(doc(collection(db, 'productLineOwnerHistory')), { ...h, by: myEmail, byName: myName, at: serverTimestamp() })
      }
      await batch.commit()
      setNotice(`已套用 ${plan.docs.length} 列(全部為「待確認」)${plan.unresolved.length ? `；找不到系統帳號的設計師：${plan.unresolved.join('、')}` : ''}`)
      setSeedOpen(false)
    } catch (e) { setActionError('套用失敗：' + e.message) }
    setBusy(false)
  }

  function toggleOwner(o) {
    setForm(f => {
      const has = f.owners.some(x => ownerKey(x) === ownerKey(o))
      return { ...f, owners: has ? f.owners.filter(x => ownerKey(x) !== ownerKey(o)) : [...f.owners, o] }
    })
  }

  const formLine = lineMeta(form.line)
  const formSubs = form.category ? officialSubsOf(form.line, form.category) : []
  const ownerOptions = [...designers, ...form.owners.filter(o => !designers.some(d => ownerKey(d) === ownerKey(o)))]

  const designerGroups = useMemo(() => summarizeByDesigner(docs, designerNamesAll), [docs, designerNamesAll])
  const shownHistory = useMemo(() => history
    .filter(h => !historyRow || h.rowId === historyRow.id)
    .sort((a, b) => (b.at?.toMillis?.() ?? Number.MAX_SAFE_INTEGER) - (a.at?.toMillis?.() ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 60), [history, historyRow])

  const chip = (key, label, count, tone) => count > 0 && (
    <button key={key} onClick={() => setAttention(attention === key ? 'all' : key)}
      className={`text-xs px-2.5 py-1 rounded-full border flex items-center gap-1.5 transition-colors ${attention === key ? 'ring-2 ring-offset-1 ring-blue-400' : ''} ${tone}`}>
      {label} <span className="font-bold">{count}</span>
    </button>
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-800">產品線負責設計師</h2>
          <p className="text-sm text-gray-500">
            新品 / Class Change 的英文 Mkt Kit(產品圖、PS/PEP、A+ Content)由誰負責。
            {!canEdit && ' 如需調整請聯絡主管。'}
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2 flex-wrap">
            {stats.unconfirmed > 0 && (
              <button onClick={() => setConfirmAll(true)} className="text-sm px-3 py-2 rounded-lg border border-green-200 text-green-700 hover:bg-green-50 font-medium">
                全部確認({stats.unconfirmed})
              </button>
            )}
            <button onClick={() => openCreate()} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">+ 新增項目</button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          {canEdit && docs.length === 0 && (
            <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
              <p className="text-sm font-medium text-blue-800">還沒有任何資料</p>
              <p className="text-xs text-blue-700 mt-1">可以先套用「產品線設計師負責表」試算表的內容({SEED_ROWS.length} 列，已對照官網分類)，全部會標成「待確認」，再逐列確認。</p>
              <button onClick={() => setSeedOpen(true)} className="mt-3 text-sm px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium">套用試算表初始資料</button>
            </div>
          )}

          {notice && (
            <div className="mb-4 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm px-4 py-2 flex items-center justify-between gap-3">
              <span>{notice}</span>
              <button onClick={() => setNotice('')} className="text-green-700 hover:text-green-900">×</button>
            </div>
          )}
          {actionError && <p className="text-red-500 text-xs mb-3">{actionError}</p>}

          {/* 與官網比對 + 待處理摘要 */}
          {docs.length > 0 && (
            <div className="mb-5 bg-white rounded-xl border border-gray-200 px-4 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500 mr-1">待處理</span>
                {chip('unconfirmed', '待確認', stats.unconfirmed, 'bg-amber-50 text-amber-700 border-amber-200')}
                {chip('missing', '官網有、尚無負責人', stats.missing, 'bg-red-50 text-red-700 border-red-200')}
                {chip('notOnSite', '官網未列', stats.notOnSite, 'bg-gray-100 text-gray-600 border-gray-200')}
                {chip('toRemove', '預計刪除', stats.toRemove, 'bg-red-50 text-red-600 border-red-200')}
                {stats.unconfirmed + stats.missing + stats.notOnSite + stats.toRemove === 0 && (
                  <span className="text-xs text-green-700">✓ 全部已確認，且與官網分類一致</span>
                )}
                {attention !== 'all' && <button onClick={() => setAttention('all')} className="text-xs text-blue-500 hover:underline ml-1">顯示全部</button>}
              </div>
              <p className="text-[11px] text-gray-500 mt-2">
                與官網比對的依據是 {OFFICIAL_CHECKED_AT} 的官網分類快照
                (<a href="https://tw.transcend-info.com/" target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">tw.transcend-info.com</a>)；官網新增或下架分類後，需要更新系統內的分類清單才會反映。
              </p>
            </div>
          )}

          {/* 檢視切換 + 篩選 */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <button onClick={() => setView('line')} className={pillClass(view === 'line')}>依產品線</button>
            <button onClick={() => setView('designer')} className={pillClass(view === 'designer')}>依設計師</button>
            {view === 'line' && <span className="w-px h-5 bg-gray-200 mx-1" />}
            {view === 'line' && (
              <>
                <button onClick={() => setLineFilter('all')} className={smallPill(lineFilter === 'all')}>全部產品線</button>
                {PRODUCT_LINES.map(l => (
                  <button key={l.key} onClick={() => setLineFilter(l.key)} className={smallPill(lineFilter === l.key)}>{l.label}</button>
                ))}
              </>
            )}
          </div>
          {view === 'line' && designerNamesAll.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mb-5">
              <span className="text-xs text-gray-500">設計師</span>
              <button onClick={() => setDesignerFilter('all')} className={smallPill(designerFilter === 'all')}>全部</button>
              {designerNamesAll.map(n => (
                <button key={n} onClick={() => setDesignerFilter(n)} className={smallPill(designerFilter === n)}>{n}</button>
              ))}
            </div>
          )}

          {view === 'line' && (
            <div className="space-y-6">
              {visibleLines.map(l => (
                <div key={l.key}>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">{l.label}</h3>
                  <div className="space-y-3">
                    {l.categories.map(c => (
                      <div key={c.key} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
                          <a href={categoryUrl(c.line, c.key)} target="_blank" rel="noreferrer"
                            className="text-sm font-medium text-gray-800 hover:text-blue-600">{c.label} <span className="text-xs text-gray-400">↗</span></a>
                          {c.covered && <span className="text-[11px] text-gray-500">此分類整體由同一組人負責，底下子分類不另列</span>}
                        </div>
                        <div className="divide-y divide-gray-100">
                          {c.rows.map(r => (
                            <Row key={r.id} r={r} canEdit={canEdit} onEdit={openEdit} onConfirm={handleConfirm} onAssign={openAssign}
                              onHistory={(d) => { setHistoryRow({ id: d.id, path: rowPath(d) }); setHistoryOpen(true) }} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {visibleOrphans.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">官網已沒有的分類</h3>
                  <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                    {visibleOrphans.map(d => (
                      <Row key={d.id} r={{ kind: 'doc', id: d.id, doc: d }} canEdit={canEdit} onEdit={openEdit} onConfirm={handleConfirm} onAssign={openAssign}
                        onHistory={(x) => { setHistoryRow({ id: x.id, path: rowPath(x) }); setHistoryOpen(true) }} />
                    ))}
                  </div>
                </div>
              )}

              {visibleLines.length === 0 && visibleOrphans.length === 0 && (
                <div className="text-center text-gray-500 text-sm py-12 bg-white rounded-xl border border-gray-100">
                  {docs.length === 0 ? '還沒有資料' : '沒有符合篩選的項目'}
                </div>
              )}
            </div>
          )}

          {view === 'designer' && (
            <div className="grid gap-3 sm:grid-cols-2">
              {designerGroups.map(g => (
                <div key={g.name} className="bg-white rounded-xl border border-gray-200 shadow-sm">
                  <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-800">{g.name}</p>
                    <CountBadge count={g.rows.length} tone={g.name === '未指派' ? 'red' : 'gray'} />
                  </div>
                  {g.rows.length === 0 ? (
                    <p className="text-xs text-gray-500 px-4 py-3">目前沒有負責的項目</p>
                  ) : (
                    <ul className="px-4 py-2 space-y-1 max-h-96 overflow-auto">
                      {g.rows
                        .slice()
                        .sort((a, b) => rowPath(a).localeCompare(rowPath(b), 'zh-TW'))
                        .map(d => (
                          <li key={d.id} className="text-xs text-gray-600 flex items-start gap-1.5">
                            <span className="text-gray-300">•</span>
                            <span className={d.status === 'to_remove' ? 'line-through text-gray-500' : ''}>
                              {categoryMeta(d.line, d.category)?.label || d.category}{d.sub ? ` › ${subLabelOf(d)}` : ''}
                            </span>
                            {d.confirmed !== true && <span className="text-[10px] px-1 rounded bg-amber-100 text-amber-700 flex-shrink-0">待確認</span>}
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 變更歷史 */}
          <div className="pt-3 mt-8 border-t border-gray-200">
            <button onClick={() => setHistoryOpen(v => !v)} className="flex items-center gap-1.5 text-xs text-gray-500 font-medium mb-3 hover:text-gray-700">
              <span className={`inline-block transition-transform ${historyOpen ? 'rotate-90' : ''}`}>▶</span>
              變更歷史 <CountBadge count={history.length} tone="gray" />
            </button>
            {historyOpen && (
              <div>
                {historyRow && (
                  <p className="text-xs text-gray-500 mb-2">
                    只顯示：{historyRow.path} <button onClick={() => setHistoryRow(null)} className="text-blue-500 hover:underline ml-1">顯示全部</button>
                  </p>
                )}
                {shownHistory.length === 0 ? (
                  <p className="text-xs text-gray-500">還沒有變更紀錄</p>
                ) : (
                  <ul className="space-y-1.5">
                    {shownHistory.map(h => (
                      <li key={h.id} className="bg-white rounded-lg border border-gray-100 px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-gray-700 font-medium">{h.rowLabel}</span>
                          <span className="text-gray-400">{fmtTime(h.at)}{h.byName ? ` · ${h.byName}` : ''}</span>
                        </div>
                        <p className="text-gray-600 mt-0.5">{historyText(h)}{h.kind === 'handover' && h.note ? `（${h.note}）` : ''}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 新增 / 編輯 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
              <h3 className="text-lg font-semibold text-gray-800">{isNew ? '新增項目' : '編輯負責人'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {isNew ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">產品線 *</label>
                    <div className="flex gap-2 flex-wrap">
                      {PRODUCT_LINES.map(l => (
                        <button key={l.key} type="button" onClick={() => setForm(f => ({ ...f, line: l.key, category: f.line === l.key ? f.category : '', sub: '' }))} className={pillClass(form.line === l.key)}>{l.label}</button>
                      ))}
                    </div>
                  </div>
                  {formLine && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">分類 *</label>
                      <div className="flex gap-2 flex-wrap">
                        {formLine.categories.map(c => (
                          <button key={c.key} type="button" onClick={() => setForm(f => ({ ...f, category: c.key, sub: '' }))}
                            className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${form.category === c.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>{c.label}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {form.category && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">子分類</label>
                      <select value={form.sub} onChange={e => setForm(f => ({ ...f, sub: e.target.value }))} className={inputCls}>
                        <option value="">整個分類</option>
                        {formSubs.map(s => <option key={s.key} value={s.key} disabled={docs.some(d => d.id === rowId(form.line, form.category, s.key))}>{s.label}</option>)}
                        <option value="__custom">其他(官網沒有的項目，例如舊產品線代號)…</option>
                      </select>
                      {form.sub === '__custom' && (
                        <input value={form.subLabel} onChange={e => setForm(f => ({ ...f, subLabel: e.target.value }))} placeholder="項目名稱，例：JetDrive" className={`${inputCls} mt-2`} />
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{rowPath(form)}</div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">負責設計師 *(可複選)</label>
                <div className="flex gap-2 flex-wrap">
                  {ownerOptions.map(o => {
                    const on = form.owners.some(x => ownerKey(x) === ownerKey(o))
                    return (
                      <button key={ownerKey(o)} type="button" onClick={() => toggleOwner(o)}
                        className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                        {o.name}{!o.email && ' (無帳號)'}
                      </button>
                    )
                  })}
                  {ownerOptions.length === 0 && <span className="text-xs text-gray-500">找不到設計師帳號，請先到「人員管理」新增</span>}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">產品照製作方式</label>
                <div className="flex gap-2">
                  {PHOTO_METHODS.map(m => (
                    <button key={m} type="button" onClick={() => setForm(f => ({ ...f, photoMethod: f.photoMethod === m ? '' : m }))} className={pillClass(form.photoMethod === m)}>{m}</button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">舊稱 / 別名(選填)</label>
                <input value={form.aliasesText} onChange={e => setForm(f => ({ ...f, aliasesText: e.target.value }))} placeholder="例：ESD、HDD · Portable HDD(用「、」隔開)" className={inputCls} />
              </div>

              {!isNew && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">狀態</label>
                  <div className="flex gap-2">
                    {Object.entries(STATUSES).map(([k, label]) => (
                      <button key={k} type="button" onClick={() => setForm(f => ({ ...f, status: k }))} className={pillClass(form.status === k)}>{label}</button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">備註(選填)</label>
                <textarea rows={3} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="例：Sherry 4/5/7 月、Yuna 8 月起" className={inputCls} />
              </div>
              <p className="text-xs text-gray-500">儲存時，負責人或狀態有變動會自動寫進變更歷史；存檔同時視為已確認。</p>
              {saveError && <p className="text-red-500 text-xs">{saveError}</p>}
            </div>
            <div className="px-6 py-4 border-t flex gap-3 justify-between sticky bottom-0 bg-white">
              <div>
                {!isNew && <button onClick={() => setDeleteTarget(docs.find(d => d.id === form.id))} className="px-3 py-2 text-sm text-red-500 hover:bg-red-50 rounded-lg">刪除此列</button>}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
                <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 font-medium">{saving ? '儲存中…' : '儲存'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">確認刪除</h3>
            <p className="text-sm text-gray-500 mb-6">確定要刪除「{rowPath(deleteTarget)}」這一列嗎？刪除會留下一筆歷史紀錄。若只是產品要下架，建議改成「預計刪除」狀態保留一陣子。</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
              <button onClick={() => handleDelete(deleteTarget)} disabled={busy} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40">刪除</button>
            </div>
          </div>
        </div>
      )}

      {confirmAll && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">全部確認</h3>
            <p className="text-sm text-gray-500 mb-6">要把目前 {stats.unconfirmed} 列「待確認」全部標成已確認嗎？建議先逐列看過再按。</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmAll(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
              <button onClick={handleConfirmAll} disabled={busy} className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-40">{busy ? '處理中…' : '全部確認'}</button>
            </div>
          </div>
        </div>
      )}

      {seedOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">套用試算表初始資料</h3>
            <ul className="text-sm text-gray-600 mb-5 space-y-1 list-disc pl-5">
              <li>會建立 {SEED_ROWS.length} 列，全部標成「待確認」。</li>
              <li>試算表標示「刪除」的 3 列(JetDrive、SJC、DBN1)會標成「預計刪除」，並標為官網未列。</li>
              <li>備註裡的 5 筆交接(例如 Yuna → Sherry)會寫進變更歷史。</li>
              <li>已存在的列不會被覆蓋，所以重複套用是安全的。</li>
            </ul>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setSeedOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
              <button onClick={handleSeed} disabled={busy} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40">{busy ? '套用中…' : '套用'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
