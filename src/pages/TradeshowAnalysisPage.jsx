import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, onSnapshot, doc } from 'firebase/firestore'
import { db } from '../firebase'
import { sortByOfficeOrder } from '../utils/officeCurrency'
import { perBoothRentByOffice } from '../utils/boothCost'
import { copyTable } from '../utils/tableCopy'
import { dateStr } from '../utils/requestUrgency'
import { defaultAnalysisYear, boothFormatByOffice, boothSizeByOffice, costByOffice } from '../utils/tradeshowStats'

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
  ['sec-booth-format', '攤位形式'],
  ['sec-booth-count', '攤位數量'],
  ['sec-avg-rent', '每場租金'],
  ['sec-avg-pr', 'PR 費用'],
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

export default function TradeshowAnalysisPage() {
  const [projects, setProjects] = useState([])
  // 沒手動選年份時，今年的秀展都結束了就自動看明年(例如 2026 年 11 月底直接顯示 2027)
  const [pickedYear, setPickedYear] = useState(null)
  const [today] = useState(() => dateStr(new Date()))
  const year = pickedYear ?? defaultAnalysisYear(projects, today)
  const setYear = setPickedYear
  const [activeSec, setActiveSec] = useState(SECTIONS[0][0])
  const [target, setTarget] = useState(null)
  const [copyState, setCopyState] = useState('idle') // 'idle' | 'copied' | 'error'
  const [chartCopyState, setChartCopyState] = useState('idle') // 'idle' | 'copied' | 'error'
  const [boothCopyState, setBoothCopyState] = useState('idle') // 'idle' | 'copied' | 'error'

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'projects'), snap =>
      setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.type === 'tradeshow')))
    return unsub
  }, [])

  const [targetByOffice, setTargetByOffice] = useState({})

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'tradeshowTargets'), snap => {
      const t = snap.exists() ? snap.data()[String(year)] : undefined
      if (typeof t === 'number') {
        // 舊格式（未分公司），尚未在「年度目標」頁轉換
        setTarget(t)
        setTargetByOffice({})
      } else if (t && typeof t === 'object') {
        const sum = Object.values(t).reduce((a, b) => a + (Number(b) || 0), 0)
        setTarget(sum)
        setTargetByOffice(t)
      } else {
        setTarget(null)
        setTargetByOffice({})
      }
    })
    return unsub
  }, [year])

  const years = [...new Set(projects.map(p => p.year).filter(Boolean))].sort()
  if (!years.includes(year)) years.push(year)
  years.sort()

  const yearShows = projects.filter(p => p.year === year)
  const count = yearShows.length
  const pct = target ? Math.min(100, Math.round((count / target) * 100)) : null

  // 月份分布（依 startDate）
  const byMonth = Array(12).fill(0)
  yearShows.forEach(p => {
    if (!p.startDate) return
    const m = parseInt(p.startDate.slice(5, 7)) - 1
    if (m >= 0 && m < 12) byMonth[m]++
  })
  const maxMonthCount = Math.max(1, ...byMonth)

  // 各 Office/地區費用比較（攤位租金+裝潢+PR 總預算 USD）
  const officeRows = costByOffice(yearShows) // [{office, shows, total, avg}]，依總額由高到低
  const maxOfficeCost = Math.max(1, ...officeRows.map(r => r.total))

  // 各分公司平均秀展租金／PR 費用（USD，只計入有填該筆費用的場次）
  function avgByOffice(field) {
    const sum = {}, cnt = {}
    yearShows.forEach(p => {
      const v = p[field]
      if (!v || v <= 0) return
      const office = p.office || '未指定'
      sum[office] = (sum[office] || 0) + v
      cnt[office] = (cnt[office] || 0) + 1
    })
    return Object.keys(sum).map(o => [o, sum[o] / cnt[o]]).sort((a, b) => b[1] - a[1])
  }
  const avgRentRows = avgByOffice('rentUSD')
  const maxAvgRent = Math.max(1, ...avgRentRows.map(([, v]) => v))
  const avgPrRows = avgByOffice('prUSD')
  const maxAvgPr = Math.max(1, ...avgPrRows.map(([, v]) => v))

  // 各分公司平均「單一攤位」租金：每場 租金÷攤位數量，再依分公司取平均
  const booth = perBoothRentByOffice(yearShows)
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
  const hasTargets = Object.keys(targetByOffice).length > 0
  const sections = SECTIONS.filter(([id]) => id !== 'sec-targets' || hasTargets)
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
  const officeTargetRows = sortByOfficeOrder(Object.keys(targetByOffice)).map(office => {
    const t = targetByOffice[office]
    const c = yearShows.filter(p => (p.office || '未分公司') === office).length
    const rate = t ? Math.round((c / t) * 100) : 0
    return { office, target: t, count: c, rate }
  })

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
          <Link to="/tradeshow-targets" className="text-xs text-blue-500 hover:underline mt-3 inline-block">
            {target != null ? '前往修改目標 →' : '前往設定年度目標 →'}
          </Link>
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
      {hasTargets && (
        <div id="sec-targets" className="scroll-mt-14 bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-gray-700">🎯 各分公司目標達成率</p>
            <div className="flex gap-2">
              <button onClick={handleCopyTargetTable}
                className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50">
                {copyState === 'copied' ? '已複製' : copyState === 'error' ? '複製失敗' : '📋 複製表格（可貼到 PPT）'}
              </button>
              <button onClick={handleCopyTargetChart}
                className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50">
                {chartCopyState === 'copied' ? '已複製' : chartCopyState === 'error' ? '複製失敗' : '📊 複製長條圖（可貼到 PPT）'}
              </button>
            </div>
          </div>
          <div className="space-y-2.5">
            {sortByOfficeOrder(Object.keys(targetByOffice)).map(office => {
              const t = targetByOffice[office]
              const c = yearShows.filter(p => (p.office || '未分公司') === office).length
              const p = t ? Math.min(100, Math.round((c / t) * 100)) : 0
              return (
                <div key={office} className="flex items-center gap-3">
                  <span className="w-14 text-xs font-medium text-gray-600 shrink-0">{office}</span>
                  <div className="flex-1 h-6 bg-gray-50 rounded overflow-hidden">
                    <div className={`h-full rounded flex items-center justify-end px-2 transition-all ${p >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
                      style={{ width: `${Math.max(p, c > 0 ? 8 : 0)}%`, minWidth: c > 0 ? '2.5rem' : 0 }}>
                      {c > 0 && <span className="text-xs text-white font-medium whitespace-nowrap">{c} / {t}</span>}
                    </div>
                  </div>
                  <span className="text-xs text-gray-500 w-10 text-right">{p}%</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 月份分布 */}
      <div id="sec-months" className="scroll-mt-14 bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <p className="text-sm font-semibold text-gray-700 mb-4">📅 月份分布</p>
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
        <p className="text-xs text-gray-500 mb-4">各分公司當年度「所有秀展」的攤位租金＋裝潢費用＋PR 費用加總</p>
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
          <p>・這是「總額」：該分公司當年度每一場秀展的（攤位租金 + 裝潢費用 + PR 費用）直接相加，所以<b>參展場次越多，總額自然越高</b>，不代表單場比較貴。要比較貴不貴，請看右側「平均每場」，或下方的「單一攤位租金」。</p>
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
        <p className="text-xs text-gray-500 mb-4">每場「攤位租金 ÷ 攤位數量」，再依分公司取平均；只計入租金與攤位數量都有填的場次</p>
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

      {/* 各分公司平均租金比較(每場) */}
      <div id="sec-avg-rent" className="scroll-mt-14 bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <p className="text-sm font-semibold text-gray-700 mb-1">🏠 各分公司平均每場秀展租金比較（USD）</p>
        <p className="text-xs text-gray-500 mb-4">每個分公司「平均每場」攤位租金，只計入已填租金的場次。註：這是整場租金，租的攤位越多越高，要比較貴不貴請看上面的「單一攤位租金」</p>
        {avgRentRows.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">目前沒有可比較的租金資料</p>
        ) : (
          <div className="space-y-2.5">
            {avgRentRows.map(([office, avg], i) => (
              <div key={office} className="flex items-center gap-3">
                <span className="w-14 text-xs font-medium text-gray-600 shrink-0">{office}</span>
                <div className="flex-1 h-6 bg-gray-50 rounded overflow-hidden">
                  <div className="h-full rounded flex items-center justify-end px-2 transition-all"
                    style={{ width: `${(avg / maxAvgRent) * 100}%`, backgroundColor: BAR_COLORS[i % BAR_COLORS.length], minWidth: '2.5rem' }}>
                    <span className="text-xs text-white font-medium whitespace-nowrap">{fmtUSD(avg)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 各分公司平均 PR 費用比較 */}
      <div id="sec-avg-pr" className="scroll-mt-14 bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-sm font-semibold text-gray-700 mb-1">📣 各分公司平均 PR 費用比較（USD）</p>
        <p className="text-xs text-gray-500 mb-4">每個分公司「平均每場」PR 預算，只計入已填 PR 費用的場次</p>
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
    </div>
    </div>
  )
}
