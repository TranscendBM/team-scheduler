import { useEffect, useState } from 'react'
import { collection, onSnapshot, deleteDoc, doc } from 'firebase/firestore'
import * as XLSX from '@e965/xlsx'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import TradeshowEditModal from '../components/TradeshowEditModal'
import { sortByOfficeOrder } from '../utils/officeCurrency'

const fmtNum = (n) => (n || n === 0) ? Math.round(n).toLocaleString() : ''
const fmtMoney = (n) => (n || n === 0) ? Math.round(n).toLocaleString() : ''

// 結束日期一過，狀態自動視為「已結束」（畫面顯示用，不覆蓋原本手動填的狀態文字）
function effectiveStatus(p) {
  const today = new Date().toISOString().slice(0, 10)
  if (p.endDate && p.endDate < today) return '已結束'
  return p.status || ''
}

// 狀態 tag 顏色（固定三種狀態，其餘舊資料/未知值用灰色兜底）
const STATUS_TAG_COLORS = {
  '提案通過': 'bg-blue-100 text-blue-700',
  '進行中': 'bg-amber-100 text-amber-700',
  '已結束': 'bg-gray-100 text-gray-500',
}

// 貼近原始 Excel「TS Attend」年度秀展追蹤表的欄位順序，方便直接核對資料
const COLUMNS = [
  { key: 'status', label: '狀態', render: p => effectiveStatus(p) },
  { key: 'date', label: '日期', render: p => p.startDate ? `${p.startDate.slice(5)}~${(p.endDate || '').slice(5)}` : '' },
  { key: 'office', label: 'Office', render: p => p.office || '' },
  { key: 'location', label: 'Location', render: p => p.location || '' },
  { key: 'showType', label: 'Show Type', render: p => p.showType || '' },
  { key: 'boothFormat', label: '攤位形式', render: p => p.boothFormat || '' },
  { key: 'boothDimensions', label: '攤位大小', render: p => p.boothDimensions || '' },
  { key: 'boothSqm', label: 'm²', render: p => fmtNum(p.boothSqm), num: true },
  { key: 'boothSize', label: '攤位數量', render: p => fmtNum(p.boothSize), num: true },
  { key: 'rentLocal', label: '租金(當地)', render: p => fmtMoney(p.rentLocal), num: true, bold: true },
  { key: 'rentUSD', label: '租金(USD)', render: p => fmtMoney(p.rentUSD), num: true },
  { key: 'decorLocal', label: '裝潢(當地)', render: p => fmtMoney(p.decorLocal), num: true, bold: true },
  { key: 'decorUSD', label: '裝潢(USD)', render: p => fmtMoney(p.decorUSD), num: true },
  { key: 'prLocal', label: 'PR(當地)', render: p => fmtMoney(p.prLocal), num: true, bold: true },
  { key: 'prUSD', label: 'PR(USD)', render: p => fmtMoney(p.prUSD), num: true },
  { key: 'visitors', label: 'Visitors', render: p => fmtNum(p.visitors), num: true },
  { key: 'exhibitors', label: 'Exhibitor', render: p => fmtNum(p.exhibitors), num: true },
]

