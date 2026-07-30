import { useEffect, useState } from 'react'
import { collection, addDoc, updateDoc, doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { getWorkStart, getLoadingLevel, LOADING_COLORS, DEFAULT_RULES } from '../utils/milestoneUtils'
import { OFFICE_CURRENCY } from '../utils/officeCurrency'

const BOOTH_FORMATS = ['標準', '特裝', '空地', 'Show Kit', 'Counter Booth']
// 狀態固定三種（原本的自由文字狀態已一次性歸類到這三種；出稿與否改用下方獨立的「出稿完畢」開關表示）
const STATUSES = ['提案通過', '進行中', '已結束']
// 展會常見市場貨幣（USD 換算功能依此比對，需為標準 ISO 代碼）
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'KRW', 'CNY', 'TWD', 'SGD', 'MYR', 'THB', 'VND', 'INR']
// 預算三組「當地金額／USD」欄位對應
const BUDGET_PAIRS = [
  ['攤位租金', 'rentLocal', 'rentUSD'],
  ['裝潢費用', 'decorLocal', 'decorUSD'],
  ['PR 總預算', 'prLocal', 'prUSD'],
]

// 數字欄位：存檔時轉數字，空字串則不寫入該欄位（避免污染舊資料/覆蓋成 0）
const NUMBER_FIELDS = [
  'boothSqm', 'rentLocal', 'rentUSD', 'decorLocal', 'decorUSD', 'prLocal', 'prUSD', 'visitors', 'exhibitors',
]

const emptyForm = {
  name: '', status: '提案通過', startDate: '', endDate: '', location: '', showType: '', office: '',
  year: new Date().getFullYear(), assignments: [], boothSize: '', artworkDone: false,
  boothFormat: '', boothDimensions: '', boothSqm: '', currency: '',
  rentLocal: '', rentUSD: '', decorLocal: '', decorUSD: '', prLocal: '', prUSD: '',
  visitors: '', exhibitors: '',
}

function formFromProject(p) {
  if (!p) return { ...emptyForm, year: new Date().getFullYear() }
  return {
    name: p.name || '', status: p.status || '提案通過', startDate: p.startDate || '', endDate: p.endDate || '',
    location: p.location || '', showType: p.showType || '', office: p.office || '',
    year: p.year || new Date().getFullYear(), assignments: p.assignments || [],
    boothSize: p.boothSize || '', artworkDone: !!p.artworkDone,
    boothFormat: p.boothFormat || '', boothDimensions: p.boothDimensions || '',
    boothSqm: p.boothSqm ?? '', currency: p.currency || '',
    rentLocal: p.rentLocal ?? '', rentUSD: p.rentUSD ?? '',
    decorLocal: p.decorLocal ?? '', decorUSD: p.decorUSD ?? '',
    prLocal: p.prLocal ?? '', prUSD: p.prUSD ?? '',
    visitors: p.visitors ?? '', exhibitors: p.exhibitors ?? '',
  }
}

const hasBudgetData = (p) => !!p && (NUMBER_FIELDS.some(k => p[k] !== undefined && p[k] !== null && p[k] !== '') || !!p.boothFormat)

