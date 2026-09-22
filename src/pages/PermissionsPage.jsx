import { useEffect, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { ADJUSTABLE_PAGES, canAccess } from '../utils/pages'

const ROLE_COLS = [
  { key: 'manager', label: '主管', fixed: true },
  { key: 'designer', label: '設計師' },
  { key: 'planner', label: 'Planner' },
]

export default function PermissionsPage() {
  const [perms, setPerms] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getDoc(doc(db, 'settings', 'permissions')).then(snap => {
      setPerms(snap.exists() ? (snap.data().pages || {}) : {})
      setLoading(false)
    })
  }, [])

  function toggle(pageKey, role) {
    setSaved(false)
    setPerms(prev => {
      const cur = canAccess(prev, pageKey, role)
      return { ...prev, [pageKey]: { ...prev[pageKey], [role]: !cur } }
    })
  }

  async function handleSave() {
    setSaving(true)
    // 只存 designer / planner 的覆蓋值（manager 永遠全開；fixed 頁面不受此矩陣控制，不存）
    const clean = {}
    for (const p of ADJUSTABLE_PAGES) {
      clean[p.key] = {
        designer: canAccess(perms, p.key, 'designer'),
        planner: canAccess(perms, p.key, 'planner'),
      }
    }
    await setDoc(doc(db, 'settings', 'permissions'), { pages: clean }, { merge: true })
    setSaving(false); setSaved(true)
  }

  if (loading) return <div className="p-4 sm:p-8 text-gray-500 text-sm">載入中…</div>

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto min-w-0">
      <h1 className="text-xl sm:text-2xl font-bold text-gray-800 mb-1">權限設定</h1>
      <p className="text-sm text-gray-500 mb-6 break-words">勾選每個角色能看到的頁面。主管永遠可看全部,不可調整。</p>

      {/* 3 個角色欄位在手機也塞得下，保留表格；只把欄寬與 padding 調成響應式 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto max-w-full">
        <table className="w-full text-sm min-w-[320px]">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-3 sm:px-4 py-3 font-medium">頁面</th>
              {ROLE_COLS.map(c => <th key={c.key} className="px-2 sm:px-4 py-3 font-medium text-center w-16 sm:w-28">{c.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {ADJUSTABLE_PAGES.map(p => (
              <tr key={p.key} className="hover:bg-gray-50">
                <td className="px-3 sm:px-4 py-3 text-gray-700 break-words">{p.icon} {p.label}</td>
                {ROLE_COLS.map(c => (
                  <td key={c.key} className="px-2 sm:px-4 py-3 text-center">
                    {c.fixed ? (
                      <input type="checkbox" checked disabled aria-label={`主管 · ${p.label}（固定可見）`} className="opacity-40 w-5 h-5" />
                    ) : (
                      <input type="checkbox" checked={canAccess(perms, p.key, c.key)}
                        aria-label={`${c.label} · ${p.label}`}
                        onChange={() => toggle(p.key, c.key)} className="cursor-pointer w-5 h-5" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-5">
        <button onClick={handleSave} disabled={saving}
          className="bg-blue-600 text-white text-sm px-5 py-2.5 min-h-[44px] rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? '儲存中…' : '儲存權限設定'}
        </button>
        {saved && <span className="text-sm text-emerald-600">✓ 已儲存</span>}
      </div>
      <p className="text-xs text-gray-500 mt-4 break-words">
        註:「使用者管理」「權限設定」「需求審核」「設計師儀表板」「負責人與設計師管理」固定僅主管可用,不列在此矩陣。
      </p>
    </div>
  )
}