export default function TradeshowListPage() {
  const { isManager } = useAuth()
  const [projects, setProjects] = useState([])
  const [people, setPeople] = useState([])
  const [year, setYear] = useState(new Date().getFullYear())
  const [officeFilters, setOfficeFilters] = useState([])   // 空陣列 = 不篩選（全部）
  const [statusFilters, setStatusFilters] = useState([])
  const [editing, setEditing] = useState(null)     // 編輯中的秀展（null = 未開啟）
  const [creating, setCreating] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'projects'), snap =>
      setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.type === 'tradeshow')))
    const u2 = onSnapshot(collection(db, 'people'), snap =>
      setPeople(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return () => { u1(); u2() }
  }, [])

  const years = [...new Set(projects.map(p => p.year).filter(Boolean))].sort()
  if (!years.includes(year)) years.push(year)
  years.sort()

  const offices = sortByOfficeOrder([...new Set(projects.filter(p => p.year === year).map(p => p.office).filter(Boolean))])
  const statuses = [...new Set(projects.filter(p => p.year === year).map(p => effectiveStatus(p)).filter(Boolean))].sort()

  function toggleFilter(setFn, value) {
    setFn(cur => cur.includes(value) ? cur.filter(v => v !== value) : [...cur, value])
  }

  const filtered = projects
    .filter(p => p.year === year)
    .filter(p => officeFilters.length === 0 || officeFilters.includes(p.office))
    .filter(p => statusFilters.length === 0 || statusFilters.includes(effectiveStatus(p)))
    .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''))

  async function handleDelete(id) {
    if (!isManager) return
    await deleteDoc(doc(db, 'projects', id))
    setDeleteConfirm(null)
  }

  function exportExcel() {
    const rows = filtered.map(p => {
      const row = { 秀展名稱: p.name }
      COLUMNS.forEach(c => { row[c.label] = c.render(p) })
      return row
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, `${year}秀展列表`)
    XLSX.writeFile(wb, `秀展列表_${year}${officeFilters.length ? '_' + officeFilters.join('-') : ''}.xlsx`)
  }

  return (
    <div className="p-8 max-w-full mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-gray-800">展覽列表</h1>
        <div className="flex items-center gap-2">
          <button onClick={exportExcel}
            className="bg-white border border-gray-300 text-gray-600 text-sm px-4 py-2 rounded-lg hover:bg-gray-50 font-medium">
            ⬇ 匯出 Excel
          </button>
          {isManager && (
            <button onClick={() => setCreating(true)}
              className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 font-medium">
              + 新增秀展
            </button>
          )}
        </div>
      </div>
      <p className="text-sm text-gray-400 mb-4">{filtered.length} 場秀展，接近試算表格式方便核對資料</p>

      <div className="flex items-center gap-2 mb-3">
        <select value={year} onChange={e => setYear(parseInt(e.target.value))}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white">
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        {(officeFilters.length > 0 || statusFilters.length > 0) && (
          <button onClick={() => { setOfficeFilters([]); setStatusFilters([]) }}
            className="text-xs text-gray-400 hover:text-gray-600">✕ 清除篩選</button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-2">
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

      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <span className="text-xs text-gray-400 mr-1">狀態</span>
        {statuses.map(s => (
          <button key={s} onClick={() => toggleFilter(setStatusFilters, s)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              statusFilters.includes(s) ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}>
            {s}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="text-sm border-collapse">
          <thead className="sticky top-0 bg-gray-50 z-10">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-gray-500 border-b border-r border-gray-200 sticky left-0 bg-gray-50 min-w-[200px]">秀展名稱</th>
              {COLUMNS.map(c => (
                <th key={c.key} className={`px-3 py-2 font-medium text-gray-500 border-b border-gray-200 whitespace-nowrap ${c.num ? 'text-right' : 'text-left'}`}>
                  {c.label}
                </th>
              ))}
              {isManager && <th className="px-3 py-2 border-b border-gray-200"></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, i) => {
              const ended = effectiveStatus(p) === '已結束'
              return (
              <tr key={p.id} onClick={() => setEditing(p)}
                className={`cursor-pointer hover:bg-blue-50 ${i % 2 ? 'bg-gray-50/50' : 'bg-white'}`}>
                <td className={`px-3 py-2 border-r border-gray-100 sticky left-0 bg-inherit font-medium whitespace-nowrap ${ended ? 'text-gray-400' : 'text-gray-800'}`}>
                  {p.name}
                </td>
                {COLUMNS.map(c => {
                  if (c.key === 'status') {
                    const s = c.render(p)
                    return (
                      <td key={c.key} className="px-3 py-2 whitespace-nowrap">
                        {s && (
                          <span className={`inline-block w-20 text-center text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_TAG_COLORS[s] || 'bg-gray-100 text-gray-500'}`}>
                            {s}
                          </span>
                        )}
                        {p.artworkDone && <span className="ml-1.5 text-xs text-emerald-600">✓出稿</span>}
                      </td>
                    )
                  }
                  return (
                    <td key={c.key} className={`px-3 py-2 whitespace-nowrap ${c.num ? 'text-right tabular-nums' : ''} ${ended ? 'text-gray-400' : 'text-gray-600'} ${c.bold ? 'font-semibold' : ''}`}>
                      {c.render(p)}
                    </td>
                  )
                })}
                {isManager && (
                  <td className="px-3 py-2 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    {deleteConfirm === p.id ? (
                      <>
                        <button onClick={() => handleDelete(p.id)} className="text-xs text-red-600 hover:underline mr-2">確認刪除</button>
                        <button onClick={() => setDeleteConfirm(null)} className="text-xs text-gray-400 hover:underline">取消</button>
                      </>
                    ) : (
                      <button onClick={() => setDeleteConfirm(p.id)} className="text-xs text-red-400 hover:text-red-600 hover:underline">刪除</button>
                    )}
                  </td>
                )}
              </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={COLUMNS.length + 2} className="px-3 py-10 text-center text-gray-400">此篩選條件下沒有秀展資料</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <TradeshowEditModal project={editing} people={people} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} readOnly={!isManager} />
      )}
      {creating && isManager && (
        <TradeshowEditModal project={null} people={people} onClose={() => setCreating(false)} onSaved={() => setCreating(false)} />
      )}
    </div>
  )
}
