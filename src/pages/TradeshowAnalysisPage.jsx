import { useEffect, useState } from 'react'
import { collection, onSnapshot, doc, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { OFFICE_ORDER, sortByOfficeOrder } from '../utils/officeCurrency'
import { perBoothRentByOffice } from '../utils/boothCost'
import { copyTable } from '../utils/tableCopy'
import { dateStr } from '../utils/requestUrgency'
import { defaultAnalysisYear, boothFormatByOffice, boothSizeByOffice, costByOffice, MONTH_REGIONS, monthlyCounts, filterByOffices } from '../utils/tradeshowStats'
import { resolveRegionPlanners, plannerNames, regionKeyOfOffice } from '../utils/regionPlanners'

const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
const BAR_COLORS = ['#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#F97316', '#10B981', '#06B6D4', '#84CC16']

function totalCostUSD(p) {
  return (p.rentUSD || 0) + (p.decorUSD || 0) + (p.prUSD || 0)
}
const fmtUSD = (n) => `$${Math.round(n).toLocaleString()}`

// 頁面導覽列：[區塊 id, 顯示名稱]。之後新增圖表區塊時，在這裡加一筆、區塊加上對應 id 即可
const SECTIONS = [
  ['sec-overview', '總覽'],
  ['sec-targets', '目標達成'],
  ['sec-months', '月份分布'],
  ['sec-region-cost', '地區費用'],
  ['sec-booth-rent', '單一攤位租金'],
  ['sec-avg-pr', 'PR 費用'],
  ['sec-booth-format', '攤位形式'],
  ['sec-booth-count', '攤位數量'],
]

// 分公司 × 分類 的場數表(攤位形式、攤位數量共用)
function CrosstabTable({ data, empty }) {
  if (data.rows.length === 0) return <p className="text-sm text-gray-500 text-center py-8">{empty}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500">
          <tr>
            <th className="text-left px-3 py-2 font-medium">分公司</th>
            {data.columns.map(c => <th key={c} className="text-center px-3 py-2 font-medium whitespace-nowrap">{c}</th>)}
            <th className="text-center px-3 py-2 font-medium">合計</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {data.rows.map(r => (
            <tr key={r.office}>
              <td className="px-3 py-2 font-medium text-gray-700">{r.office}</td>
              {data.columns.map(c => (
                <td key={c} className="text-center px-3 py-2 tabular-nums">
                  {r.counts[c] ? <span className="text-gray-800">{r.counts[c]}</span> : <span className="text-gray-300">–</span>}
                </td>
              ))}
              <td className="text-center px-3 py-2 font-semibold text-gray-800 tabular-nums">{r.total}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-gray-50 font-semibold text-gray-800">
          <tr>
            <td className="px-3 py-2">全部</td>
            {data.columns.map(c => <td key={c} className="text-center px-3 py-2 tabular-nums">{data.totals[c]}</td>)}
            <td className="text-center px-3 py-2 tabular-nums">{data.total}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// 圖表的地區篩選按鈕(全部 / HQ / TW / US / EU / JPKR / CN)；選了地區會在下面標出包含的分公司與該地區 Planner
function RegionFilter({ value, onChange, plannerMap, people }) {
  const def = MONTH_REGIONS.find(r => r.key === value) || MONTH_REGIONS[0]
  const names = def.offices ? plannerNames(plannerMap, def.key, people) : []
  return (
    <div className="mb-4">
      <div className="flex flex-wrap gap-1.5">
        {MONTH_REGIONS.map(r => (
          <button key={r.key} onClick={() => onChange(r.key)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              value === r.key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}>
            {r.label}
          </button>
        ))}
      </div>
      {def.offices && (
        <p className="text-xs text-gray-500 mt-1.5">
          {def.label} 包含 {def.offices.join('、')}・Planner：{names.length ? names.join('、') : '尚未指定（到「負責人與設計師管理」設定）'}
        </p>
      )}
    </div>
  )
}

// 編輯年度目標的視窗：每個分公司一格，留空 = 沒有目標；按儲存才會寫入
function TargetEditor({ year, offices, initial, saving, onSave, onClose }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(offices.map(o => [o, initial[o] == null ? '' : String(initial[o])])))
  const sum = Object.values(draft).reduce((a, v) => a + (parseInt(v, 10) || 0), 0)
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-800">編輯 {year} 年度秀展目標</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-600 text-xl" aria-label="關閉">×</button>
        </div>
        <div className="px-6 py-5">
          <p className="text-xs text-gray-500 mb-3">填各分公司今年計畫參展的場數；留空代表不設目標。HQ（COMPUTEX 主辦單位）獨立於 TW。</p>
          <div className="space-y-2">
            {offices.map(o => (
              <label key={o} className="flex items-center gap-3">
                <span className="w-16 text-sm font-medium text-gray-700">{o}</span>
                <input type="number" min="0" value={draft[o]}
                  onChange={e => setDraft(d => ({ ...d, [o]: e.target.value }))}
                  className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <span className="text-xs text-gray-500">場</span>
              </label>
            ))}
          </div>
          <p className="text-sm font-semibold text-gray-800 mt-4">合計目標：{sum} 場</p>
        </div>
        <div className="px-6 py-4 border-t flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
          <button onClick={() => onSave(draft)} disabled={saving}
            className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 font-medium">
            {saving ? '儲存中…' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TradeshowAnalysisPage() {
  const { isManager } = useAuth()
  const [projects, setProjects] = useState([])
  const [people, setPeople] = useState([])
  const [regionCfg, setRegionCfg] = useState({})
  const [monthRegion, setMonthRegion] = useState('all')
  const [costRegion, setCostRegion] = useState('all')
  const [boothRegion, setBoothRegion] = useState('all')
  const [prRegion, setPrRegion] = useState('all')
  const [savingTarget, setSavingTarget] = useState(false)
  const [editingTargets, setEditingTargets] = useState(false)
  // 沒手動選年份時，今年的秀展都結束了就自動看明年(例如 2026 年 11 月底直接顯示 2027)
  const [pickedYear, setPickedYear] = useState(null)
  const [today] = useState(() => dateStr(new Date()))
  const year = pickedYear ?? defaultAnalysisYear(projects, today)
  const setYear = setPickedYear
  const [activeSec, setActiveSec] = useState(SECTIONS[0][0])
  const [copyState, setCopyState] = useState('idle') // 'idle' | 'copied' | 'error'
  const [chartCopyState, setChartCopyState] = useState('idle') // 'idle' | 'copied' | 'error'
  const [boothCopyState, setBoothCopyState] = useState('idle') // 'idle' | 'copied' | 'error'

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'projects'), snap =>
      setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.type === 'tradeshow')))
    const u2 = onSnapshot(collection(db, 'people'), snap =>
      setPeople(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    // 地區 → Planner 對應(在「負責人與設計師管理」設定，每年可不同)
    const u3 = onSnapshot(doc(db, 'settings', 'regionPlanners'), snap =>
      setRegionCfg(snap.exists() ? snap.data() : {}))
    return () => { u1(); u2(); u3() }
  }, [])

  // 年度目標：settings/tradeshowTargets，格式 { 年度: { 分公司: 場數 } }(更舊的格式是 { 年度: 場數 })
  const [targetsDoc, setTargetsDoc] = useState({})
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'tradeshowTargets'), snap =>
      setTargetsDoc(snap.exists() ? snap.data() : {}))
    return unsub
  }, [])
  const yearTarget = targetsDoc[String(year)]
  const legacyTarget = typeof yearTarget === 'number' ? yearTarget : null
  const targetByOffice = (yearTarget && typeof yearTarget === 'object') ? yearTarget : {}
  const target = legacyTarget !== null ? legacyTarget
    : Object.keys(targetByOffice).length > 0 ? Object.values(targetByOffice).reduce((a, b) => a + (Number(b) || 0), 0)
    : null

  // 年份按鈕：有秀展或有設目標的年度，再多給「最後一年的下一年」方便先設定下一年的目標
  const years = [...new Set([
    ...projects.map(p => p.year).filter(Boolean),
    ...Object.keys(targetsDoc).map(Number).filter(Number.isFinite),
  ])].sort()
  if (!years.includes(year)) years.push(year)
  years.sort()
  if (isManager && !years.includes(years[years.length - 1] + 1)) years.push(years[years.length - 1] + 1)

  const yearShows = projects.filter(p => p.year === year)
  const count = yearShows.length
  const pct = target ? Math.min(100, Math.round((count / target) * 100)) : null

  // 月份分布（依開始日期），可切換區域
  const regionDef = MONTH_REGIONS.find(r => r.key === monthRegion) || MONTH_REGIONS[0]
  const byMonth = monthlyCounts(yearShows, regionDef.offices)
  const maxMonthCount = Math.max(1, ...byMonth)

  // 儲存整年度目標：整個年度欄位一次覆蓋(updateDoc 會取代該年度的 map，清空的分公司才會真的被刪掉)
  async function saveTargets(draft) {
    const obj = {}
    for (const [o, v] of Object.entries(draft)) {
      const t = String(v).trim()
      if (t === '') continue
      const n = Number(t)
      if (!Number.isInteger(n) || n < 0) { alert(`${o} 的目標要填 0 以上的整數`); return }
      obj[o] = n
    }
    setSavingTarget(true)
    try {
      const ref = doc(db, 'settings', 'tradeshowTargets')
      try { await updateDoc(ref, { [String(year)]: obj }) }
      catch (e) { if (e.code === 'not-found') await setDoc(ref, { [String(year)]: obj }); else throw e }
      setEditingTargets(false)
    } catch (e) {
      alert('儲存失敗：' + (e.code || e.message))
    }
    setSavingTarget(false)
  }

  const plannerMap = resolveRegionPlanners(regionCfg, year, people)
  const plannerOfOffice = (office) => plannerNames(plannerMap, regionKeyOfOffice(office), people).join('、')
  const officesOf = (key) => (MONTH_REGIONS.find(r => r.key === key) || MONTH_REGIONS[0]).offices

  // 各 Office/地區費用比較（攤位租金+裝潢+PR 總預算 USD）
  const officeRows = costByOffice(filterByOffices(yearShows, officesOf(costRegion))) // [{office, shows, total, avg}]，依總額由高到低
  const maxOfficeCost = Math.max(1, ...officeRows.map(r => r.total))

  // 各分公司平均 PR 費用（USD，只計入有填 PR 費用的場次）
  function avgByOffice(field) {
    const sum = {}, cnt = {}
    filterByOffices(yearShows, officesOf(prRegion)).forEach(p => {
      const v = p[field]
      if (!v || v <= 0) return
      const office = p.office || '未指定'
      sum[office] = (sum[office] || 0) + v
      cnt[office] = (cnt[office] || 0) + 1
    })
    return Object.keys(sum).map(o => [o, sum[o] / cnt[o]]).sort((a, b) => b[1] - a[1])
  }
  const avgPrRows = avgByOffice('prUSD')
  const maxAvgPr = Math.max(1, ...avgPrRows.map(([, v]) => v))

  // 各分公司平均「單一攤位」租金：每場 租金÷攤位數量，再依分公司取平均
  const booth = perBoothRentByOffice(filterByOffices(yearShows, officesOf(boothRegion)))
  const maxBoothAvg = Math.max(1, ...booth.rows.map(r => r.avg))
  async function handleCopyBoothTable() {
    const money = (n) => `$${Math.round(n).toLocaleString()}`
    try {
      await copyTable({
        title: `${year} 年各分公司平均單一攤位租金(USD)`,
        headers: ['分公司', '計入場數', '平均單一攤位租金', '最低', '最高'],
        rows: booth.rows.map(r => [r.office, String(r.shows), money(r.avg), money(r.min), money(r.max)]),
        note: '每場攤位租金 ÷ 攤位數量，再依分公司取平均；只計入租金與攤位數量都有填的場次。',
      })
      setBoothCopyState('copied')
    } catch { setBoothCopyState('error') }
    setTimeout(() => setBoothCopyState('idle'), 2000)
  }

  // 攤位形式、攤位數量：分公司 × 分類 場數
  const formatTable = boothFormatByOffice(yearShows)
  const sizeTable = boothSizeByOffice(yearShows)
  const [formatCopyState, setFormatCopyState] = useState('idle')
  const [sizeCopyState, setSizeCopyState] = useState('idle')
  async function copyCrosstab(title, data, note, setState) {
    try {
      await copyTable({
        title,
        headers: ['分公司', ...data.columns, '合計'],
        rows: data.rows.map(r => [r.office, ...data.columns.map(c => (r.counts[c] ? String(r.counts[c]) : '-')), String(r.total)]),
        foot: [['全部', ...data.columns.map(c => String(data.totals[c])), String(data.total)]],
        note,
      })
      setState('copied')
    } catch { setState('error') }
    setTimeout(() => setState('idle'), 2000)
  }

  // 導覽列：捲到對應區塊；捲動時標示目前看到哪一區
  const sections = SECTIONS
  const sectionKey = sections.map(([id]) => id).join(',')
  function goTo(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActiveSec(id)
  }
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const els = sectionKey.split(',').map(id => document.getElementById(id)).filter(Boolean)
    const io = new IntersectionObserver(entries => {
      const hit = entries.find(e => e.isIntersecting)
      if (hit) setActiveSec(hit.target.id)
    }, { rootMargin: '-10% 0px -75% 0px' })
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [sectionKey])

  const totalBudget = yearShows.reduce((sum, p) => sum + totalCostUSD(p), 0)
  const missingBudget = yearShows.filter(p => totalCostUSD(p) <= 0).length

  // 各分公司目標 vs 已報名，給下面「複製表格」用（跟畫面上的長條圖算法一致）
  // goalRows：畫面上每個分公司一列(固定分公司 + 資料裡出現過的其他代碼)，沒設目標的 target 是 undefined
  const goalOffices = [...OFFICE_ORDER, ...sortByOfficeOrder([...new Set([
    ...Object.keys(targetByOffice),
    ...yearShows.map(p => p.office || '未分公司'),
  ])].filter(o => !OFFICE_ORDER.includes(o)))]
  const goalRows = goalOffices.map(office => {
    const t = targetByOffice[office]
    const c = yearShows.filter(p => (p.office || '未分公司') === office).length
    const rate = t ? Math.round((c / t) * 100) : 0
    return { office, target: t, count: c, rate }
  })
  const officeTargetRows = goalRows.filter(r => r.target != null) // 複製用：只列有設目標的

  // 複製成表格，貼到 PPT／Word／Excel 時會自動變成原生表格（HTML 表格 + 純文字雙格式），
  // 不用另外截圖或手動輸入
  async function handleCopyTargetTable() {
    const html = `<table><thead><tr><th>分公司</th><th>目標</th><th>已報名</th><th>達成率</th></tr></thead><tbody>${
      officeTargetRows.map(r => `<tr><td>${r.office}</td><td>${r.target}</td><td>${r.count}</td><td>${r.rate}%</td></tr>`).join('')
    }</tbody></table>`
    const text = [
      `${year} 年度秀展目標達成率`,
      '分公司\t目標\t已報名\t達成率',
      ...officeTargetRows.map(r => `${r.office}\t${r.target}\t${r.count}\t${r.rate}%`),
    ].join('\n')
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ])
      setCopyState('copied')
    } catch {
      // 舊瀏覽器可能不支援多格式 ClipboardItem，退回純文字（貼到 PPT 會是一段文字而非表格，但至少資料不會丟失）
      try {
        await navigator.clipboard.writeText(text)
        setCopyState('copied')
      } catch {
        setCopyState('error')
      }
    }
    setTimeout(() => setCopyState('idle'), 2000)
  }

  // 用 canvas 畫一張長條圖再存成 PNG 寫進剪貼簿——PPT 貼上會直接變成一張圖片，
  // 排版跟畫面上的「各分公司目標達成率」長條圖一致，不用另外截圖。
  async function handleCopyTargetChart() {
    if (officeTargetRows.length === 0) return
    const width = 640
    const rowHeight = 44
    const paddingTop = 56
    const paddingBottom = 20
    const height = paddingTop + officeTargetRows.length * rowHeight + paddingBottom
    const scale = 2 // 高解析度輸出，貼到 PPT 放大也不會糊
    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = height * scale
    const ctx = canvas.getContext('2d')
    ctx.scale(scale, scale)

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = '#374151'
    ctx.font = 'bold 16px "Microsoft JhengHei", "PingFang TC", sans-serif'
    ctx.fillText(`${year} 年度各分公司秀展目標達成率`, 20, 32)

    const labelWidth = 70
    const barAreaX = 20 + labelWidth
    const barAreaWidth = width - barAreaX - 20

    officeTargetRows.forEach((r, i) => {
      const y = paddingTop + i * rowHeight
      ctx.fillStyle = '#4b5563'
      ctx.font = '13px "Microsoft JhengHei", "PingFang TC", sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(r.office, 20, y + 22)

      ctx.fillStyle = '#f3f4f6'
      ctx.fillRect(barAreaX, y + 6, barAreaWidth, 24)

      const barPct = Math.max(Math.min(r.rate, 100), r.count > 0 ? 8 : 0)
      const barW = barAreaWidth * (barPct / 100)
      if (barW > 0) {
        ctx.fillStyle = r.rate >= 100 ? '#10b981' : '#3b82f6'
        ctx.fillRect(barAreaX, y + 6, barW, 24)
      }

      const label = `${r.count} / ${r.target}（${r.rate}%）`
      ctx.font = '12px "Microsoft JhengHei", "PingFang TC", sans-serif'
      if (r.count > 0) {
        ctx.fillStyle = '#ffffff'
        ctx.textAlign = 'right'
        ctx.fillText(label, barAreaX + barW - 8, y + 22)
      } else {
        ctx.fillStyle = '#9ca3af'
        ctx.textAlign = 'left'
        ctx.fillText(label, barAreaX + 8, y + 22)
      }
    })

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob) { setChartCopyState('error'); setTimeout(() => setChartCopyState('idle'), 2000); return }
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setChartCopyState('copied')
    } catch {
      setChartCopyState('error')
    }
    setTimeout(() => setChartCopyState('idle'), 2000)
  }

  return (
    <div>
      <nav className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-gray-200" aria-label="頁面導覽">
        <div className="max-w-5xl mx-auto px-8 py-2 flex items-center gap-1.5 overflow-x-auto">
          <span className="text-xs text-gray-500 shrink-0 mr-1">跳到</span>
          {sections.map(([id, label]) => (
            <button key={id} onClick={() => goTo(id)}
              className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap transition-colors ${
                activeSec === id ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </nav>
    <div className="p-8 max-w-5xl mx-auto">
      <div id="sec-overview" className="scroll-mt-14 flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-800">秀展預算分析</h1>
        <div className="flex items-center gap-1.5">
          {years.map(y => (
            <button key={y} onClick={() => setYear(y)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                year === y ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}>
              {y}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-6">{year} 年度秀展數量、月份分布與各地區費用比較</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {/* 秀展數量與目標 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-500 mb-2">秀展數量與目標</p>
          <div className="flex items-baseline gap-1.5 mb-2">
            <span className="text-3xl font-bold text-gray-800">{count}</span>
            {target != null && <span className="text-sm text-gray-500">/ {target} 場</span>}
          </div>
          {target != null ? (
            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
          ) : (
            <p className="text-xs text-gray-500">尚未設定年度目標</p>
          )}
          <button onClick={() => goTo('sec-targets')} className="text-xs text-blue-500 hover:underline mt-3 inline-block">
            {target != null ? '看各分公司達成率 →' : isManager ? '前往設定年度目標 →' : '看各分公司達成率 →'}
          </button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-500 mb-2">預算總額（USD）</p>
          <p className="text-3xl font-bold text-gray-800">{fmtUSD(totalBudget)}</p>
          <p className="text-xs text-gray-500 mt-2">{missingBudget > 0 ? `${missingBudget} 場尚無預算資料` : '資料齊全'}</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-500 mb-2">平均每場預算（USD）</p>
          <p className="text-3xl font-bold text-gray-800">
            {count - missingBudget > 0 ? fmtUSD(totalBudget / (count - missingBudget)) : '—'}
          </p>
          <p className="text-xs text-gray-500 mt-2">僅計入已有預算資料的場次</p>
        </div>
      </div>

      {/* 各分公司目標達成率 */}
      <div id="sec-targets" className="scroll-mt-14 bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-start justify-between gap-3 mb-1">
          <p className="text-sm font-semibold text-gray-700">🎯 {year} 年各分公司目標與達成率</p>
          <div className="flex flex-wrap justify-end gap-2">
            {isManager && (
              <button onClick={() => setEditingTargets(true)}
                className="text-xs px-2.5 py-1 rounded-full border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100">
                ✏️ 編輯年度目標
              </button>
            )}
            {officeTargetRows.length > 0 && (
              <>
                <button onClick={handleCopyTargetTable}
                  className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50">
                  {copyState === 'copied' ? '已複製' : copyState === 'error' ? '複製失敗' : '📋 複製表格（可貼到 PPT）'}
                </button>
                <button onClick={handleCopyTargetChart}
                  className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50">
                  {chartCopyState === 'copied' ? '已複製' : chartCopyState === 'error' ? '複製失敗' : '📊 複製長條圖（可貼到 PPT）'}
                </button>
              </>
            )}
          </div>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          達成率 = 該分公司當年度秀展場數 ÷ 目標場數；HQ(COMPUTEX 主辦單位)獨立於 TW。Planner 依「負責人與設計師管理」設定的地區對應顯示。
        </p>
        {legacyTarget !== null && (
          <div className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-700 mb-4">
            {year} 年原本的目標是舊格式（未分公司，共 {legacyTarget} 場）。{isManager ? '請按「編輯年度目標」改成依分公司設定，儲存後會取代舊格式。' : '尚未依分公司設定。'}
          </div>
        )}
        <div className="flex items-center gap-3 text-xs text-gray-500 mb-1.5">
          <span className="w-14 shrink-0">分公司</span>
          <span className="w-24 shrink-0 hidden sm:block">Planner</span>
          <span className="flex-1">進度</span>
          <span className="w-10 text-right">達成率</span>
          <span className="w-12 text-center">已報名</span>
          <span className="w-12 text-center">目標</span>
        </div>
        <div className="space-y-2">
          {goalRows.map(r => {
            const p = r.target ? Math.min(100, Math.round((r.count / r.target) * 100)) : 0
            return (
              <div key={r.office} className="flex items-center gap-3">
                <span className="w-14 text-xs font-medium text-gray-600 shrink-0">{r.office}</span>
                <span className="w-24 shrink-0 text-xs text-gray-500 truncate hidden sm:block" title={plannerOfOffice(r.office)}>{plannerOfOffice(r.office) || '—'}</span>
                <div className="flex-1 h-6 bg-gray-50 rounded overflow-hidden">
                  <div className={`h-full rounded transition-all ${p >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                    style={{ width: `${r.target ? Math.max(p, r.count > 0 ? 4 : 0) : 0}%` }} />
                </div>
                <span className="text-xs text-gray-500 w-10 text-right">{r.target ? `${r.rate}%` : '—'}</span>
                <span className="w-12 text-center text-sm text-gray-800 tabular-nums">{r.count || <span className="text-gray-300">0</span>}</span>
                <span className="w-12 text-center text-sm text-gray-700 tabular-nums">{r.target ?? <span className="text-gray-300">—</span>}</span>
              </div>
            )
          })}
          <div className="flex items-center gap-3 pt-2 mt-1 border-t border-gray-100 font-semibold text-gray-800">
            <span className="w-14 shrink-0 text-xs">合計</span>
            <span className="w-24 shrink-0 hidden sm:block" />
            <span className="flex-1" />
            <span className="w-10 text-right text-xs">{target ? `${Math.round((count / target) * 100)}%` : '—'}</span>
            <span className="w-12 text-center text-sm tabular-nums">{count}</span>
            <span className="w-12 text-center text-sm tabular-nums">{target ?? '—'}</span>
          </div>
        </div>
      </div>

      {/* 月份分布 */}
      <div id="sec-months" className="scroll-mt-14 bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-start justify-between gap-3 mb-1">
          <p className="text-sm font-semibold text-gray-700">📅 月份分布（依開始日期）</p>
          <span className="text-xs text-gray-500 shrink-0">{regionDef.label}：共 {byMonth.reduce((a, b) => a + b, 0)} 場</span>
        </div>
        <RegionFilter value={monthRegion} onChange={setMonthRegion} plannerMap={plannerMap} people={people} />
        <div className="flex items-end gap-2 h-32">
          {byMonth.map((c, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs text-gray-500">{c > 0 ? c : ''}</span>
              <div className="w-full bg-blue-100 rounded-t transition-all"
                style={{ height: `${(c / maxMonthCount) * 90}px`, backgroundColor: c > 0 ? '#3B82F6' : '#F3F4F6' }} />
              <span className="text-xs text-gray-500">{MONTH_LABELS[i]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 各地區費用比較 */}
      <div id="sec-region-cost" className="scroll-mt-14 bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <p className="text-sm font-semibold text-gray-700 mb-1">🌏 各地區費用比較（依 Office，USD）</p>
        <p className="text-xs text-gray-500 mb-3">各分公司當年度「所有秀展」的攤位租金＋裝潢費用＋PR 費用加總</p>
        <RegionFilter value={costRegion} onChange={setCostRegion} plannerMap={plannerMap} people={people} />
        {officeRows.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">目前沒有可比較的預算資料</p>
        ) : (
          <div className="space-y-2.5">
            {officeRows.map((r, i) => (
              <div key={r.office} className="flex items-center gap-3">
                <span className="w-14 text-xs font-medium text-gray-600 shrink-0">{r.office}</span>
                <div className="flex-1 h-6 bg-gray-50 rounded overflow-hidden">
                  <div className="h-full rounded flex items-center justify-end px-2 transition-all"
                    style={{ width: `${(r.total / maxOfficeCost) * 100}%`, backgroundColor: BAR_COLORS[i % BAR_COLORS.length], minWidth: '2.5rem' }}>
                    <span className="text-xs text-white font-medium whitespace-nowrap">{fmtUSD(r.total)}</span>
                  </div>
                </div>
                <span className="text-xs text-gray-500 w-40 shrink-0 text-right">{r.shows} 場・平均每場 {fmtUSD(r.avg)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 rounded-lg bg-gray-50 px-3 py-2.5 text-xs text-gray-600 leading-relaxed space-y-1">
          <p className="font-medium text-gray-700">統計規則</p>
          <p>・這是「總額」：該分公司當年度每一場秀展的（攤位租金 + 裝潢費用 + PR 費用）直接相加，所以<b>參展場次越多，總額自然越高</b>，不代表單場比較貴。要比較貴不貴，請看右側「平均每場」，或下面的「單一攤位租金」。</p>
          <p>・年度：依秀展的「年度」欄位歸年；費用都已換算成美金(USD)。</p>
          <p>・租金、裝潢、PR 三項都沒填的秀展不計入(右側場數只算有填費用的場次)；只填部分費用的，就只加有填的那幾項。</p>
          <p>・沒填分公司的歸在「未指定」。</p>
        </div>
      </div>

      {/* 各分公司平均單一攤位租金 */}
      <div id="sec-booth-rent" className="scroll-mt-14 bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-start justify-between gap-3 mb-1">
          <p className="text-sm font-semibold text-gray-700">🧱 各分公司平均單一攤位租金（USD）</p>
          {booth.rows.length > 0 && (
            <button onClick={handleCopyBoothTable}
              className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 shrink-0">
              {boothCopyState === 'copied' ? '已複製' : boothCopyState === 'error' ? '複製失敗' : '📋 複製表格（可貼到 Word / Outlook）'}
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 mb-3">每場「攤位租金 ÷ 攤位數量」，再依分公司取平均；只計入租金與攤位數量都有填的場次</p>
        <RegionFilter value={boothRegion} onChange={setBoothRegion} plannerMap={plannerMap} people={people} />
        {booth.rows.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">目前沒有同時填了租金與攤位數量的場次</p>
        ) : (
          <div className="space-y-2.5">
            {booth.rows.map((r, i) => (
              <div key={r.office} className="flex items-center gap-3">
                <span className="w-14 text-xs font-medium text-gray-600 shrink-0">{r.office}</span>
                <div className="flex-1 h-6 bg-gray-50 rounded overflow-hidden">
                  <div className="h-full rounded flex items-center justify-end px-2 transition-all"
                    style={{ width: `${(r.avg / maxBoothAvg) * 100}%`, backgroundColor: BAR_COLORS[i % BAR_COLORS.length], minWidth: '2.5rem' }}>
                    <span className="text-xs text-white font-medium whitespace-nowrap">{fmtUSD(r.avg)}</span>
                  </div>
                </div>
                <span className="text-xs text-gray-500 w-36 shrink-0 text-right">
                  {r.shows} 場{r.shows > 1 && `（${fmtUSD(r.min)}–${fmtUSD(r.max)}）`}
                </span>
              </div>
            ))}
          </div>
        )}
        {booth.skippedTotal > 0 && (
          <p className="text-xs text-gray-500 mt-3">
            另有 {booth.skippedTotal} 場未計入（缺租金 {booth.skipped.noRent}、缺攤位數量 {booth.skipped.noBooths}、兩者都缺 {booth.skipped.both}），補齊資料後會自動納入。
          </p>
        )}
      </div>

      {/* 各分公司平均 PR 費用比較 */}
      <div id="sec-avg-pr" className="scroll-mt-14 bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <p className="text-sm font-semibold text-gray-700 mb-1">📣 各分公司平均 PR 費用比較（USD）</p>
        <p className="text-xs text-gray-500 mb-3">每個分公司「平均每場」PR 預算，只計入已填 PR 費用的場次</p>
        <RegionFilter value={prRegion} onChange={setPrRegion} plannerMap={plannerMap} people={people} />
        {avgPrRows.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">目前沒有可比較的 PR 費用資料</p>
        ) : (
          <div className="space-y-2.5">
            {avgPrRows.map(([office, avg], i) => (
              <div key={office} className="flex items-center gap-3">
                <span className="w-14 text-xs font-medium text-gray-600 shrink-0">{office}</span>
                <div className="flex-1 h-6 bg-gray-50 rounded overflow-hidden">
                  <div className="h-full rounded flex items-center justify-end px-2 transition-all"
                    style={{ width: `${(avg / maxAvgPr) * 100}%`, backgroundColor: BAR_COLORS[i % BAR_COLORS.length], minWidth: '2.5rem' }}>
                    <span className="text-xs text-white font-medium whitespace-nowrap">{fmtUSD(avg)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 攤位形式統計 */}
      <div id="sec-booth-format" className="scroll-mt-14 bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-start justify-between gap-3 mb-1">
          <p className="text-sm font-semibold text-gray-700">🏗️ 攤位形式統計（Show Kit／標準／特裝，依分公司）</p>
          {formatTable.rows.length > 0 && (
            <button onClick={() => copyCrosstab(`${year} 年各分公司攤位形式場數`, formatTable, '依秀展資料的「攤位形式」欄位統計場數；沒填的歸「未填」。', setFormatCopyState)}
              className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 shrink-0">
              {formatCopyState === 'copied' ? '已複製' : formatCopyState === 'error' ? '複製失敗' : '📋 複製表格（可貼到 Word / Outlook）'}
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 mb-4">{year} 年每個分公司各種攤位形式各有幾場；「未填」是秀展資料裡還沒選攤位形式的場次，補填後會自動歸類</p>
        <CrosstabTable data={formatTable} empty="目前沒有秀展資料" />
      </div>

      {/* 攤位大小(數量)比較 */}
      <div id="sec-booth-count" className="scroll-mt-14 bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-start justify-between gap-3 mb-1">
          <p className="text-sm font-semibold text-gray-700">📐 攤位大小數量比較（1 個／2 個／3 個…，依分公司）</p>
          {sizeTable.rows.length > 0 && (
            <button onClick={() => copyCrosstab(`${year} 年各分公司攤位數量場數`, sizeTable, '依秀展資料的「攤位數量」欄位分組統計場數；沒填的歸「未填」。', setSizeCopyState)}
              className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 shrink-0">
              {sizeCopyState === 'copied' ? '已複製' : sizeCopyState === 'error' ? '複製失敗' : '📋 複製表格（可貼到 Word / Outlook）'}
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 mb-4">{year} 年每個分公司「只租 1 個攤位的有幾場、租 2 個攤位的有幾場…」；4 個以上併為一組</p>
        <CrosstabTable data={sizeTable} empty="目前沒有秀展資料" />
      </div>

      {editingTargets && (
        <TargetEditor year={year} offices={goalOffices} initial={targetByOffice} saving={savingTarget}
          onSave={saveTargets} onClose={() => setEditingTargets(false)} />
      )}
    </div>
    </div>
  )
}
