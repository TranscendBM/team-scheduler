import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { localTodayStr } from '../utils/newProducts'
import { ownerKey } from '../utils/productLineOwners'
import {
  TRACKS, trackLabel, currentMonthKey, shiftMonth, monthLabel,
  buildYearModel, upcomingGaps, countByDesigner, buildPayload,
} from '../utils/designRotation'

const KNOWN_ORDER = ['Sherry', 'Tingwei', 'Yuna', 'Abby']
const orderRank = (n) => { const i = KNOWN_ORDER.indexOf(n); return i === -1 ? 99 : i }

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const TRACK_TONE = {
  transcendInfo: 'bg-blue-50 text-blue-700 border-blue-100',
  ig: 'bg-pink-50 text-pink-700 border-pink-100',
  industrialDm: 'bg-amber-50 text-amber-700 border-amber-100',
}

function Chips({ owners, trackKey }) {
  if (!owners || owners.length === 0) return <span className="text-xs text-gray-400">—</span>
  return (
    <div className="flex gap-1 flex-wrap">
      {owners.map(o => (
        <span key={ownerKey(o)} className={`text-xs px-2 py-0.5 rounded-full border ${TRACK_TONE[trackKey]}`}>{o.name}</span>
      ))}
    </div>
  )
}

function SummaryCard({ title, row }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3">
      <p className="text-xs text-gray-500 mb-2">{title}</p>
      <div className="space-y-1.5">
        {TRACKS.map(t => {
          const owners = row?.duties[t.key] || []
          return (
            <div key={t.key} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-24 flex-shrink-0">{t.label}</span>
              {owners.length > 0 ? <Chips owners={owners} trackKey={t.key} /> : <span className="text-xs text-red-500">尚未排班</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function RotationPage() {
  const { isManager, email: myEmail, user } = useAuth()
  const canEdit = isManager
  const myName = user?.displayName || myEmail || ''

  const [today] = useState(localTodayStr)
  const todayMonth = currentMonthKey(today)
  const [year, setYear] = useState(() => Number(todayMonth.slice(0, 4)))
  const [docs, setDocs] = useState([])
  const [users, setUsers] = useState([])
  const [editMonth, setEditMonth] = useState(null) // 'yyyy-mm' | null
  const [duties, setDuties] = useState({})
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'designRotations'), snap => setDocs(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return unsub
  }, [])

  // users 整表只有 manager 讀得到；非 manager 不訂閱(他們只看，不需要設計師名單)
  useEffect(() => {
    if (!isManager) return
    const unsub = onSnapshot(collection(db, 'users'), snap => setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return () => { unsub(); setUsers([]) }
  }, [isManager])

  const designers = useMemo(() => users
    .filter(u => u.role === 'designer' && u.active !== false)
    .map(u => ({ email: u.id, name: u.displayName || u.id }))
    .sort((a, b) => orderRank(a.name) - orderRank(b.name) || a.name.localeCompare(b.name)), [users])

  const rows = useMemo(() => buildYearModel(docs, year, todayMonth), [docs, year, todayMonth])
  const gaps = useMemo(() => upcomingGaps(docs, todayMonth, 1), [docs, todayMonth])
  const counts = useMemo(() => countByDesigner(docs, year, KNOWN_ORDER), [docs, year])
  const thisMonth = useMemo(() => buildYearModel(docs, Number(todayMonth.slice(0, 4)), todayMonth).find(r => r.isCurrent), [docs, todayMonth])
  const nextKey = shiftMonth(todayMonth, 1)
  const nextMonth = useMemo(() => buildYearModel(docs, Number(nextKey.slice(0, 4)), todayMonth).find(r => r.key === nextKey), [docs, nextKey, todayMonth])

  function openEdit(row) {
    setEditMonth(row.key)
    setDuties(Object.fromEntries(TRACKS.map(t => [t.key, row.duties[t.key]])))
    setNote(row.note)
    setError('')
  }

  const toggle = (trackKey, o) => setDuties(d => {
    const cur = d[trackKey] || []
    const has = cur.some(x => ownerKey(x) === ownerKey(o))
    return { ...d, [trackKey]: has ? cur.filter(x => ownerKey(x) !== ownerKey(o)) : [...cur, o] }
  })

  async function handleSave() {
    const payload = buildPayload(editMonth, duties, note)
    setSaving(true)
    setError('')
    try {
      if (payload === null) {
        await deleteDoc(doc(db, 'designRotations', editMonth)).catch(() => {})
      } else {
        await setDoc(doc(db, 'designRotations', editMonth), { ...payload, updatedAt: new Date().toISOString(), updatedBy: myEmail, updatedByName: myName })
      }
      setEditMonth(null)
    } catch (e) { setError('儲存失敗：' + e.message) }
    setSaving(false)
  }

  async function handleClear(key) {
    setActionError('')
    try { await deleteDoc(doc(db, 'designRotations', key)) } catch (e) { setActionError('清除失敗：' + e.message) }
    setEditMonth(null)
  }

  // 每條線可選的設計師：目前系統裡的設計師 + 這個月原本已指派、但不在名單上的人(例如已離職)
  const optionsFor = (trackKey) => {
    const cur = duties[trackKey] || []
    return [...designers, ...cur.filter(o => !designers.some(d => ownerKey(d) === ownerKey(o)))]
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b bg-white">
        <h2 className="text-xl font-bold text-gray-800">輪值設計師</h2>
        <p className="text-sm text-gray-500">每月輪值的素材：Transcend Info、IG、工控 DM 各由哪位設計師負責。{!canEdit && ' 如需調整請聯絡主管。'}</p>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-5">
          {gaps.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <p className="font-medium mb-1">還有輪值沒排</p>
              <ul className="text-xs space-y-0.5">
                {gaps.map(g => (
                  <li key={g.month}>{g.month === todayMonth ? '本月' : '下個月'}({g.month})：{g.missing.map(trackLabel).join('、')}</li>
                ))}
              </ul>
            </div>
          )}
          {actionError && <p className="text-red-500 text-xs">{actionError}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryCard title={`本月(${todayMonth})`} row={thisMonth} />
            <SummaryCard title={`下個月(${nextKey})`} row={nextMonth} />
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setYear(y => y - 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 hover:bg-gray-50" aria-label="上一年">◀</button>
            <span className="text-base font-semibold text-gray-800 w-20 text-center">{year} 年</span>
            <button onClick={() => setYear(y => y + 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 hover:bg-gray-50" aria-label="下一年">▶</button>
            {year !== Number(todayMonth.slice(0, 4)) && (
              <button onClick={() => setYear(Number(todayMonth.slice(0, 4)))} className="text-xs text-blue-500 hover:underline ml-1">回到今年</button>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="hidden sm:grid grid-cols-[4.5rem_repeat(3,minmax(0,1fr))_4rem] gap-3 px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs text-gray-500 font-medium">
              <span>月份</span>
              {TRACKS.map(t => <span key={t.key}>{t.label}</span>)}
              <span />
            </div>
            <div className="divide-y divide-gray-100">
              {rows.map(r => (
                <div key={r.key}
                  className={`px-4 py-3 grid grid-cols-1 sm:grid-cols-[4.5rem_repeat(3,minmax(0,1fr))_4rem] gap-x-3 gap-y-1.5 items-start ${r.isCurrent ? 'bg-blue-50/60' : r.isPast ? 'bg-gray-50/60' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${r.isPast ? 'text-gray-500' : 'text-gray-800'}`}>{r.label}</span>
                    {r.isCurrent && <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-600 text-white">本月</span>}
                  </div>
                  {TRACKS.map(t => (
                    <div key={t.key} className="flex items-center gap-2 sm:block">
                      <span className="text-xs text-gray-500 w-24 sm:hidden flex-shrink-0">{t.label}</span>
                      <Chips owners={r.duties[t.key]} trackKey={t.key} />
                    </div>
                  ))}
                  <div className="sm:text-right">
                    {canEdit && <button onClick={() => openEdit(r)} className="text-xs text-blue-500 hover:text-blue-700 hover:bg-blue-50 px-2 py-1 rounded">編輯</button>}
                  </div>
                  {r.note && <p className="text-xs text-gray-500 sm:col-span-5 break-words">備註：{r.note}</p>}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-4 py-2.5 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-800">{year} 年輪值次數</p>
              <p className="text-[11px] text-gray-500">看輪得公不公平；共同負責的月份每個人各算一次。</p>
            </div>
            {counts.length === 0 ? (
              <p className="text-xs text-gray-500 px-4 py-3">這一年還沒有輪值紀錄</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-500">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium whitespace-nowrap">設計師</th>
                      {TRACKS.map(t => <th key={t.key} className="text-center px-3 py-2 font-medium whitespace-nowrap">{t.label}</th>)}
                      <th className="text-center px-3 py-2 font-medium whitespace-nowrap">合計</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {counts.map(c => (
                      <tr key={c.name}>
                        <td className="px-4 py-2 text-gray-800">{c.name}</td>
                        {TRACKS.map(t => <td key={t.key} className="text-center px-3 py-2 text-gray-600">{c.counts[t.key] || <span className="text-gray-300">0</span>}</td>)}
                        <td className="text-center px-3 py-2 font-semibold text-gray-800">{c.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {editMonth && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
              <h3 className="text-lg font-semibold text-gray-800">{editMonth.split('-')[0]} 年 {monthLabel(editMonth)}輪值</h3>
              <button onClick={() => setEditMonth(null)} className="text-gray-500 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-6 py-5 space-y-5">
              {TRACKS.map(t => (
                <div key={t.key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t.label}</label>
                  <div className="flex gap-2 flex-wrap">
                    {optionsFor(t.key).map(o => {
                      const on = (duties[t.key] || []).some(x => ownerKey(x) === ownerKey(o))
                      return (
                        <button key={ownerKey(o)} type="button" onClick={() => toggle(t.key, o)}
                          className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                          {o.name}
                        </button>
                      )
                    })}
                    {optionsFor(t.key).length === 0 && <span className="text-xs text-gray-500">找不到設計師帳號，請先到「人員管理」新增</span>}
                  </div>
                </div>
              ))}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">備註(選填)</label>
                <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="例：本月 IG 由兩位共同負責" className={inputCls} />
              </div>
              <p className="text-xs text-gray-500">三條線都沒選、也沒有備註時，會直接清掉這個月的紀錄。</p>
              {error && <p className="text-red-500 text-xs">{error}</p>}
            </div>
            <div className="px-6 py-4 border-t flex gap-3 justify-between sticky bottom-0 bg-white">
              <div>
                {docs.some(d => d.id === editMonth) && (
                  <button onClick={() => handleClear(editMonth)} className="px-3 py-2 text-sm text-red-500 hover:bg-red-50 rounded-lg">清除這個月</button>
                )}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setEditMonth(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
                <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 font-medium">{saving ? '儲存中…' : '儲存'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
