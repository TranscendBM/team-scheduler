import { Fragment, useEffect, useState } from 'react'
import { collection, onSnapshot, doc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { OFFICE_ORDER } from '../utils/officeCurrency'

const isLegacy = (v) => typeof v === 'number'

export default function TradeshowTargetsPage() {
  const { isManager } = useAuth()
  const [projects, setProjects] = useState([])
  const [targets, setTargets] = useState({})   // { year: { office: number } | number(舊格式) }
  const [drafts, setDrafts] = useState({})     // { "year:office": draftString }
  const [pendingYears, setPendingYears] = useState([])
  const [newYear, setNewYear] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'projects'), snap =>
      setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.type === 'tradeshow')))
    const u2 = onSnapshot(doc(db, 'settings', 'tradeshowTargets'), snap =>
      setTargets(snap.exists() ? snap.data() : {}))
    return () => { u1(); u2() }
  }, [])

  // 欄位：固定順序在前，資料中出現但不在固定清單的分公司代碼附加在後（不遺漏資料）
  const extraOffices = [...new Set([
    ...projects.map(p => p.office).filter(Boolean),
    ...Object.values(targets).flatMap(t => (t && typeof t === 'object') ? Object.keys(t) : []),
  ])].filter(o => !OFFICE_ORDER.includes(o)).sort()
  const COLUMNS = [...OFFICE_ORDER, ...extraOffices]

  const years = [...new Set([
    ...Object.keys(targets).map(Number),
    ...projects.map(p => p.year).filter(Boolean),
    ...pendingYears,
  ])].sort((a, b) => b - a) // 新到舊，比照原始表格

  function actualCount(yearProjects, col) {
    return yearProjects.filter(p => p.office === col).length
  }

  function startEdit(year, col, current) {
    setDrafts(d => ({ ...d, [`${year}:${col}`]: current != null ? String(current) : '' }))
  }
  function cancelEdit(year, col) {
    setDrafts(d => { const n = { ...d }; delete n[`${year}:${col}`]; return n })
  }

  async function saveCell(year, col, officeTargets) {
    const key = `${year}:${col}`
    const raw = drafts[key]
    setSaving(true)
    try {
      const next = { ...officeTargets }
      if (raw === '' || raw === undefined) {
        delete next[col]
      } else {
        const n = parseInt(raw)
        if (!Number.isFinite(n) || n < 0) { setSaving(false); return }
        next[col] = n
      }
      await setDoc(doc(db, 'settings', 'tradeshowTargets'), { [String(year)]: next }, { merge: true })
      cancelEdit(year, col)
      setPendingYears(p => p.filter(y => y !== year))
    } catch (e) {
      alert('儲存失敗：' + (e.code || e.message))
    }
    setSaving(false)
  }

  async function convertLegacy(year, oldValue) {
    setSaving(true)
    try {
      await setDoc(doc(db, 'settings', 'tradeshowTargets'), { [String(year)]: { '未分公司': oldValue } }, { merge: true })
    } catch (e) {
      alert('轉換失敗：' + (e.code || e.message))
    }
    setSaving(false)
  }

  function addYear() {
    const y = parseInt(newYear)
    if (!Number.isFinite(y)) { setNewYear(''); return }
    setNewYear('')
    if (!years.includes(y)) setPendingYears(p => [...p, y])
  }

  return (
    <div className="p-8 max-w-full mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">年度秀展目標</h1>
      <p className="text-sm text-gray-400 mb-6">依分公司設定每年度計畫參展場數，接近試算表格式方便逐年核對；HQ（COMPUTEX 主辦單位）獨立於 TW 欄位</p>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="text-sm border-collapse min-w-full">
          <thead>
            <tr className="bg-gray-600 text-white">
              <th className="px-3 py-2.5 font-medium text-left sticky left-0 bg-gray-600 z-20 min-w-[90px]">年度</th>
              <th className="px-3 py-2.5 font-medium text-left sticky left-[90px] bg-gray-600 z-20 min-w-[70px]"></th>
              {COLUMNS.map(col => (
                <th key={col} className="px-3 py-2.5 font-medium text-center whitespace-nowrap min-w-[70px]">{col}</th>
              ))}
              <th className="px-3 py-2.5 font-medium text-center min-w-[80px]">Total</th>
            </tr>
          </thead>
          <tbody>
            {years.map(year => {
              const yearTarget = targets[String(year)]
              const legacy = isLegacy(yearTarget)
              const officeTargets = legacy ? {} : (yearTarget || {})
              const yearProjects = projects.filter(p => p.year === year)
              const totalTarget = Object.values(officeTargets).reduce((a, b) => a + (Number(b) || 0), 0)
              const totalActual = yearProjects.length

              if (legacy) {
                return (
                  <tr key={year} className="border-b border-gray-100">
                    <td className="px-3 py-2 font-bold text-gray-800 sticky left-0 bg-white">{year}</td>
                    <td colSpan={COLUMNS.length + 2} className="px-3 py-2 bg-amber-50">
                      <div className="flex items-center justify-between">
                        <span className="text-amber-700">舊格式（未分公司，共 {yearTarget} 場），需轉換後才能依分公司設定</span>
                        {isManager && (
                          <button onClick={() => convertLegacy(year, yearTarget)} disabled={saving}
                            className="text-xs bg-amber-600 text-white px-3 py-1 rounded-lg hover:bg-amber-700 disabled:opacity-50 whitespace-nowrap ml-3">
                            轉換為「未分公司」→ 可再拆分
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              }

              return (
                <Fragment key={year}>
                  <tr className="border-t border-gray-200 bg-gray-50/70">
                    <td rowSpan={2} className="px-3 py-1 font-bold text-gray-800 align-middle sticky left-0 bg-gray-50/70 border-r border-gray-100">
                      {year}
                    </td>
                    <td className="px-3 py-1 text-xs text-gray-500 font-medium sticky left-[90px] bg-gray-50/70">目標</td>
                    {COLUMNS.map(col => {
                      const key = `${year}:${col}`
                      const editing = drafts[key] !== undefined
                      const val = officeTargets[col]
                      return (
                        <td key={col} className="px-1 py-1 text-center">
                          {editing ? (
                            <input type="number" min="0" autoFocus value={drafts[key]}
                              onChange={e => setDrafts(d => ({ ...d, [key]: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter') saveCell(year, col, officeTargets); if (e.key === 'Escape') cancelEdit(year, col) }}
                              onBlur={() => saveCell(year, col, officeTargets)}
                              className="w-14 border border-blue-400 rounded px-1 py-0.5 text-sm text-center" />
                          ) : isManager ? (
                            <button onClick={() => startEdit(year, col, val)}
                              className="w-full py-0.5 rounded hover:bg-blue-100 text-gray-700 tabular-nums">
                              {val ?? <span className="text-gray-300">—</span>}
                            </button>
                          ) : (
                            <span className="text-gray-700 tabular-nums">{val ?? <span className="text-gray-300">—</span>}</span>
                          )}
                        </td>
                      )
                    })}
                    <td className="px-3 py-1 text-center font-semibold text-gray-800 tabular-nums">{totalTarget || '—'}</td>
                  </tr>
                  <tr className="border-b border-gray-200">
                    <td className="px-3 py-1 text-xs text-gray-400 font-medium sticky left-[90px] bg-white">達成</td>
                    {COLUMNS.map(col => {
                      const c = actualCount(yearProjects, col)
                      const t = officeTargets[col]
                      const met = t ? c >= t : null
                      return (
                        <td key={col} className={`px-1 py-1 text-center tabular-nums ${met === true ? 'text-emerald-600 font-medium' : met === false ? 'text-gray-500' : 'text-gray-300'}`}>
                          {c || '—'}
                        </td>
                      )
                    })}
                    <td className="px-3 py-1 text-center font-semibold text-gray-600 tabular-nums">{totalActual || '—'}</td>
                  </tr>
                </Fragment>
              )
            })}
            {years.length === 0 && (
              <tr><td colSpan={COLUMNS.length + 3} className="px-3 py-10 text-center text-gray-400">尚無資料</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {isManager && (
        <div className="flex items-center gap-2 mt-4">
          <input type="number" placeholder="新增年度，例：2028" value={newYear}
            onChange={e => setNewYear(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addYear() }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-40" />
          <button onClick={addYear} className="text-sm text-blue-600 hover:underline">+ 新增年度</button>
        </div>
      )}
    </div>
  )
}
