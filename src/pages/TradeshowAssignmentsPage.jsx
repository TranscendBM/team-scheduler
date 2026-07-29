import { useEffect, useState } from 'react'
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { sortByOfficeOrder } from '../utils/officeCurrency'

// 結束日期一過，狀態自動視為「已結束」（畫面顯示用，不覆蓋原本手動填的狀態文字）—— 跟展覽列表頁一致
function effectiveStatus(p) {
  const today = new Date().toISOString().slice(0, 10)
  if (p.endDate && p.endDate < today) return '已結束'
  return p.status || ''
}

const STATUSES = ['提案通過', '進行中', '已結束']

export default function TradeshowAssignmentsPage() {
  const { isManager } = useAuth()
  const [projects, setProjects] = useState([])
  const [people, setPeople] = useState([])
  const [year, setYear] = useState(new Date().getFullYear())
  const [busy, setBusy] = useState(null)
  const [officeFilters, setOfficeFilters] = useState([])   // 空陣列 = 不篩選（全部）
  const [statusFilters, setStatusFilters] = useState([])

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'projects'), snap =>
      setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.type === 'tradeshow')))
    const u2 = onSnapshot(collection(db, 'people'), snap =>
      setPeople(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return () => { u1(); u2() }
  }, [])

  const designers = people.filter(p => p.role === 'designer').sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'))
  const planners = people.filter(p => p.role === 'planner').sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'))

  const years = [...new Set(projects.map(p => p.year).filter(Boolean))].sort()
  if (!years.includes(year)) years.push(year)
  years.sort()

  const offices = sortByOfficeOrder([...new Set(projects.filter(p => p.year === year).map(p => p.office).filter(Boolean))])

  function toggleFilter(setFn, value) {
    setFn(cur => cur.includes(value) ? cur.filter(v => v !== value) : [...cur, value])
  }

  const filtered = projects
    .filter(p => p.year === year)
    .filter(p => officeFilters.length === 0 || officeFilters.includes(p.office))
    .filter(p => statusFilters.length === 0 || statusFilters.includes(effectiveStatus(p)))
    .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''))

  async function toggle(p, personId, role) {
    const key = p.id + personId
    setBusy(key)
    const cur = p.assignments || []
    const exists = cur.some(a => a.personId === personId)
    const next = exists ? cur.filter(a => a.personId !== personId) : [...cur, { personId, role }]
    try {
      await updateDoc(doc(db, 'projects', p.id), { assignments: next, updatedAt: new Date().toISOString() })
    } catch (e) {
      alert('更新失敗：' + (e.code || e.message))
    }
    setBusy(null)
  }

  if (!isManager) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <div className="text-center"><div className="text-4xl mb-2">🔒</div><p>只有主管可以管理指派</p></div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-800">負責人與設計師管理</h1>
        <select value={year} onChange={e => setYear(parseInt(e.target.value))}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white">
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      <p className="text-sm text-gray-400 mb-3">一次檢視每場秀展的指派，點擊姓名直接切換，不用逐場開編輯視窗</p>

      <div className="mb-4">
        {(officeFilters.length > 0 || statusFilters.length > 0) && (
          <button onClick={() => { setOfficeFilters([]); setStatusFilters([]) }}
            className="text-xs text-gray-400 hover:text-gray-600 mb-1.5">✕ 清除篩選</button>
        )}
        <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
          <span className="text-xs text-gray-400 mr-1">分公司</span>
          {offices.map(o => (
            <button key={o} onClick={() => toggleFilter(setOfficeFilters, o)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                officeFilters.includes(o) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}>
              {o}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-400 mr-1">狀態</span>
          {STATUSES.map(s => (
            <button key={s} onClick={() => toggleFilter(setStatusFilters, s)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                statusFilters.includes(s) ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-4 py-3 font-medium min-w-[200px]">秀展</th>
              <th className="text-left px-4 py-3 font-medium">交期</th>
              <th className="text-left px-4 py-3 font-medium min-w-[220px]">設計師</th>
              <th className="text-left px-4 py-3 font-medium min-w-[220px]">Planner</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(p => {
              const ended = effectiveStatus(p) === '已結束'
              return (
              <tr key={p.id} className="hover:bg-gray-50/60 align-top">
                <td className={`px-4 py-3 font-medium ${ended ? 'text-gray-400' : 'text-gray-800'}`}>{p.name}</td>
                <td className={`px-4 py-3 whitespace-nowrap ${ended ? 'text-gray-300' : 'text-gray-500'}`}>{p.startDate || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {designers.map(d => {
                      const selected = (p.assignments || []).some(a => a.personId === d.id)
                      const key = p.id + d.id
                      return (
                        <button key={d.id} disabled={busy === key} onClick={() => toggle(p, d.id, 'designer')}
                          className={`text-xs px-2 py-1 rounded-lg border transition-colors disabled:opacity-50 ${
                            selected ? 'bg-purple-600 text-white border-purple-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                          }`}>
                          {d.name}
                        </button>
                      )
                    })}
                    {designers.length === 0 && <span className="text-xs text-gray-300">尚無設計師</span>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {planners.map(pl => {
                      const selected = (p.assignments || []).some(a => a.personId === pl.id)
                      const key = p.id + pl.id
                      return (
                        <button key={pl.id} disabled={busy === key} onClick={() => toggle(p, pl.id, 'planner')}
                          className={`text-xs px-2 py-1 rounded-lg border transition-colors disabled:opacity-50 ${
                            selected ? 'bg-teal-600 text-white border-teal-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                          }`}>
                          {pl.name}
                        </button>
                      )
                    })}
                    {planners.length === 0 && <span className="text-xs text-gray-300">尚無 Planner</span>}
                  </div>
                </td>
              </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-sm">此年度沒有秀展資料</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
