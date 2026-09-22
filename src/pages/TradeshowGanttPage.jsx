import { useEffect, useState, useRef } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { getLoadingLevel, LOADING_COLORS } from '../utils/milestoneUtils'
import { useIsDesktop } from '../hooks/useMediaQuery'
import { tooltipPosition } from '../utils/tooltipPosition'

const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
const HEADER_HEIGHT = 48
// 秀展名稱欄：手機縮到 130px（仍看得到名稱），桌面維持 220px。
// 這個值同時參與「捲到今天」的計算，所以必須是 JS 值而不是純 CSS breakpoint。
const LEFT_WIDTH_DESKTOP = 220
const LEFT_WIDTH_MOBILE = 130
const MIN_TIMELINE_DESKTOP = 1400
const MIN_TIMELINE_MOBILE = 900
const ROW_HEIGHT = 40
const BAR_HEIGHT = 24

export default function TradeshowGanttPage() {
  const [projects, setProjects] = useState([])
  const [people, setPeople] = useState([])
  const [year, setYear] = useState(new Date().getFullYear())
  const [tooltip, setTooltip] = useState(null)
  const scrollRef = useRef(null)
  const isDesktop = useIsDesktop()
  const LEFT_WIDTH = isDesktop ? LEFT_WIDTH_DESKTOP : LEFT_WIDTH_MOBILE
  const minTimelineWidth = isDesktop ? MIN_TIMELINE_DESKTOP : MIN_TIMELINE_MOBILE

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'projects'), snap =>
      setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.type === 'tradeshow')))
    const u2 = onSnapshot(collection(db, 'people'), snap =>
      setPeople(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return () => { u1(); u2() }
  }, [])

  const viewStart = new Date(year, 0, 1)
  const viewEnd = new Date(year, 11, 31)
  const totalDays = Math.round((viewEnd - viewStart) / 86400000) + 1
  const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0)
  const isCurrentYear = year === new Date().getFullYear()

  function dayOffset(date) { return Math.round((new Date(date) - viewStart) / 86400000) }
  function pct(days) { return (days / totalDays) * 100 }
  const todayOffset = dayOffset(new Date())

  useEffect(() => {
    if (scrollRef.current) {
      const cw = scrollRef.current.clientWidth - LEFT_WIDTH
      const todayPx = (todayOffset / totalDays) * (scrollRef.current.scrollWidth - LEFT_WIDTH)
      scrollRef.current.scrollLeft = Math.max(0, todayPx - cw / 2)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, projects.length, LEFT_WIDTH])

  const rows = projects
    .filter(p => p.startDate && p.endDate)
    .filter(p => new Date(p.startDate) <= viewEnd && new Date(p.endDate) >= viewStart)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map(p => {
      const assigned = (p.assignments || []).map(a => people.find(pe => pe.id === a.personId)?.name).filter(Boolean)
      const loadingLevel = getLoadingLevel(p.boothSize, p.name)
      return { p, assigned, loadingLevel }
    })

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 border-b bg-white shrink-0">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-gray-800">秀展甘特圖</h1>
          <p className="text-sm text-gray-500">{rows.length} 場秀展</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setYear(y => y - 1)} aria-label="前一年" className="w-11 h-11 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600">‹</button>
          <span className="font-semibold text-gray-800 w-14 text-center">{year}</span>
          <button onClick={() => setYear(y => y + 1)} aria-label="後一年" className="w-11 h-11 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600">›</button>
        </div>
      </div>

      {/* 橫向捲動只發生在這個容器內，不會讓整頁 body 出現水平捲軸 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {rows.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center"><div className="text-4xl mb-2">📊</div><p>此年度沒有秀展資料</p></div>
          </div>
        ) : (
          <div className="h-full overflow-auto gantt-scroll" ref={scrollRef}>
            <div style={{ minWidth: `${minTimelineWidth}px` }}>
              {/* Month header */}
              <div className="flex sticky top-0 bg-white z-20 border-b shadow-sm" style={{ height: HEADER_HEIGHT }}>
                <div className="flex-shrink-0 border-r bg-gray-50 flex items-center px-2 lg:px-4 sticky left-0 z-10" style={{ width: LEFT_WIDTH }}>
                  <span className="text-xs font-medium text-gray-500">秀展</span>
                </div>
                <div className="flex-1 relative overflow-hidden">
                  {MONTHS.map((m, i) => {
                    const ms = new Date(year, i, 1)
                    const me = new Date(year, i + 1, 0)
                    const left = pct(dayOffset(ms))
                    const width = pct(Math.round((me - ms) / 86400000) + 1)
                    return (
                      <div key={i} className="absolute top-0 border-r border-gray-200 flex items-center justify-center"
                        style={{ left: `${left}%`, width: `${width}%`, height: HEADER_HEIGHT }}>
                        <span className="text-xs font-medium text-gray-600">{m}</span>
                      </div>
                    )
                  })}
                  {isCurrentYear && (
                    <div className="absolute top-0 bottom-0 w-0.5 bg-red-400 z-30" style={{ left: `${pct(todayOffset)}%` }} />
                  )}
                </div>
              </div>

              {/* Show rows */}
              {rows.map(({ p, assigned, loadingLevel }, i) => {
                const clampedStart = new Date(Math.max(new Date(p.startDate), viewStart))
                const clampedEnd = new Date(Math.min(new Date(p.endDate), viewEnd))
                const leftPct = pct(dayOffset(clampedStart))
                const widthPct = pct(Math.round((clampedEnd - clampedStart) / 86400000) + 1)
                const style = loadingLevel ? LOADING_COLORS[loadingLevel] : { bg: '#93c5fd', text: '#1e3a8a' }
                return (
                  <div key={p.id} className={`flex border-b ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}`} style={{ height: ROW_HEIGHT }}>
                    <div className="flex-shrink-0 border-r flex flex-col justify-center px-2 lg:px-4 sticky left-0 z-10 bg-inherit" style={{ width: LEFT_WIDTH }}>
                      <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                      {assigned.length > 0 && <p className="text-xs text-gray-500 truncate">{assigned.join('、')}</p>}
                    </div>
                    <div className="flex-1 relative overflow-hidden">
                      {MONTHS.map((_, mi) => (
                        <div key={mi} className="absolute top-0 bottom-0 w-px bg-gray-100" style={{ left: `${pct(dayOffset(new Date(year, mi, 1)))}%` }} />
                      ))}
                      {isCurrentYear && (
                        <div className="absolute top-0 bottom-0 w-0.5 bg-red-200 z-10" style={{ left: `${pct(todayOffset)}%` }} />
                      )}
                      <div className="absolute rounded-md cursor-pointer hover:brightness-105 flex items-center overflow-hidden transition-all"
                        style={{
                          left: `${leftPct}%`, width: `${Math.max(widthPct, 0.5)}%`, height: BAR_HEIGHT,
                          top: (ROW_HEIGHT - BAR_HEIGHT) / 2,
                          backgroundColor: p.artworkDone ? '#6b7280' : style.bg,
                          opacity: p.artworkDone ? 0.7 : 0.9, minWidth: 4,
                        }}
                        onMouseEnter={e => setTooltip({ p, assigned, loadingLevel, x: e.clientX, y: e.clientY })}
                        onMouseLeave={() => setTooltip(null)}>
                        <span className="text-xs font-medium px-2 truncate select-none" style={{ color: p.artworkDone ? '#fff' : style.text }}>
                          {p.name}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {tooltip && (
        <div className="fixed z-[70] bg-gray-900 text-white text-xs rounded-xl p-3 shadow-2xl pointer-events-none"
          style={{
            ...tooltipPosition({
              x: tooltip.x, y: tooltip.y,
              width: Math.min(280, (typeof window === 'undefined' ? 1024 : window.innerWidth) - 16),
              height: 170,
              viewportWidth: typeof window === 'undefined' ? 1024 : window.innerWidth,
              viewportHeight: typeof window === 'undefined' ? 768 : window.innerHeight,
            }),
            maxWidth: 'min(280px, calc(100vw - 16px))',
          }}>
          <p className="font-semibold text-sm mb-1">{tooltip.p.name}</p>
          <p className="text-gray-500">{tooltip.p.startDate} ~ {tooltip.p.endDate}</p>
          {tooltip.p.office && <p className="text-gray-500 mt-1">Office：{tooltip.p.office}｜{tooltip.p.location || '—'}</p>}
          {tooltip.loadingLevel && <p className="text-gray-500">Loading：{tooltip.loadingLevel}{tooltip.p.boothSize ? `（${tooltip.p.boothSize} 攤位）` : ''}</p>}
          {tooltip.assigned.length > 0 && <p className="text-gray-500 mt-1">指派：{tooltip.assigned.join('、')}</p>}
          {(tooltip.p.rentUSD || tooltip.p.decorUSD || tooltip.p.prUSD) && (
            <p className="text-gray-500 mt-1">
              預算：${Math.round((tooltip.p.rentUSD || 0) + (tooltip.p.decorUSD || 0) + (tooltip.p.prUSD || 0)).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
