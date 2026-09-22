import { useEffect, useState } from 'react'
import { collection, onSnapshot, doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import {
  TYPE_COLORS, TYPE_LABELS, DEFAULT_RULES,
  getWorkStart, getMilestones, getKVMilestones, getLoadingLevel,
} from '../utils/milestoneUtils'

const MONTHS_LABEL = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

const LEAVE_COLORS = {
  '特休': '#8b5cf6',
  '病假': '#f59e0b',
  '事假': '#6b7280',
  '出差': '#0ea5e9',
  '其他': '#d1d5db',
}

// Format a Date object to YYYY-MM-DD using LOCAL time (avoids UTC shift)
function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function CalendarPage() {
  const [projects, setProjects] = useState([])
  const [leaves, setLeaves] = useState([])
  const [rules, setRules] = useState(DEFAULT_RULES)
  const [today] = useState(new Date())
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  // 手機版：點某一天 → 下方 agenda 列出當天完整內容（純呈現方式，資料來源與桌面版完全相同）
  const [selectedDay, setSelectedDay] = useState(null)

  useEffect(() => {
    const unsub1 = onSnapshot(collection(db, 'projects'), snap => {
      setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    const unsub2 = onSnapshot(collection(db, 'leaves'), snap => {
      setLeaves(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    const loadRules = async () => {
      const rDoc = await getDoc(doc(db, 'settings', 'milestoneRules'))
      if (rDoc.exists()) setRules({ ...DEFAULT_RULES, ...rDoc.data() })
    }
    loadRules()
    return () => { unsub1(); unsub2() }
  }, [])

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  function prevMonth() { setViewDate(new Date(year, month - 1, 1)); setSelectedDay(null) }
  function nextMonth() { setViewDate(new Date(year, month + 1, 1)); setSelectedDay(null) }
  function goToday() {
    setViewDate(new Date(today.getFullYear(), today.getMonth(), 1))
    setSelectedDay(today.getFullYear() === year && today.getMonth() === month ? today.getDate() : null)
  }

  // Build milestone events for each day (only key dates, not full spans)
  function getMilestoneEventsForDay(day) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const events = []

    for (const p of projects) {
      if (!p.startDate) continue
      const color = TYPE_COLORS[p.type] || '#6B7280'

      if (p.type === 'tradeshow') {
        const level = getLoadingLevel(p.boothSize, p.name)

        // Designer work start
        const dsDate = toLocalDateStr(getWorkStart(p.startDate, 'designer', rules, level))
        if (dsDate === dateStr) {
          events.push({ key: `${p.id}-ds`, label: p.name, sub: '設計師開始', color, dot: '✏' })
        }

        // Planner work start
        const psDate = toLocalDateStr(getWorkStart(p.startDate, 'planner', rules, level))
        if (psDate === dateStr) {
          events.push({ key: `${p.id}-ps`, label: p.name, sub: 'Planner開始', color, dot: '📋' })
        }

        // Tradeshow milestones (邀請函, 新聞稿, LI預告, LI發文)
        const milestones = getMilestones(p.startDate, rules, level)
        for (const ms of milestones) {
          if (toLocalDateStr(ms.date) === dateStr) {
            const isShowDay = ms.key === 'linkedinPost'
            events.push({
              key: `${p.id}-${ms.key}`,
              label: p.name,
              sub: isShowDay ? '展覽開始' : ms.label,
              color,
              dot: isShowDay ? '🚀' : '◆',
            })
          }
        }

      } else if (p.type === 'design' || p.type === 'seasonal_kv') {
        // Design project start
        if (p.startDate === dateStr) {
          events.push({ key: `${p.id}-start`, label: p.name, sub: '設計開始', color, dot: '✏' })
        }

        // KV release milestone
        const isKV = p.type === 'seasonal_kv' || (p.type === 'design' && p.designSubtype === '季節KV')
        if (isKV && p.endDate) {
          const kvMs = getKVMilestones(p.endDate, rules)
          for (const ms of kvMs) {
            if (toLocalDateStr(ms.date) === dateStr) {
              events.push({ key: `${p.id}-${ms.key}`, label: p.name, sub: ms.label, color, dot: '◆' })
            }
          }
        }

        // End / event date
        if (p.endDate && p.endDate === dateStr) {
          events.push({ key: `${p.id}-end`, label: p.name, sub: '活動日', color, dot: '🎨' })
        }

      } else if (p.type === 'event') {
        if (p.startDate === dateStr) {
          events.push({ key: `${p.id}-start`, label: p.name, sub: '活動開始', color, dot: '🎯' })
        }
        if (p.endDate && p.endDate !== p.startDate && p.endDate === dateStr) {
          events.push({ key: `${p.id}-end`, label: p.name, sub: '活動結束', color, dot: '🏁' })
        }

      } else if (p.type === 'award') {
        if (p.startDate === dateStr) {
          events.push({ key: `${p.id}-start`, label: p.name, sub: '截止日', color, dot: '🏆' })
        }
      }
    }

    return events
  }

  // Get leaves active on a given day
  function getLeavesForDay(day) {
    const date = new Date(year, month, day)
    return leaves.filter(l => {
      if (!l.startDate || !l.endDate) return false
      const s = new Date(l.startDate)
      const e = new Date(l.endDate)
      return date >= s && date <= e
    })
  }

  const isToday = (day) =>
    today.getFullYear() === year && today.getMonth() === month && today.getDate() === day

  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  // 手機 agenda 用：某一天的完整內容（跟月曆格子取自同一組函式，不做任何資料上的差別）
  const selectedEvents = selectedDay ? getMilestoneEventsForDay(selectedDay) : []
  const selectedLeaves = selectedDay ? getLeavesForDay(selectedDay) : []

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 border-b bg-white shrink-0">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-gray-800">日曆視圖</h1>
          <p className="text-sm text-gray-500 break-words">{year} 年 {MONTHS_LABEL[month]}｜僅顯示重要里程碑</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={goToday} className="px-3 py-2 min-h-[44px] text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600">
            今天
          </button>
          <button onClick={prevMonth} aria-label="上個月" className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-600">‹</button>
          <button onClick={nextMonth} aria-label="下個月" className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-600">›</button>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="flex-1 min-h-0 overflow-auto p-3 sm:p-4">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 mb-1">
          {WEEKDAYS.map(d => (
            <div key={d} className="text-center text-sm sm:text-base font-medium text-gray-500 py-1.5 sm:py-2">{d}</div>
          ))}
        </div>

        {/*
          Days
          lg 以上：原本的月曆格子（每格列出最多 3 筆事件明細），資訊密度不變。
          lg 以下：緊湊月曆（只顯示日期 + 事件顏色點），點一天在下方 agenda 看完整內容——
                  7 欄在手機寬度下不可能塞得下事件文字，這是呈現方式的差別，資料完全相同。
        */}
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            if (day === null) return <div key={`empty-${i}`} />
            const msEvents = getMilestoneEventsForDay(day)
            const dayLeaves = getLeavesForDay(day)

            // Show up to 3 items total; leaves shown after milestones
            const shownMs = msEvents.slice(0, 3)
            const remainSlots = Math.max(0, 3 - shownMs.length)
            const shownLeaves = dayLeaves.slice(0, remainSlots)
            const overflow = (msEvents.length - shownMs.length) + (dayLeaves.length - shownLeaves.length)
            const dotColors = [
              ...msEvents.slice(0, 3).map(ev => ev.color),
              ...dayLeaves.slice(0, 1).map(l => LEAVE_COLORS[l.type] || '#d1d5db'),
            ]
            const isSelected = selectedDay === day

            return (
              <div key={day}>
                {/* 手機／平板：緊湊格子 */}
                <button
                  type="button"
                  onClick={() => setSelectedDay(isSelected ? null : day)}
                  aria-pressed={isSelected}
                  aria-label={`${month + 1} 月 ${day} 日，${msEvents.length + dayLeaves.length} 個項目`}
                  className={`lg:hidden w-full min-h-[52px] rounded-lg border flex flex-col items-center justify-center gap-1 px-0.5 py-1 ${
                    isSelected ? 'border-blue-500 bg-blue-100'
                      : isToday(day) ? 'border-blue-400 bg-blue-50'
                      : 'border-gray-100 bg-white'
                  }`}
                >
                  <span className={`text-sm font-medium ${isToday(day) ? 'text-blue-600' : 'text-gray-700'}`}>{day}</span>
                  <span className="flex items-center gap-0.5 h-1.5">
                    {dotColors.map((c, di) => (
                      <span key={di} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c }} />
                    ))}
                  </span>
                </button>

                {/* 桌面：原本的完整格子 */}
                <div
                  className={`hidden lg:block min-h-28 rounded-lg p-1.5 border ${isToday(day) ? 'border-blue-400 bg-blue-50' : 'border-gray-100 bg-white hover:border-gray-300'}`}>
                  <p className={`text-lg font-medium mb-1 ${isToday(day) ? 'text-blue-600' : 'text-gray-700'}`}>
                    {day}
                  </p>
                  <div className="space-y-0.5">
                    {shownMs.map(ev => (
                      <div key={ev.key}
                        className="text-sm px-1.5 py-0.5 rounded flex items-center gap-1 min-w-0"
                        style={{ backgroundColor: ev.color + '18', borderLeft: `2.5px solid ${ev.color}` }}
                        title={`${ev.label}・${ev.sub}`}>
                        <span className="flex-shrink-0" style={{ fontSize: 11 }}>{ev.dot}</span>
                        <span className="truncate font-medium" style={{ color: ev.color, fontSize: 12 }}>
                          {ev.label}
                        </span>
                        <span className="flex-shrink-0 text-gray-500" style={{ fontSize: 11 }}>
                          {ev.sub}
                        </span>
                      </div>
                    ))}
                    {shownLeaves.map(l => (
                      <div key={l.id}
                        className="text-sm px-1.5 py-0.5 rounded truncate text-white font-medium"
                        style={{
                          backgroundColor: LEAVE_COLORS[l.type] || '#d1d5db',
                          backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.25) 2px, rgba(255,255,255,0.25) 4px)',
                        }}
                        title={`${l.personName} ${l.type}`}>
                        🏖 {l.personName}
                      </div>
                    ))}
                    {overflow > 0 && (
                      <p className="text-sm text-gray-500 pl-1">+{overflow} 更多</p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* 手機 agenda：選到的那一天的完整內容（不靠 hover / title 才看得到） */}
        <div className="lg:hidden mt-4">
          {selectedDay === null ? (
            <p className="text-xs text-gray-500 text-center">點選日期查看當天的里程碑與休假</p>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-sm font-semibold text-gray-700 mb-2">
                {year} / {month + 1} / {selectedDay}
              </p>
              {selectedEvents.length === 0 && selectedLeaves.length === 0 ? (
                <p className="text-sm text-gray-500">這一天沒有里程碑或休假</p>
              ) : (
                <ul className="space-y-2">
                  {selectedEvents.map(ev => (
                    <li key={ev.key} className="flex items-start gap-2 rounded-lg px-2 py-1.5"
                      style={{ backgroundColor: ev.color + '18', borderLeft: `3px solid ${ev.color}` }}>
                      <span className="shrink-0 text-sm">{ev.dot}</span>
                      <span className="min-w-0 text-sm">
                        <span className="font-medium break-words" style={{ color: ev.color }}>{ev.label}</span>
                        <span className="text-gray-500 ml-1 break-words">・{ev.sub}</span>
                      </span>
                    </li>
                  ))}
                  {selectedLeaves.map(l => (
                    <li key={l.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-white"
                      style={{ backgroundColor: LEAVE_COLORS[l.type] || '#d1d5db' }}>
                      <span className="shrink-0 text-sm">🏖</span>
                      <span className="min-w-0 text-sm break-words">{l.personName}・{l.type}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="mt-5 space-y-2">
          <p className="text-sm font-medium text-gray-500">里程碑圖例</p>
          <div className="flex flex-wrap gap-x-4 sm:gap-x-5 gap-y-1.5">
            <div className="flex items-center gap-1.5 text-base text-gray-500">
              <span>✏</span><span>設計師/設計開始</span>
            </div>
            <div className="flex items-center gap-1.5 text-base text-gray-500">
              <span>📋</span><span>Planner開始</span>
            </div>
            <div className="flex items-start gap-1.5 text-base text-gray-500 min-w-0 max-w-full">
              <span className="shrink-0">◆</span><span className="min-w-0 break-words">邀請函・新聞稿・LinkedIn・KV里程碑</span>
            </div>
            <div className="flex items-center gap-1.5 text-base text-gray-500">
              <span>🚀</span><span>展覽開始</span>
            </div>
            <div className="flex items-center gap-1.5 text-base text-gray-500">
              <span>🎯</span><span>活動</span>
            </div>
            <div className="flex items-center gap-1.5 text-base text-gray-500">
              <span>🏆</span><span>報獎截止</span>
            </div>
            <div className="flex items-center gap-1.5 text-base text-gray-500">
              <span>🏖</span><span>休假</span>
            </div>
          </div>

          {/* Project type color chips */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
            {Object.entries(TYPE_LABELS).map(([type, label]) => (
              <div key={type} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: TYPE_COLORS[type] }} />
                <span className="text-base text-gray-500">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
