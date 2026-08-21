import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, onSnapshot, doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { buildBarsForPerson, buildRequestBarsForDesigner, TYPE_LABELS, DEFAULT_RULES, LOADING_COLORS } from '../utils/milestoneUtils'
import { ACTIVE_STATUSES } from '../utils/requestConstants'

// 工作條點下去要跳去哪個頁面(帶 ?open=id，目的頁自己找到該筆資料並開啟編輯/詳情視窗)
const ROUTE_FOR_TYPE = {
  tradeshow: '/tradeshow-list',
  event: '/projects/event',
  award: '/projects/award',
  design: '/projects/design',
  request: '/requests',
}

// 繁忙度熱力圖達到這個週計數就視為「過載」
const OVERLOAD_THRESHOLD = 8

const LEAVE_COLORS = {
  '特休': '#8b5cf6',
  '病假': '#f59e0b',
  '事假': '#6b7280',
  '出差': '#0ea5e9',
  '其他': '#d1d5db',
}

const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

// 週一為一週起始
function startOfWeek(d) {
  const x = new Date(d)
  const day = x.getDay()
  x.setDate(x.getDate() + ((day === 0 ? -6 : 1) - day))
  x.setHours(0, 0, 0, 0)
  return x
}
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
  const navigate = useNavigate()
  const [people, setPeople] = useState([])
  const [projects, setProjects] = useState([])
  const [leaves, setLeaves] = useState([])
  const [requests, setRequests] = useState([])
  const [users, setUsers] = useState([])
  const [rules, setRules] = useState(DEFAULT_RULES)
  const [viewMode, setViewMode] = useState('year') // 'year' | 'month' | 'week'
  const [anchor, setAnchor] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d })
  const [tooltip, setTooltip] = useState(null)
  const [filterRole, setFilterRole] = useState('all')
  const [showOverloadPanel, setShowOverloadPanel] = useState(false)
  const scrollRef = useRef(null)
  const rowRefs = useRef(new Map())

  function goToBar(bar) {
    const route = ROUTE_FOR_TYPE[bar.type]
    if (!route || !bar.projectId) return
    navigate(`${route}?open=${encodeURIComponent(bar.projectId)}`)
  }

  function scrollToPerson(personId) {
    setShowOverloadPanel(false)
    rowRefs.current.get(personId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

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
    // 設計發稿需求(給設計師的工作量用)。這頁固定 manager 專用，isManager() 對 requests 全表有讀取權限。
    const unsub4 = onSnapshot(collection(db, 'requests'), snap => {
      setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    // requests.assignedDesigners 存的是登入用 Gmail(users 的 doc id)，不是 people.email(公司信箱)——
    // 兩者是不同值(見 PeoplePage.jsx 的說明)，要靠 users.notifyEmail 對回 people.email 才能換算。
    // 這頁固定 manager 專用，讀 users 全表不會有權限問題。
    const unsub5 = onSnapshot(collection(db, 'users'), snap => {
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    const loadRules = async () => {
      const rDoc = await getDoc(doc(db, 'settings', 'milestoneRules'))
      if (rDoc.exists()) setRules({ ...DEFAULT_RULES, ...rDoc.data() })
    }
    loadRules()
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); unsub5() }
  }, [])

  // person.email(公司信箱) → 該員登入用 Gmail(requests.assignedDesigners 用這個比對)
  function loginEmailFor(person) {
    const companyEmail = (person.email || '').trim().toLowerCase()
    if (!companyEmail) return null
    const u = users.find(x => (x.notifyEmail || '').trim().toLowerCase() === companyEmail)
    return u?.email || null
  }

  let viewStart, viewEnd
  if (viewMode === 'month') {
    viewStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    viewEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
  } else if (viewMode === 'week') {
    viewStart = startOfWeek(anchor)
    viewEnd = new Date(viewStart); viewEnd.setDate(viewEnd.getDate() + 6)
  } else {
    viewStart = new Date(anchor.getFullYear(), 0, 1)
    viewEnd = new Date(anchor.getFullYear(), 11, 31)
  }
  const totalDays = Math.round((viewEnd - viewStart) / 86400000) + 1
  const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0)
  const isTodayInView = todayDate >= viewStart && todayDate <= viewEnd

  function dayOffset(date) {
    return Math.round((new Date(date) - viewStart) / 86400000)
  }
  function pct(days) { return (days / totalDays) * 100 }

  function goPrev() {
    setAnchor(a => {
      const d = new Date(a)
      if (viewMode === 'month') d.setMonth(d.getMonth() - 1)
      else if (viewMode === 'week') d.setDate(d.getDate() - 7)
      else d.setFullYear(d.getFullYear() - 1)
      return d
    })
  }
  function goNext() {
    setAnchor(a => {
      const d = new Date(a)
      if (viewMode === 'month') d.setMonth(d.getMonth() + 1)
      else if (viewMode === 'week') d.setDate(d.getDate() + 7)
      else d.setFullYear(d.getFullYear() + 1)
      return d
    })
  }
  function goToday() {
    const d = new Date(); d.setHours(0, 0, 0, 0); setAnchor(d)
  }

  const periodLabel = viewMode === 'month'
    ? `${anchor.getFullYear()}年${anchor.getMonth() + 1}月`
    : viewMode === 'week'
      ? `${viewStart.getMonth() + 1}/${viewStart.getDate()} – ${viewEnd.getMonth() + 1}/${viewEnd.getDate()}`
      : `${anchor.getFullYear()}`

  // 依目前 viewMode 產生時間軸刻度：年→12個月、月→每天、週→7天
  const ticks = viewMode === 'year'
    ? MONTHS.map((label, i) => {
        const s = new Date(anchor.getFullYear(), i, 1)
        const e = new Date(anchor.getFullYear(), i + 1, 0)
        return { key: i, label, start: s, days: Math.round((e - s) / 86400000) + 1 }
      })
    : viewMode === 'month'
      ? Array.from({ length: viewEnd.getDate() }, (_, i) => {
          const s = new Date(anchor.getFullYear(), anchor.getMonth(), i + 1)
          return { key: i, label: String(i + 1), start: s, days: 1 }
        })
      : Array.from({ length: 7 }, (_, i) => {
          const s = new Date(viewStart); s.setDate(s.getDate() + i)
          return { key: i, label: `週${WEEKDAYS[i]} ${s.getMonth() + 1}/${s.getDate()}`, start: s, days: 1 }
        })

  useEffect(() => {
    if (scrollRef.current) {
      const todayOff = Math.round((todayDate - viewStart) / 86400000)
      const cw = scrollRef.current.clientWidth - LEFT_WIDTH
      const todayPx = (todayOff / totalDays) * (scrollRef.current.scrollWidth - LEFT_WIDTH)
      scrollRef.current.scrollLeft = isTodayInView ? Math.max(0, todayPx - cw / 2) : 0
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, anchor.getTime(), people.length])

  const filteredPeople = people
    .filter(p => filterRole === 'all' || p.role === filterRole)
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === 'designer' ? -1 : 1
      return a.name.localeCompare(b.name, 'zh-TW')
    })

  const todayOffset = dayOffset(todayDate)

  const LEAVE_BAR_HEIGHT = 14

  // Pre-compute per person
  const personData = filteredPeople.map(person => {
    const requestBars = person.role === 'designer'
      ? buildRequestBarsForDesigner(loginEmailFor(person), requests, ACTIVE_STATUSES)
      : []
    const bars = [...buildBarsForPerson(person.id, projects, rules), ...requestBars].filter(b => {
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
    const peakBusy = busyWeeks.length > 0 ? Math.max(...busyWeeks) : 0
    return { person, bars, barLane, numLanes, rowH, busyWeeks, peakBusy, personLeaves }
  })

  const overloaded = personData
    .filter(pd => pd.peakBusy >= OVERLOAD_THRESHOLD)
    .sort((a, b) => b.peakBusy - a.peakBusy)

  return (
    <div className="flex flex-col h-full">
      <style>{SHIMMER_CSS}</style>
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
        <div>
          <h2 className="text-xl font-bold text-gray-800">甘特圖總覽</h2>
          <p className="text-sm text-gray-500">{filteredPeople.length} 位成員</p>
        </div>
        <div className="flex items-center gap-4">
          {/* Overload warning */}
          {overloaded.length > 0 && (
            <div className="relative">
              <button onClick={() => setShowOverloadPanel(v => !v)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-50 text-red-700 border border-red-200 hover:bg-red-100">
                ⚠️ {overloaded.length} 位過載
              </button>
              {showOverloadPanel && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowOverloadPanel(false)} />
                  <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-lg shadow-xl border border-gray-200 z-40 py-1">
                    {overloaded.map(pd => (
                      <button key={pd.person.id} onClick={() => scrollToPerson(pd.person.id)}
                        className="w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-gray-50">
                        <span className="text-gray-700">{pd.person.name}</span>
                        <span className="text-red-600 font-medium">{pd.peakBusy} 件並行</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {/* Busy legend */}
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
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
          {/* View mode */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {[['year', '年'], ['month', '月'], ['week', '週']].map(([val, label]) => (
              <button key={val} onClick={() => setViewMode(val)}
                className={`px-3 py-1.5 ${viewMode === val ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {label}
              </button>
            ))}
          </div>
          {/* Period nav */}
          <div className="flex items-center gap-1">
            <button onClick={goPrev} className="p-1.5 rounded hover:bg-gray-100 text-gray-600">‹</button>
            <button onClick={goToday} className="px-2 py-1 rounded hover:bg-gray-100 text-xs text-gray-500 border border-gray-200">今天</button>
            <span className="font-semibold text-gray-800 text-center px-1" style={{ minWidth: 90 }}>{periodLabel}</span>
            <button onClick={goNext} className="p-1.5 rounded hover:bg-gray-100 text-gray-600">›</button>
          </div>
        </div>
      </div>

      {/* Gantt body */}
      <div className="flex-1 overflow-hidden">
        {filteredPeople.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
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
                  {ticks.map((t) => {
                    const left = pct(dayOffset(t.start))
                    const width = pct(t.days)
                    return (
                      <div key={t.key} className="absolute top-0 border-r border-gray-200 flex items-center justify-center"
                        style={{ left: `${left}%`, width: `${width}%`, height: HEADER_HEIGHT }}>
                        <span className="text-xs font-medium text-gray-600 truncate px-0.5">{t.label}</span>
                      </div>
                    )
                  })}
                  {isTodayInView && (
                    <div className="absolute top-0 bottom-0 w-0.5 bg-red-400 z-30"
                      style={{ left: `${pct(todayOffset)}%` }} />
                  )}
                </div>
              </div>

              {/* People rows */}
              {personData.map(({ person, bars, barLane, rowH, busyWeeks, peakBusy, personLeaves }, pi) => (
                <div key={person.id} ref={el => rowRefs.current.set(person.id, el)}
                  className={`flex border-b ${pi % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}`}
                  style={{ height: rowH }}>

                  {/* Name column */}
                  <div className="flex-shrink-0 border-r flex items-start pt-3 px-4 gap-2 sticky left-0 z-10 bg-inherit"
                    style={{ width: LEFT_WIDTH }}>
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5 ${person.role === 'designer' ? 'bg-purple-400' : 'bg-teal-400'}`} />
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-gray-800 truncate flex items-center gap-1">
                        {person.name}
                        {peakBusy >= OVERLOAD_THRESHOLD && (
                          <span title={`本期最多同時 ${peakBusy} 件`} className="text-red-500 text-sm leading-none">⚠️</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500">{person.role === 'designer' ? '設計師' : 'Planner'}</p>
                      {bars.length > 0 && (
                        <p className="text-xs text-gray-500 mt-0.5">{bars.length} 個專案</p>
                      )}
                    </div>
                  </div>

                  {/* Timeline area */}
                  <div className="flex-1 relative overflow-hidden">
                    {/* Grid lines */}
                    {ticks.map((t) => {
                      const left = pct(dayOffset(t.start))
                      return <div key={t.key} className="absolute top-0 bottom-0 w-px bg-gray-100" style={{ left: `${left}%` }} />
                    })}

                    {/* Today line */}
                    {isTodayInView && (
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
                    {personLeaves.map((leave) => {
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
                          onClick={() => goToBar(bar)}
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
            <span className="text-gray-500">{TYPE_LABELS[tooltip.bar.type]}</span>
            <span className="text-gray-500">·</span>
            <span className="text-gray-500">{tooltip.bar.role === 'designer' ? '設計師' : 'Planner'}</span>
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
          <p className="text-gray-500">
            {new Date(tooltip.bar.workStart).toLocaleDateString('zh-TW')} – {new Date(tooltip.bar.workEnd).toLocaleDateString('zh-TW')}
          </p>
          {tooltip.bar.milestones.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-700">
              <p className="text-gray-500 mb-1">里程碑</p>
              {tooltip.bar.milestones.map(ms => (
                <p key={ms.key} className="text-gray-500">◆ {ms.label}：{new Date(ms.date).toLocaleDateString('zh-TW')}</p>
              ))}
            </div>
          )}
          <p className="text-gray-500 mt-2 pt-2 border-t border-gray-700">點擊查看詳情 →</p>
        </div>
      )}
      {tooltip && tooltip.leave && (
        <div className="fixed z-50 bg-gray-900 text-white text-xs rounded-xl p-3 shadow-2xl pointer-events-none"
          style={{ left: tooltip.x + 14, top: tooltip.y - 10, maxWidth: 220 }}>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: LEAVE_COLORS[tooltip.leave.type] || '#d1d5db' }} />
            <p className="font-semibold text-sm">{tooltip.leave.personName} · {tooltip.leave.type}</p>
          </div>
          <p className="text-gray-500">{tooltip.leave.startDate} – {tooltip.leave.endDate}</p>
          {tooltip.leave.note && <p className="text-gray-500 mt-1">{tooltip.leave.note}</p>}
        </div>
      )}
    </div>
  )
}
