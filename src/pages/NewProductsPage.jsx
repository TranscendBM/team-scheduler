import { useEffect, useState } from 'react'
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import CountBadge from '../components/CountBadge'
import {
  PRODUCT_LINES, STAGES, PREP_TASKS, LIVE_STAGE, lineMeta, categoryMeta, categoryUrl,
  stageIndex, isLive, launchStatus, sortByLaunch, countByCategory, prepProgress, validateProduct,
} from '../utils/newProducts'

const emptyForm = { line: '', category: '', model: '', launchDate: '', note: '' }

const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 預計上線日旁的倒數標籤：逾期紅、7 天內琥珀、其餘不標
function LaunchBadge({ status }) {
  if (!status) return null
  if (status.tone === 'overdue') {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">已逾期 {status.days} 天</span>
  }
  if (status.tone === 'soon') {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
      {status.days === 0 ? '今天上線' : `${status.days} 天後上線`}
    </span>
  }
  return null
}

const pillClass = (active) =>
  `text-sm px-3 py-1.5 rounded-full transition-colors ${
    active ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
  }`

export default function NewProductsPage() {
  const { isManager, isPlanner } = useAuth()
  const canEdit = isManager || isPlanner
  const [today] = useState(localToday)
  const [products, setProducts] = useState([])
  const [lineFilter, setLineFilter] = useState('all')
  const [catFilter, setCatFilter] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [editProduct, setEditProduct] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [liveOpen, setLiveOpen] = useState(false) // 已上線區塊預設收起
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'newProducts'), snap =>
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return unsub
  }, [])

  function openCreate() {
    // 目前篩選在哪個產品線/分類，新增時就帶入，少點幾下
    setEditProduct(null)
    setForm({
      ...emptyForm,
      line: lineFilter !== 'all' ? lineFilter : '',
      category: lineFilter !== 'all' && catFilter !== 'all' ? catFilter : '',
    })
    setSaveError('')
    setShowModal(true)
  }
  function openEdit(p) {
    setEditProduct(p)
    setForm({ line: p.line, category: p.category, model: p.model || '', launchDate: p.launchDate || '', note: p.note || '' })
    setSaveError('')
    setShowModal(true)
  }

  async function handleSave() {
    const err = validateProduct(form)
    if (err) { setSaveError(err); return }
    const model = form.model.trim()
    if (products.some(p => p.id !== editProduct?.id && (p.model || '').trim().toLowerCase() === model.toLowerCase())) {
      setSaveError('這個型號已經在清單裡了')
      return
    }
    setSaveError('')
    setSaving(true)
    const base = {
      line: form.line,
      category: form.category,
      model,
      launchDate: form.launchDate,
      note: form.note.trim(),
      updatedAt: new Date().toISOString(),
    }
    try {
      if (editProduct) {
        await updateDoc(doc(db, 'newProducts', editProduct.id), base)
      } else {
        await addDoc(collection(db, 'newProducts'), {
          ...base, stage: STAGES[0].key, prep: {}, liveAt: '', createdAt: new Date().toISOString(),
        })
      }
      setShowModal(false)
    } catch (e) { setSaveError('儲存失敗：' + e.message) }
    setSaving(false)
  }

  async function patchProduct(p, patch) {
    setActionError('')
    try {
      await updateDoc(doc(db, 'newProducts', p.id), { ...patch, updatedAt: new Date().toISOString() })
    } catch (e) { setActionError('更新失敗：' + e.message) }
  }

  // 切換進度階段；到「已上線」時記下上線日，退回來就清掉
  const setStage = (p, stage) => {
    if (stage === p.stage) return
    return patchProduct(p, { stage, liveAt: stage === LIVE_STAGE ? today : '' })
  }
  const togglePrep = (p, taskKey) =>
    patchProduct(p, { prep: { ...(p.prep || {}), [taskKey]: !p.prep?.[taskKey] } })

  async function handleDelete(id) {
    try { await deleteDoc(doc(db, 'newProducts', id)) } catch (e) { setActionError('刪除失敗：' + e.message) }
    setDeleteConfirm(null)
  }

  // ── 篩選 ──────────────────────────────────────────────────────
  const activeAll = products.filter(p => !isLive(p))
  const liveAll = products.filter(isLive)
  const matches = (p) => (lineFilter === 'all' || p.line === lineFilter) && (catFilter === 'all' || p.category === catFilter)
  const activeList = sortByLaunch(activeAll.filter(matches))
  const liveList = liveAll.filter(matches).sort((a, b) => (b.liveAt || '').localeCompare(a.liveAt || ''))

  const lineCounts = Object.fromEntries(PRODUCT_LINES.map(l => [l.key, activeAll.filter(p => p.line === l.key).length]))
  const catCounts = lineFilter === 'all' ? {} : countByCategory(products, lineFilter)
  const activeLine = lineMeta(lineFilter)

  function selectLine(key) { setLineFilter(key); setCatFilter('all') }

  const formLine = lineMeta(form.line)

  function ProductCard({ p }) {
    const cat = categoryMeta(p.line, p.category)
    const status = launchStatus(p, today)
    const cur = stageIndex(p.stage)
    const prep = prepProgress(p)
    return (
      <div className={`bg-white rounded-xl border shadow-sm px-5 py-4 ${status?.tone === 'overdue' ? 'border-red-200 bg-red-50/40' : 'border-gray-200'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-gray-800 break-words">{p.model}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {lineMeta(p.line)?.label} · {cat?.label || p.category}
              {cat && (
                <a href={categoryUrl(p.line, p.category)} target="_blank" rel="noreferrer"
                  className="ml-1.5 text-blue-500 hover:underline">官網分類頁 ↗</a>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
            <span className="text-xs text-gray-500">預計上線 {p.launchDate || '未定'}</span>
            <LaunchBadge status={status} />
            {canEdit && (
              <>
                <button onClick={() => openEdit(p)} className="text-xs text-blue-500 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50">編輯</button>
                {isManager && (
                  <button onClick={() => setDeleteConfirm(p)} className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50">刪除</button>
                )}
              </>
            )}
          </div>
        </div>

        {/* 進度：5 個階段，已走過的綠、目前的藍；有編輯權限可直接點選要切到哪一步 */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {STAGES.map((s, i) => {
            const cls = i === cur
              ? 'bg-blue-600 text-white border-blue-600'
              : i < cur ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-white text-gray-500 border-gray-200'
            return (
              <button key={s.key} type="button" disabled={!canEdit} title={s.hint}
                onClick={() => setStage(p, s.key)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${cls} ${canEdit ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}>
                {i < cur ? '✓ ' : ''}{s.label}
              </button>
            )
          })}
        </div>

        {p.stage === 'prep' && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-sm text-gray-600">
            {PREP_TASKS.map(t => (
              <label key={t.key} className={`flex items-center gap-1.5 select-none ${canEdit ? 'cursor-pointer' : ''}`}>
                <input type="checkbox" checked={!!p.prep?.[t.key]} disabled={!canEdit}
                  onChange={() => togglePrep(p, t.key)} />
                <span className={p.prep?.[t.key] ? 'text-gray-500 line-through' : ''}>{t.label}</span>
              </label>
            ))}
            <span className="text-xs text-gray-500">{prep.done}/{prep.total}</span>
          </div>
        )}

        {p.note && <p className="text-xs text-gray-500 mt-3 whitespace-pre-wrap">{p.note}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
        <div>
          <h2 className="text-xl font-bold text-gray-800">新品上官網</h2>
          <p className="text-sm text-gray-500">只追蹤還沒上官網的新品，標記「已上線」後會移到下方收合區</p>
        </div>
        {canEdit && (
          <button onClick={openCreate}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
            + 新增新品
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          {/* 第一層：產品線 */}
          <div className="flex gap-2 flex-wrap mb-3">
            <button onClick={() => selectLine('all')} className={pillClass(lineFilter === 'all')}>
              全部
            </button>
            {PRODUCT_LINES.map(l => (
              <button key={l.key} onClick={() => selectLine(l.key)} className={`${pillClass(lineFilter === l.key)} flex items-center gap-1.5`}>
                {l.label}
                {lineCounts[l.key] > 0 && <CountBadge count={lineCounts[l.key]} />}
              </button>
            ))}
          </div>

          {/* 第二層：選了產品線才出現該線的分類 */}
          {activeLine && (
            <div className="flex gap-2 flex-wrap mb-5">
              <button onClick={() => setCatFilter('all')}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${catFilter === 'all' ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                全部分類
              </button>
              {activeLine.categories.map(c => (
                <button key={c.key} onClick={() => setCatFilter(c.key)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors flex items-center gap-1.5 ${catFilter === c.key ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                  {c.label}
                  {catCounts[c.key] > 0 && <CountBadge count={catCounts[c.key]} />}
                </button>
              ))}
            </div>
          )}
          {!activeLine && <div className="mb-2" />}

          {actionError && <p className="text-red-500 text-xs mb-3">{actionError}</p>}

          <div className="space-y-3">
            {activeList.map(p => <ProductCard key={p.id} p={p} />)}
            {activeList.length === 0 && (
              <div className="text-center text-gray-500 text-sm py-12 bg-white rounded-xl border border-gray-100">
                {activeAll.length === 0 ? '目前沒有準備中的新品' : '此分類目前沒有準備中的新品'}
              </div>
            )}
          </div>

          {liveList.length > 0 && (
            <div className="pt-3 mt-6 border-t border-gray-200">
              <button onClick={() => setLiveOpen(v => !v)}
                className="flex items-center gap-1.5 text-xs text-gray-500 font-medium mb-3 hover:text-gray-700">
                <span className={`inline-block transition-transform ${liveOpen ? 'rotate-90' : ''}`}>▶</span>
                已上線
                <CountBadge count={liveList.length} tone="gray" />
              </button>
              {liveOpen && (
                <div className="space-y-2">
                  {liveList.map(p => (
                    <div key={p.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center justify-between gap-3 opacity-80">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-700 break-words">{p.model}</p>
                        <p className="text-xs text-gray-500">
                          {lineMeta(p.line)?.label} · {categoryMeta(p.line, p.category)?.label || p.category}
                          {p.liveAt ? ` · ${p.liveAt} 上線` : ''}
                        </p>
                      </div>
                      {canEdit && (
                        <button onClick={() => setStage(p, STAGES[STAGES.length - 2].key)}
                          className="text-xs text-blue-500 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50 flex-shrink-0">
                          退回進行中
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 新增 / 編輯 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
              <h3 className="text-lg font-semibold text-gray-800">{editProduct ? '編輯新品' : '新增新品'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">產品線 *</label>
                <div className="flex gap-2 flex-wrap">
                  {PRODUCT_LINES.map(l => (
                    <button key={l.key} type="button"
                      onClick={() => setForm(f => ({ ...f, line: l.key, category: f.line === l.key ? f.category : '' }))}
                      className={pillClass(form.line === l.key)}>
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>

              {formLine && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">分類 *</label>
                  <div className="flex gap-2 flex-wrap">
                    {formLine.categories.map(c => (
                      <button key={c.key} type="button" onClick={() => setForm(f => ({ ...f, category: c.key }))}
                        className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${form.category === c.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">型號 *</label>
                <input value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                  placeholder="例：MTE775A／MTE775A-I"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <p className="text-xs text-gray-500 mt-1">同系列有多個型號時，用 ／ 隔開寫在同一筆</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">預計官網上線日（選填）</label>
                <input type="date" value={form.launchDate} onChange={e => setForm(f => ({ ...f, launchDate: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">備註（選填）</label>
                <textarea rows={3} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {saveError && <p className="text-red-500 text-xs">{saveError}</p>}
            </div>
            <div className="px-6 py-4 border-t flex gap-3 justify-end sticky bottom-0 bg-white">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
              <button onClick={handleSave} disabled={saving}
                className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 font-medium">
                {saving ? '儲存中…' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">確認刪除</h3>
            <p className="text-sm text-gray-500 mb-6">確定要刪除「{deleteConfirm.model}」嗎？已上線的產品請改用「已上線」標記，不需要刪除。</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
              <button onClick={() => handleDelete(deleteConfirm.id)} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">刪除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
