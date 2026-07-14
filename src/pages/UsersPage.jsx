import { useEffect, useState } from 'react'
import { collection, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { REGIONS } from '../utils/requestConstants'

const ROLES = [
  { value: 'manager', label: '主管', color: 'bg-purple-100 text-purple-700' },
  { value: 'designer', label: '設計師', color: 'bg-blue-100 text-blue-700' },
  { value: 'planner', label: 'Planner', color: 'bg-emerald-100 text-emerald-700' },
]
const roleMeta = (r) => ROLES.find(x => x.value === r) || { label: r, color: 'bg-gray-100 text-gray-600' }

const emptyForm = { email: '', displayName: '', notifyEmail: '', role: 'designer', active: true, regions: [] }

export default function UsersPage() {
  const { email: myEmail } = useAuth()
  const [users, setUsers] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState(null) // 正在編輯的 email，null = 新增
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), snap =>
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.email.localeCompare(b.email))))
    return unsub
  }, [])

  function openCreate() { setEditing(null); setForm(emptyForm); setError('') }
  function openEdit(u) {
    setEditing(u.email)
    setForm({ email: u.email, displayName: u.displayName || '', notifyEmail: u.notifyEmail || '', role: u.role, active: u.active !== false, regions: u.regions || [] })
    setError('')
  }

  async function handleSave() {
    const email = form.email.trim().toLowerCase()
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setError('請輸入有效的 email'); return }
    if (!editing && users.some(u => u.email === email)) { setError('此 email 已存在'); return }
    setSaving(true)
    try {
      await setDoc(doc(db, 'users', email), {
        email,
        displayName: form.displayName.trim(),
        notifyEmail: form.notifyEmail.trim().toLowerCase(),
        role: form.role,
        active: form.active,
        regions: form.role === 'planner' ? form.regions : [],
      })
      setForm(emptyForm); setEditing(null)
    } catch (e) {
      setError('儲存失敗：' + e.message)
    }
    setSaving(false)
  }

  async function handleDelete(u) {
    await deleteDoc(doc(db, 'users', u.email))
    setDeleteConfirm(null)
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">使用者管理</h1>
          <p className="text-sm text-gray-400 mt-1">白名單制：只有列在這裡的 email 才能登入系統</p>
        </div>
      </div>

      {/* 新增 / 編輯表單 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">{editing ? '編輯使用者' : '新增使用者'}</h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            type="email" placeholder="登入 Email (Gmail)" value={form.email}
            disabled={!!editing}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-100"
          />
          <input
            type="text" placeholder="顯示名稱" value={form.displayName}
            onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <input
            type="email" placeholder="通知信箱 (公司)" value={form.notifyEmail}
            onChange={e => setForm(f => ({ ...f, notifyEmail: e.target.value }))}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={form.role}
            onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={form.active}
              onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
            啟用
          </label>
        </div>
        {form.role === 'planner' && (
          <div className="mt-3">
            <p className="text-xs font-medium text-gray-600 mb-1.5">負責區域(planner 可看到這些區域的需求)</p>
            <div className="flex flex-wrap gap-1.5">
              {REGIONS.map(r => {
                const on = form.regions.includes(r)
                return (
                  <button type="button" key={r}
                    onClick={() => setForm(f => ({ ...f, regions: on ? f.regions.filter(x => x !== r) : [...f.regions, r] }))}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                      on ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                    }`}>
                    {r}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
        <div className="flex gap-2 mt-3">
          <button onClick={handleSave} disabled={saving}
            className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? '儲存中…' : editing ? '更新' : '新增'}
          </button>
          {editing && (
            <button onClick={openCreate} className="text-sm px-4 py-2 rounded-lg text-gray-500 hover:bg-gray-100">
              取消
            </button>
          )}
        </div>
      </div>

      {/* 使用者列表 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-4 py-3 font-medium">登入 Email</th>
              <th className="text-left px-4 py-3 font-medium">名稱</th>
              <th className="text-left px-4 py-3 font-medium">通知信箱(公司)</th>
              <th className="text-left px-4 py-3 font-medium">角色</th>
              <th className="text-left px-4 py-3 font-medium">狀態</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-700">
                  {u.email}
                  {u.email === myEmail && <span className="ml-2 text-xs text-blue-400">(你)</span>}
                </td>
                <td className="px-4 py-3 text-gray-600">{u.displayName || '—'}</td>
                <td className="px-4 py-3 text-gray-600">{u.notifyEmail || <span className="text-amber-500">未設定</span>}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${roleMeta(u.role).color}`}>{roleMeta(u.role).label}</span>
                  {u.role === 'planner' && (
                    <div className="text-xs text-gray-400 mt-1">{u.regions?.length ? u.regions.join(', ') : '未設定區域'}</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  {u.active === false
                    ? <span className="text-xs text-gray-400">已停用</span>
                    : <span className="text-xs text-green-600">啟用中</span>}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => openEdit(u)} className="text-xs text-blue-500 hover:underline mr-3">編輯</button>
                  {u.email === myEmail
                    ? <span className="text-xs text-gray-300">—</span>
                    : deleteConfirm === u.email
                      ? (
                        <>
                          <button onClick={() => handleDelete(u)} className="text-xs text-red-600 hover:underline mr-2">確認刪除</button>
                          <button onClick={() => setDeleteConfirm(null)} className="text-xs text-gray-400 hover:underline">取消</button>
                        </>
                      )
                      : <button onClick={() => setDeleteConfirm(u.email)} className="text-xs text-red-400 hover:underline">刪除</button>}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-sm">尚無使用者</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
