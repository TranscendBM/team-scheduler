import { useEffect, useState, useRef } from 'react'
import { collection, onSnapshot, doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { buildBarsForPerson, TYPE_COLORS, TYPE_LABELS, DEFAULT_RULES, LOADING_COLORS } from '../utils/milestoneUtils'

const LEAVE_COLORS = {
  '特休': '#8b5cf6',
  '病假': '#f59e0b',
  '事假': '#6b7280',
  '出差': '#0ea5e9',
  '其他': '#d1d5db',
}

const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
const LANE_HEIGHT = 28   // height per bar lane
const LANE_GAP = 4       // gap between lanes
const ROW_PADDING = 12   // top + bottom padding per row
const BUSY_HEIGHT = 8    // height of busy heatmap strip
const HEADER_HEIGHT = 56
const LEFT_WIDTH = 170
const MIN_ROW_HEIGHT = 48

// Assign bars to non-overlapping lanes
function calculateLanes(bars) {
  const sorted = [...bars].sort((a, b) => new Date(a.workStart) - new Date(b.workStart))
  const lanes = []
  const barLane = new Map()
  for (const bar of sorted) {
    let placed = false
    for (let li = 0; li < lanes.length; li++) {
      const last = lanes[li][lanes[li].length - 1]
      if (new Date(bar.workStart) >= new Date(last.workEnd)) {
        lanes[li].push(bar)
        barLane.set(bar, li)
        placed = true
        break
      }
    }
    if (!placed) {
      lanes.push([bar])
      barLane.set(bar, lanes.length - 1)
    }
  }
  return { lanes, barLane }
}

// Calculate busy level per week (number of concurrent bars)
function calcBusyWeeks(bars, viewStart, totalDays) {
  const weeks = Math.ceil(totalDays / 7)
  const counts = new Array(weeks).fill(0)
  for (const bar of bars) {
    const s = Math.max(0, Math.round((new Date(bar.workStart) - viewStart) / 86400000))
    const e = Math.min(totalDays - 1, Math.round((new Date(bar.workEnd) - viewStart) / 86400000))
    const ws = Math.floor(s / 7)
    const we = Math.floor(e / 7)
    for (let w = ws; w <= we; w++) counts[w]++
  }
  return counts
}

// 10 levels: 1-5 blue gradient, 6-10 yellow→dark red; 0=none, 10+=darkest
const BUSY_COLORS = [
  'transparent',
  '#eff6ff', '#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa',
  '#fde68a', '#fb923c', '#f97316', '#ef4444', '#991b1b',
]
function getBusyColor(count) { return BUSY_COLORS[Math.min(count, 10)] }

const SHIMMER_CSS = `
@keyframes gantt-breathe {
  0%, 100% { opacity: 0; }
  50%       { opacity: 1; }
}
.gantt-breathe-overlay {
  position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: rgba(255,255,255,0.22);
  animation: gantt-breathe 3.5s ease-in-out infinite;
}
`

export default function GanttPage() {
  const [people, setPeople] = useState([])
  const [projects, setProjects] = useState([])
  const [leaves, setLeaves] = useState([])
  const [rules, setRules] = useState(DEFAULT_RULES)
  const [year, setYear] = useState(new Date().getFullYear())
  const [tooltip, setTooltip] = useState(null)
  const [filterRole, setFilterRole] = useState('all')
  const scrollRef = useRef(null)

  useEffect(() => {
    const unsub1 = onSnapshot(collection(db, 'people'), snap => {
      setPeople(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    const unsub2 = onSnapshot(collection(db, 'projects'), snap => {
      setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    const unsub3 = onSnapshot(collection(db, 'leaves'), snap => {
      setLeaves(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    const loadRules = async () => {
      const rDoc = await getDoc(doc(db, 'settings', 'milestoneRules'))
      if (rDoc.exists()) setRules({ ...DEFAULT_RULES, ...rDoc.data() })
    }
    loadRules()
    return () => { unsub1(); unsub2(); unsub3() }
  }, [])

  const viewStart = new Date(year, 0, 1)
  const viewEnd = new Date(year, 11, 31)
  const totalDays = Math.round((viewEnd - viewStart) / 86400000) + 1
  const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0)

  function dayOffset(date) {
    return Math.round((new Date(date) - viewStart) / 86400000)
  }
  function pct(days) { return (days / totalDays) * 100 }

  useEffect(() => {
    if (scrollRef.current) {
      const todayOff = dayOffset(new Date())
      const cw = scrollRef.current.clientWidth - LEFT_WIDTH
      const todayPx = (todayOff / totalDays) * (scrollRef.current.scrollWidth - LEFT_WIDTH)
      scrollRef.current.scrollLeft = Math.max(0, todayPx - cw / 2)
    }
  }, [year, people.length])

  const filteredPeople = people
    .filter(p => filterRole === 'all' || p.role === filterRole)
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === 'designer' ? -1 : 1
      return a.name.localeCompare(b.name, 'zh-TW')
    })

  const todayOffset = dayOffset(new Date())
  const isCurrentYear = year === new Date().getFullYear()

  const LEAVE_BAR_HEIGHT = 14

  // Pre-compute per person
  const personData = filteredPeople.map(person => {
    const bars = buildBarsForPerson(person.id, projects, rules).filter(b => {
      const s = new Date(b.workStart), e = new Date(b.workEnd)
      return s <= viewEnd && e >= viewStart
    })
    const { lanes, barLane } = calculateLanes(bars)
    const numLanes = Math.max(1, lanes.length)
    const personLeaves = leaves.filter(l => l.personId === person.id && l.startDate && l.endDate).filter(l => {
      const s = new Date(l.startDate), e = new Date(l.endDate)
      return s <= viewEnd && e >= viewStart
    })
    const hasLeaves = personLeaves.length > 0
    const rowH = Math.max(MIN_ROW_HEIGHT, numLanes * (LANE_HEIGHT + LANE_GAP) + ROW_PADDING + BUSY_HEIGHT + 6 + (hasLeaves ? LEAVE_BAR_HEIGHT + 4 : 0))
    const busyWeeks = calcBusyWeeks(bars, viewStart, totalDays)
    return { person, bars, barLane, numLanes, rowH, busyWeeks, personLeaves }
  })

  return (
    <div className="flex flex-col h-full">
      <style>{SHIMMER_CSS}</style>
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
        <div>
          <h2 className="text-xl font-bold text-gray-800">甘特圖總覽</h2>
          <p className="text-sm text-gray-400">{filteredPeople.length} 位成員</p>
        </div>
        <div className="flex items-center gap-4">
          {/* Busy legend */}
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <span>繁忙度</span>
            {[[1,'1'],[3,'3'],[5,'5'],[7,'7'],[10,'10+']].map(([cnt, label]) => (
              <div key={cnt} className="flex items-center gap-0.5">
                <div className="w-3 h-2 rounded-sm" style={{ backgroundColor: getBusyColor(cnt) }} />
                <span>{label}</span>
              </div>
            ))}
          </div>
          {/* Role filter */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {[['all', '全部'], ['designer', '設計師'], ['planner', 'Planner']].map(([val, label]) => (
              <button key={val} onClick={() => setFilterRole(val)}
                className={`px-3 py-1.5 ${filterRole === val ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {label}
              </button>
            ))}
          </div>
          {/* Year */}
          <div className="flex items-center gap-1">
            <button onClick={() => setYear(y => y - 1)} className="p-1.5 rounded hover:bg-gray-100 text-gray-600">‹</button>
            <span className="font-semibold text-gray-800 w-12 text-center">{year}</span>
            <button onClick={() => setYear(y => y + 1)} className="p-1.5 rounded hover:bg-gray-100 text-gray-600">›</button>
          </div>
        </div>
      </div>

      {/* Gantt body */}
      <div className="flex-1 overflow-hidden">
        {filteredPeople.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <div className="text-center">
              <div className="text-4xl mb-2">👥</div>
              <p>尚未新增人員</p>
            </div>
          </div>
        ) : (
          <div className="h-full overflow-auto gantt-scroll" ref={scrollRef}>
            <div style={{ minWidth: '1400px' }}>

              {/* Month header */}
              <div className="flex sticky top-0 bg-white z-20 border-b shadow-sm" style={{ height: HEADER_HEIGHT }}>
                <div className="flex-shrink-0 border-r bg-gray-50 flex items-center px-4" style={{ width: LEFT_WIDTH }}>
                  <span className="text-xs font-medium text-gray-500">成員</span>
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
                    <div className="absolute top-0 bottom-0 w-0.5 bg-red-400 z-30"
                      style={{ left: `${pct(todayOffset)}%` }} />
                  )}
                </div>
              </div>

              {/* People rows */}
              {personData.map(({ person, bars, barLane, numLanes, rowH, busyWeeks, personLeaves }, pi) => (
                <div key={person.id} className={`flex border-b ${pi % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}`}
                  style={{ height: rowH }}>

                  {/* Name column */}
                  <div className="flex-shrink-0 border-r flex items-start pt-3 px-4 gap-2 sticky left-0 z-10 bg-inherit"
                    style={{ width: LEFT_WIDTH }}>
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5 ${person.role === 'designer' ? 'bg-purple-400' : 'bg-teal-400'}`} />
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-gray-800 truncate">{person.name}</p>
                      <p className="text-xs text-gray-400">{person.role === 'designer' ? '設計師' : 'Planner'}</p>
                      {bars.length > 0 && (
                        <p className="text-xs text-gray-300 mt-0.5">{bars.length} 個專案</p>
                      )}
                    </div>
                  </div>

                  {/* Timeline area */}
                  <div className="flex-1 relative overflow-hidden">
                    {/* Month grid lines */}
                    {MONTHS.map((_, i) => {
                      const left = pct(dayOffset(new Date(year, i, 1)))
                      return <div key={i} className="absolute top-0 bottom-0 w-px bg-gray-100" style={{ left: `${left}%` }} />
                    })}

                    {/* Today line */}
                    {isCurrentYear && (
                      <div className="absolute top-0 bottom-0 w-0.5 bg-red-200 z-10"
                        style={{ left: `${pct(todayOffset)}%` }} />
                    )}

                    {/* Busy heatmap strip at bottom */}
                    {bars.length > 0 && (
                      <div className="absolute bottom-1.5 left-0 right-0" style={{ height: BUSY_HEIGHT }}>
                        {busyWeeks.map((count, wi) => {
                          if (count === 0) return null
                          const left = pct(wi * 7)
                          const width = pct(7)
                          const color = getBusyColor(count)
                          return (
                            <div key={wi} className="absolute rounded-sm"
                              style={{ left: `${left}%`, width: `${width}%`, height: BUSY_HEIGHT, backgroundColor: color }} />
                          )
                        })}
                      </div>
                    )}

                    {/* Leave bars strip */}
                    {personLeaves.map((leave, li) => {
                      const clampedStart = new Date(Math.max(new Date(leave.startDate), viewStart))
                      const clampedEnd = new Date(Math.min(new Date(leave.endDate), viewEnd))
                      const leftPct = pct(dayOffset(clampedStart))
                      const widthPct = pct(Math.round((clampedEnd - clampedStart) / 86400000) + 1)
                      if (widthPct <= 0) return null
                      const leaveColor = LEAVE_COLORS[leave.type] || '#d1d5db'
                      const leaveTopPx = rowH - BUSY_HEIGHT - LEAVE_BAR_HEIGHT - 8
                      return (
                        <div key={leave.id}
                          className="absolute rounded cursor-pointer hover:brightness-110 flex items-center overflow-hidden"
                          style={{
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            height: LEAVE_BAR_HEIGHT,
                            top: leaveTopPx,
                            backgroundColor: leaveColor,
                            opacity: 0.75,
                            zIndex: 4,
                            minWidth: 4,
                            backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(255,255,255,0.3) 3px, rgba(255,255,255,0.3) 6px)`,
                          }}
                          onMouseEnter={(e) => setTooltip({ leave, x: e.clientX, y: e.clientY })}
                          onMouseLeave={() => setTooltip(null)}
                        >
                          <span className="text-white text-xs font-medium px-1.5 truncate select-none leading-none" style={{ fontSize: 10 }}>
                            {leave.type}
                          </span>
                        </div>
                      )
                    })}

                    {/* Bars stacked in lanes */}
                    {bars.map((bar, bi) => {
                      const clampedStart = new Date(Math.max(new Date(bar.workStart), viewStart))
                      const clampedEnd = new Date(Math.min(new Date(bar.workEnd), viewEnd))
                      const leftPct = pct(dayOffset(clampedStart))
                      const widthPct = pct(Math.round((clampedEnd - clampedStart) / 86400000) + 1)
                      if (widthPct <= 0) return null

                      const laneIndex = barLane.get(bar) ?? 0
                      const topPx = ROW_PADDING / 2 + laneIndex * (LANE_HEIGHT + LANE_GAP)

                      const wsDate = new Date(bar.workStart); wsDate.setHours(0,0,0,0)
                      const weDate = new Date(bar.workEnd); weDate.setHours(0,0,0,0)
                      const isInProgress = todayDate >= wsDate && todayDate <= weDate

                      return (
                        <div key={bi}
                          className="absolute rounded-md cursor-pointer hover:brightness-110 flex items-center overflow-hidden transition-all"
                          style={{
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            height: LANE_HEIGHT,
                            top: topPx,
                            backgroundColor: bar.artworkDone ? '#6b7280' : bar.color,
                            opacity: bar.artworkDone ? 0.65 : 0.88,
                            zIndex: 5,
                            minWidth: 4,
                          }}
                          onMouseEnter={(e) => setTooltip({ bar, x: e.clientX, y: e.clientY })}
                          onMouseLeave={() => setTooltip(null)}
                        >
                          {/* Breathing overlay for in-progress */}
                          {isInProgress && !bar.artworkDone && <div className="gantt-breathe-overlay" />}

                          <span className="text-white text-xs font-medium px-2 truncate select-none leading-none flex-1 min-w-0">
                            {bar.projectName}
                          </span>

                          {/* Loading level badge */}
                          {bar.loadingLevel && !bar.artworkDone && (() => {
                            const ls = LOADING_COLORS[bar.loadingLevel]
                            return (
                              <span className="text-xs font-bold px-1.5 mr-1 rounded flex-shrink-0 leading-none py-0.5"
                                style={{ backgroundColor: ls?.bg, color: ls?.text, fontSize: 9 }}>
                                {bar.loadingLevel === '高度' ? '高' : bar.loadingLevel === '中度' ? '中' : '輕'}
                              </span>
                            )
                          })()}

                          {/* Artwork done badge */}
                          {bar.artworkDone && (
                            <span className="text-xs font-bold px-1.5 mr-1 rounded flex-shrink-0 leading-none py-0.5 bg-white/30 text-white" style={{ fontSize: 9 }}>
                              ✓出稿
                            </span>
                          )}

                          {/* Milestone diamonds */}
                          {bar.milestones.map((ms) => {
                            const msOff = dayOffset(ms.date)
                            const bsOff = dayOffset(clampedStart)
                            const bDays = Math.round((clampedEnd - clampedStart) / 86400000) + 1
                            if (msOff < bsOff || msOff > bsOff + bDays) return null
                            const msPct = ((msOff - bsOff) / bDays) * 100
                            return (
                              <div key={ms.key}
                                className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rotate-45 border border-white/50 shadow-sm"
                                style={{ left: `${msPct}%`, zIndex: 6 }}
                                title={ms.label}
                              />
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tooltip */}
      {tooltip && tooltip.bar && (
        <div className="fixed z-50 bg-gray-900 text-white text-xs rounded-xl p-3 shadow-2xl pointer-events-none"
          style={{ left: tooltip.x + 14, top: tooltip.y - 10, maxWidth: 260 }}>
          <p className="font-semibold text-sm mb-1">{tooltip.bar.projectName}</p>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tooltip.bar.color }} />
            <span className="text-gray-300">{TYPE_LABELS[tooltip.bar.type]}</span>
            <span className="text-gray-500">·</span>
            <span className="text-gray-300">{tooltip.bar.role === 'designer' ? '設計師' : 'Planner'}</span>
            {tooltip.bar.loadingLevel && (
              <>
                <span className="text-gray-500">·</span>
                <span style={{ color: LOADING_COLORS[tooltip.bar.loadingLevel]?.bg }}>
                  {tooltip.bar.loadingLevel}
                  {tooltip.bar.boothSize ? `（${tooltip.bar.boothSize} 攤位）` : ''}
                </span>
              </>
            )}
          </div>
          <p className="text-gray-400">
            {new Date(tooltip.bar.workStart).toLocaleDateString('zh-TW')} – {new Date(tooltip.bar.workEnd).toLocaleDateString('zh-TW')}
          </p>
          {tooltip.bar.milestones.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-700">
              <p className="text-gray-500 mb-1">里程碑</p>
              {tooltip.bar.milestones.map(ms => (
                <p key={ms.key} className="text-gray-300">◆ {ms.label}：{new Date(ms.date).toLocaleDateString('zh-TW')}</p>
              ))}
            </div>
          )}
        </div>
      )}
      {tooltip && tooltip.leave && (
        <div className="fixed z-50 bg-gray-900 text-white text-xs rounded-xl p-3 shadow-2xl pointer-events-none"
          style={{ left: tooltip.x + 14, top: tooltip.y - 10, maxWidth: 220 }}>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: LEAVE_COLORS[tooltip.leave.type] || '#d1d5db' }} />
            <p className="font-semibold text-sm">{tooltip.leave.personName} · {tooltip.leave.type}</p>
          </div>
          <p className="text-gray-400">{tooltip.leave.startDate} – {tooltip.leave.endDate}</p>
          {tooltip.leave.note && <p className="text-gray-400 mt-1">{tooltip.leave.note}</p>}
        </div>
      )}
    </div>
  )
}