// 秀展新增/編輯彈窗（獨立於一般專案，供秀展相關頁面共用）。
// props: project（編輯目標，null=新增）、people、rules、onClose、onSaved（儲存後回呼，傳回最新 doc id）、
//   readOnly（非 manager 檢視:所有欄位唯讀、不顯示儲存鈕 —— Firestore 規則本來就只允許 manager 寫 projects，這裡只是配合的唯讀 UI)
export default function TradeshowEditModal({ project, people, rules, onClose, onSaved, readOnly = false }) {
  const [form, setForm] = useState(formFromProject(project))
  const [showBudget, setShowBudget] = useState(hasBudgetData(project))
  const [saving, setSaving] = useState(false)
  const [fx, setFx] = useState(null) // settings/exchangeRates：{ base, rates: {EUR:.., ...}, date }

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'exchangeRates'), snap => {
      setFx(snap.exists() ? snap.data() : null)
    })
    return unsub
  }, [])

  // 用今日(或最近一次抓取的)匯率把當地金額換算成 USD；USD=USD 不需換算
  function computeUSD(localValue, code) {
    const local = parseFloat(localValue)
    if (!local || local <= 0) return null
    if (code === 'USD') return local
    if (!fx || !code) return null
    const rate = fx.rates?.[code]
    if (!rate) return null
    return Math.round((local / rate) * 100) / 100
  }

  // 當地金額變動時，同步重算對應的 USD 欄位（能算就自動填，不用手動按套用）
  function updateLocalAmount(localKey, usdKey, value) {
    setForm(f => {
      const computed = computeUSD(value, f.currency)
      return { ...f, [localKey]: value, ...(computed !== null ? { [usdKey]: computed } : {}) }
    })
  }

  // 貨幣別（含依 office 自動帶入時）變動時，重算全部三組 USD 欄位
  function recomputeAllUSD(f, code) {
    const next = { ...f, currency: code }
    for (const [, localKey, usdKey] of BUDGET_PAIRS) {
      const computed = computeUSD(f[localKey], code)
      if (computed !== null) next[usdKey] = computed
    }
    return next
  }

  const designers = people.filter(p => p.role === 'designer')
  const planners = people.filter(p => p.role === 'planner')
  const canSave = !!form.name && !!form.startDate && !!form.endDate

  function toggleAssignment(personId, role) {
    const existing = form.assignments.findIndex(a => a.personId === personId)
    if (existing >= 0) {
      setForm(f => ({ ...f, assignments: f.assignments.filter((_, i) => i !== existing) }))
    } else {
      setForm(f => ({ ...f, assignments: [...f.assignments, { personId, role }] }))
    }
  }

  async function handleSave() {
    if (readOnly || !canSave) return
    setSaving(true)
    const data = {
      name: form.name, type: 'tradeshow', subtype: '', status: form.status,
      startDate: form.startDate, endDate: form.endDate,
      location: form.location, showType: form.showType, office: form.office,
      year: parseInt(form.year), assignments: form.assignments,
      boothSize: form.boothSize ? parseInt(form.boothSize) : null,
      artworkDone: !!form.artworkDone,
      boothFormat: form.boothFormat, boothDimensions: form.boothDimensions, currency: form.currency,
      updatedAt: new Date().toISOString(),
    }
    for (const key of NUMBER_FIELDS) {
      if (form[key] !== '') data[key] = parseFloat(form[key])
    }
    try {
      if (project) {
        await updateDoc(doc(db, 'projects', project.id), data)
        onSaved?.(project.id)
      } else {
        data.createdAt = new Date().toISOString()
        const ref = await addDoc(collection(db, 'projects'), data)
        onSaved?.(ref.id)
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const loadingLevel = getLoadingLevel(form.boothSize, form.name)
  const loadingStyle = loadingLevel ? LOADING_COLORS[loadingLevel] : null

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white z-10">
          <h3 className="text-lg font-semibold text-gray-800">{readOnly ? '檢視秀展' : project ? '編輯秀展' : '新增秀展'}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-600 text-xl">×</button>
        </div>
        <fieldset disabled={readOnly} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">秀展名稱 *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="例：Computex 2026"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

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
            <label className="block text-sm font-medium text-gray-700 mb-1">狀態</label>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <p className="text-xs text-gray-500 mt-1">結束日期一過，展覽列表會自動顯示「已結束」，不用手動改</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">地點</label>
            <input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
              placeholder="例：Taipei, TW"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">秀展類型</label>
              <input value={form.showType} onChange={e => setForm(f => ({ ...f, showType: e.target.value }))}
                placeholder="例：Automation"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">負責 Office</label>
              <input value={form.office} onChange={e => {
                const office = e.target.value
                setForm(f => {
                  const mapped = OFFICE_CURRENCY[office.trim().toUpperCase()]
                  const prevMapped = OFFICE_CURRENCY[(f.office || '').trim().toUpperCase()]
                  // 貨幣別是空的，或還跟著舊 office 走，才自動帶新 office 的貨幣（不覆蓋手動選過的貨幣）
                  const currencyFollowsOffice = !f.currency || f.currency === prevMapped
                  return currencyFollowsOffice && mapped ? { ...recomputeAllUSD(f, mapped), office } : { ...f, office }
                })
              }}
                placeholder="例：TW、US"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">攤位數量</label>
              <input type="number" min="0" value={form.boothSize}
                onChange={e => setForm(f => ({ ...f, boothSize: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          {loadingLevel && (
            <div className="rounded-lg px-4 py-2 text-sm font-medium"
              style={{ backgroundColor: loadingStyle.bg, color: loadingStyle.text }}>
              Loading：{loadingLevel}（{form.name?.toUpperCase().includes('COMPUTEX') ? 'COMPUTEX 固定高度' : `${form.boothSize} 攤位`}）
            </div>
          )}

          {/* 預算與規格 */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <button type="button" onClick={() => setShowBudget(v => !v)}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 text-sm font-medium text-gray-600 transition-colors">
              <span>💰 預算與規格（選填）</span>
              <span className="text-xs text-gray-500">{showBudget ? '收合 ▲' : '展開 ▼'}</span>
            </button>
            {showBudget && (
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">攤位形式</label>
                    <select value={form.boothFormat} onChange={e => setForm(f => ({ ...f, boothFormat: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm">
                      <option value="">未指定</option>
                      {BOOTH_FORMATS.map(bf => <option key={bf} value={bf}>{bf}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">攤位尺寸</label>
                    <input value={form.boothDimensions} onChange={e => setForm(f => ({ ...f, boothDimensions: e.target.value }))}
                      placeholder="例：3m x 3m"
                      className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">面積 m²</label>
                    <input type="number" min="0" step="0.1" value={form.boothSqm}
                      onChange={e => setForm(f => ({ ...f, boothSqm: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">當地貨幣別</label>
                  <select value={form.currency} onChange={e => setForm(f => recomputeAllUSD(f, e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm">
                    <option value="">未指定</option>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    {!form.currency ? '依負責 Office 自動帶入，也可手動改選'
                      : form.currency === 'USD' ? '美金當地金額即 USD，不需換算'
                      : !fx ? '匯率資料尚未取得（每日自動更新）'
                      : fx.rates?.[form.currency] ? `今日匯率（${fx.date}）：1 USD ≈ ${fx.rates[form.currency]} ${form.currency}，下方 USD 已自動換算`
                      : '此貨幣別無自動匯率資料（僅供標示，需手動填 USD）'}
                  </p>
                </div>
                {BUDGET_PAIRS.map(([label, localKey, usdKey]) => (
                  <div key={localKey} className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">{label}（當地貨幣）</label>
                      <input type="number" min="0" value={form[localKey]}
                        onChange={e => updateLocalAmount(localKey, usdKey, e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">{label}（USD）</label>
                      <input type="number" min="0" value={form[usdKey]}
                        onChange={e => setForm(f => ({ ...f, [usdKey]: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
                    </div>
                  </div>
                ))}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">參觀人次 Visitors</label>
                    <input type="number" min="0" value={form.visitors}
                      onChange={e => setForm(f => ({ ...f, visitors: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">參展商數 Exhibitor</label>
                    <input type="number" min="0" value={form.exhibitors}
                      onChange={e => setForm(f => ({ ...f, exhibitors: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => setForm(f => ({ ...f, artworkDone: !f.artworkDone }))}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border-2 transition-colors w-full justify-center ${
              form.artworkDone ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}>
            {form.artworkDone ? '✓ 已出稿完畢' : '出稿完畢'}
          </button>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">年份</label>
            <input type="number" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
                      <button key={p.id} onClick={() => toggleAssignment(p.id, 'designer')}
                        className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${selected ? 'bg-purple-600 text-white border-purple-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
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
                      <button key={p.id} onClick={() => toggleAssignment(p.id, 'planner')}
                        className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${selected ? 'bg-teal-600 text-white border-teal-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                        {p.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            {people.length === 0 && <p className="text-sm text-gray-500">請先在「人員管理」新增成員</p>}
          </div>

          {form.startDate && form.assignments.length > 0 && (
            <div className="bg-blue-50 rounded-lg p-3">
              <p className="text-xs font-medium text-blue-700 mb-2">自動計算工作區間預覽</p>
              {form.assignments.map(a => {
                const person = people.find(pe => pe.id === a.personId)
                if (!person) return null
                const workStart = getWorkStart(form.startDate, a.role, rules || DEFAULT_RULES)
                return (
                  <p key={a.personId} className="text-xs text-blue-600">
                    {person.name} ({a.role === 'designer' ? '設計師' : 'Planner'})：
                    {workStart.toLocaleDateString('zh-TW')} ~ {form.endDate}
                  </p>
                )
              })}
            </div>
          )}
        </fieldset>
        <div className="px-6 py-4 border-t flex gap-3 justify-end sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
            {readOnly ? '關閉' : '取消'}
          </button>
          {!readOnly && (
            <button onClick={handleSave} disabled={saving || !canSave}
              className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 font-medium">
              {saving ? '儲存中…' : '儲存'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
