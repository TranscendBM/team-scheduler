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

  function prevMonth() { setViewDate(new Date(year, month - 1, 1)) }
  function nextMonth() { setViewDate(new Date(year, month + 1, 1)) }
  function goToday() { setViewDate(new Date(today.getFullYear(), today.getMonth(), 1)) }

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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
        <div>
          <h2 className="text-xl font-bold text-gray-800">日曆視圖</h2>
          <p className="text-sm text-gray-400">{year} 年 {MONTHS_LABEL[month]}｜僅顯示重要里程碑</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={goToday} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600">
            今天
          </button>
          <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600">‹</button>
          <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600">›</button>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="flex-1 overflow-auto p-4">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 mb-1">
          {WEEKDAYS.map(d => (
            <div key={d} className="text-center text-xs font-medium text-gray-400 py-2">{d}</div>
          ))}
        </div>

        {/* Days */}
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

            return (
              <div key={day}
                className={`min-h-24 rounded-lg p-1.5 border ${isToday(day) ? 'border-blue-400 bg-blue-50' : 'border-gray-100 bg-white hover:border-gray-300'}`}>
                <p className={`text-sm font-medium mb-1 ${isToday(day) ? 'text-blue-600' : 'text-gray-700'}`}>
                  {day}
                </p>
                <div className="space-y-0.5">
                  {shownMs.map(ev => (
                    <div key={ev.key}
                      className="text-xs px-1.5 py-0.5 rounded flex items-center gap-1 min-w-0"
                      style={{ backgroundColor: ev.color + '18', borderLeft: `2.5px solid ${ev.color}` }}
                      title={`${ev.label}・${ev.sub}`}>
                      <span className="flex-shrink-0" style={{ fontSize: 9 }}>{ev.dot}</span>
                      <span className="truncate font-medium" style={{ color: ev.color, fontSize: 10 }}>
                        {ev.label}
                      </span>
                      <span className="flex-shrink-0 text-gray-400 hidden sm:inline" style={{ fontSize: 9 }}>
                        {ev.sub}
                      </span>
                    </div>
                  ))}
                  {shownLeaves.map(l => (
                    <div key={l.id}
                      className="text-xs px-1.5 py-0.5 rounded truncate text-white font-medium"
                      style={{
                        backgroundColor: LEAVE_COLORS[l.type] || '#d1d5db',
                        backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.25) 2px, rgba(255,255,255,0.25) 4px)',
                      }}
                      title={`${l.personName} ${l.type}`}>
                      🏖 {l.personName}
                    </div>
                  ))}
                  {overflow > 0 && (
                    <p className="text-xs text-gray-400 pl-1">+{overflow} 更多</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Legend */}
        <div className="mt-5 space-y-2">
          <p className="text-xs font-medium text-gray-500">里程碑圖例</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span>✏</span><span>設計師/設計開始</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span>📋</span><span>Planner開始</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span>◆</span><span>邀請函・新聞稿・LinkedIn・KV里程碑</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span>🚀</span><span>展覽開始</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span>🎯</span><span>活動</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span>🏆</span><span>報獎截止</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span>🏖</span><span>休假</span>
            </div>
          </div>

          {/* Project type color chips */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
            {Object.entries(TYPE_LABELS).map(([type, label]) => (
              <div key={type} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: TYPE_COLORS[type] }} />
                <span className="text-xs text-gray-500">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
