import { useEffect, useState } from 'react'
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'

export default function TradeshowAssignmentsPage() {
  const { isManager } = useAuth()
  const [projects, setProjects] = useState([])
  const [people, setPeople] = useState([])
  const [year, setYear] = useState(new Date().getFullYear())
  const [busy, setBusy] = useState(null)

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

  const filtered = projects
    .filter(p => p.year === year)
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
      <p className="text-sm text-gray-400 mb-6">一次檢視每場秀展的指派，點擊姓名直接切換，不用逐場開編輯視窗</p>

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
            {filtered.map(p => (
              <tr key={p.id} className="hover:bg-gray-50/60 align-top">
                <td className="px-4 py-3 font-medium text-gray-800">{p.name}</td>
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{p.startDate || '—'}</td>
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
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-sm">此年度沒有秀展資料</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
