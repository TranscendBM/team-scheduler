import { useEffect, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { PAGES, canAccess } from '../utils/pages'

const ROLE_COLS = [
  { key: 'manager', label: '設計主管', fixed: true },
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
    // 只存 designer / planner 的覆蓋值（manager 永遠全開，不存）
    const clean = {}
    for (const p of PAGES) {
      clean[p.key] = {
        designer: canAccess(perms, p.key, 'designer'),
        planner: canAccess(perms, p.key, 'planner'),
      }
    }
    await setDoc(doc(db, 'settings', 'permissions'), { pages: clean }, { merge: true })
    setSaving(false); setSaved(true)
  }

  if (loading) return <div className="p-8 text-gray-400 text-sm">載入中…</div>

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">權限設定</h1>
      <p className="text-sm text-gray-400 mb-6">勾選每個角色能看到的頁面。設計主管永遠可看全部,不可調整。</p>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-4 py-3 font-medium">頁面</th>
              {ROLE_COLS.map(c => <th key={c.key} className="px-4 py-3 font-medium text-center w-28">{c.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {PAGES.map(p => (
              <tr key={p.key} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-700">{p.icon} {p.label}</td>
                {ROLE_COLS.map(c => (
                  <td key={c.key} className="px-4 py-3 text-center">
                    {c.fixed ? (
                      <input type="checkbox" checked disabled className="opacity-40" />
                    ) : (
                      <input type="checkbox" checked={canAccess(perms, p.key, c.key)}
                        onChange={() => toggle(p.key, c.key)} className="cursor-pointer w-4 h-4" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3 mt-5">
        <button onClick={handleSave} disabled={saving}
          className="bg-blue-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? '儲存中…' : '儲存權限設定'}
        </button>
        {saved && <span className="text-sm text-emerald-600">✓ 已儲存</span>}
      </div>
      <p className="text-xs text-gray-400 mt-4">
        註:「使用者管理」與「權限設定」為系統管理頁,固定僅設計主管可見,不列在此矩陣。
      </p>
    </div>
  )
}
