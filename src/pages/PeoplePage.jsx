import { useEffect, useState } from 'react'
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, setDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { REGIONS } from '../utils/requestConstants'

const renameUserLoginFn = httpsCallable(functions, 'renameUserLogin')

// 整合「人員管理」（people：可指派專案的設計師/Planner 名冊）與「使用者管理」
// （users：登入白名單，doc id 是登入用的 Gmail）成同一頁。兩個 Firestore collection 仍分開存放
// （people 的 doc id 被所有專案的 assignments[].personId 引用，users 的 doc id 是登入 email，
//  合併成單一 collection 需要遷移全部專案資料、且牽動登入白名單這種安全機制，風險過高不值得）。
// 比對兩邊資料用的是「公司信箱」：people.email 對應 users.notifyEmail（兩者本來就是同一組公司信箱），
// 不是 users 的 doc id（那是 Gmail 登入帳號，跟公司信箱是兩個不同的值，之前誤用 Gmail 去比對過一次）。
const emptyForm = { name: '', role: 'designer', email: '', grantLogin: false, newLoginEmail: '', active: true, regions: [] }
const emptyManagerForm = { email: '', displayName: '', notifyEmail: '', active: true }

export default function PeoplePage() {
  const { isManager, email: myEmail } = useAuth()
  const [people, setPeople] = useState([])
  const [users, setUsers] = useState([])
  const [projects, setProjects] = useState([])

  const [showModal, setShowModal] = useState(false)
  const [editPerson, setEditPerson] = useState(null)
  const [matchedLogin, setMatchedLogin] = useState(null) // 編輯中這位成員目前已存在的登入帳號（users doc），null = 尚未開通
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [revokeConfirm, setRevokeConfirm] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  const [showManagerModal, setShowManagerModal] = useState(false)
  const [editManagerEmail, setEditManagerEmail] = useState(null)
  const [managerForm, setManagerForm] = useState(emptyManagerForm)
  const [managerSaving, setManagerSaving] = useState(false)
  const [managerError, setManagerError] = useState('')
  const [deleteManagerConfirm, setDeleteManagerConfirm] = useState(null)

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'people'), snap => setPeople(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    const u2 = onSnapshot(collection(db, 'projects'), snap => setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return () => { u1(); u2() }
  }, [])

  // users collection 依安全規則只有 manager 能整表讀取，非 manager 不訂閱，避免 permission-denied
  useEffect(() => {
    if (!isManager) return
    const unsub = onSnapshot(collection(db, 'users'), snap => setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return () => { unsub(); setUsers([]) }
  }, [isManager])

  // 用「公司信箱」比對：people.email ↔ users.notifyEmail（users 的 doc id 是 Gmail，跟公司信箱是兩回事）
  function findLoginForPerson(companyEmail) {
    if (!companyEmail) return null
    const e = companyEmail.trim().toLowerCase()
    return users.find(u => (u.notifyEmail || '').trim().toLowerCase() === e) || null
  }

  function getAssignedProjects(personId) {
    return projects.filter(p => (p.assignments || []).some(a => a.personId === personId))
  }

  function openCreate() {
    setEditPerson(null)
    setMatchedLogin(null)
    setForm(emptyForm)
    setError('')
    setRevokeConfirm(false)
    setShowModal(true)
  }

  function openEdit(p) {
    setEditPerson(p)
    const u = findLoginForPerson(p.email)
    setMatchedLogin(u)
    setForm({
      name: p.name, role: p.role, email: p.email || '',
      grantLogin: !!u, newLoginEmail: u?.email || '',
      active: u ? u.active !== false : true,
      regions: u?.regions || [],
    })
    setError('')
    setRevokeConfirm(false)
    setShowModal(true)
  }

  async function handleSave() {
    if (!isManager || !form.name) return
    const email = form.email.trim().toLowerCase()

    let newLoginEmail = null
    if (matchedLogin || form.grantLogin) {
      newLoginEmail = form.newLoginEmail.trim().toLowerCase()
      if (!newLoginEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newLoginEmail)) {
        setError('請輸入有效的 Gmail 登入信箱')
        return
      }
      // 換過 Gmail 時先做一次前端檢查有沒有被別人用掉，給即時錯誤訊息；
      // 真正保證不會撞名額的是 Cloud Function 那邊在伺服器端重新檢查一次(見下方 renameUserLoginFn)
      const conflict = users.find(u => u.email === newLoginEmail && u.email !== matchedLogin?.email)
      if (conflict) {
        setError(`這個 Gmail 已經被「${conflict.displayName || conflict.email}」使用中`)
        return
      }
    }

    setError('')
    setSaving(true)
    try {
      const peopleData = { name: form.name, role: form.role, email }
      if (editPerson) {
        await updateDoc(doc(db, 'people', editPerson.id), peopleData)
      } else {
        await addDoc(collection(db, 'people'), { ...peopleData, createdAt: new Date().toISOString() })
      }

      const userData = {
        displayName: form.name, notifyEmail: email, role: form.role, active: form.active,
        regions: form.role === 'planner' ? form.regions : [],
      }

      if (matchedLogin && newLoginEmail !== matchedLogin.email) {
        // 換過 Gmail 登入信箱：交給受保護的 Cloud Function(renameUserLogin，見 functions/index.js)
        // 在後端一次做完「建立新帳號 → 搬遷 requests 裡所有引用舊信箱的地方 → 確認搬完才刪舊帳號」，
        // 不再由前端分好幾步各自寫、寫到一半失敗就留下不一致資料；只有後端完全成功後，畫面才會更新。
        await renameUserLoginFn({ oldEmail: matchedLogin.email, newEmail: newLoginEmail })
        await updateDoc(doc(db, 'users', newLoginEmail), userData)
      } else if (matchedLogin) {
        await updateDoc(doc(db, 'users', matchedLogin.email), userData)
      } else if (newLoginEmail) {
        await setDoc(doc(db, 'users', newLoginEmail), { ...userData, email: newLoginEmail })
      }

      setShowModal(false)
    } catch (e) {
      setError('儲存失敗：' + (e.message || e.code))
    }
    setSaving(false)
  }

  async function handleRevokeLogin() {
    if (!isManager || !matchedLogin) return
    await deleteDoc(doc(db, 'users', matchedLogin.email))
    setMatchedLogin(null)
    setForm(f => ({ ...f, grantLogin: false }))
    setRevokeConfirm(false)
  }

  async function handleDelete(id) {
    if (!isManager) return
    const p = people.find(x => x.id === id)
    await deleteDoc(doc(db, 'people', id))
    const u = p ? findLoginForPerson(p.email) : null
    if (u) await deleteDoc(doc(db, 'users', u.email))
    setDeleteConfirm(null)
  }

  // ── 主管帳號（僅存在於 users，無 people 名冊資料，不參與專案指派）──
  function openManagerCreate() {
    setEditManagerEmail(null)
    setManagerForm(emptyManagerForm)
    setManagerError('')
    setShowManagerModal(true)
  }
  function openManagerEdit(u) {
    setEditManagerEmail(u.email)
    setManagerForm({ email: u.email, displayName: u.displayName || '', notifyEmail: u.notifyEmail || '', active: u.active !== false })
    setManagerError('')
    setShowManagerModal(true)
  }
  async function handleManagerSave() {
    if (!isManager) return
    const email = managerForm.email.trim().toLowerCase()
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setManagerError('請輸入有效的 email'); return }
    if (!editManagerEmail && users.some(u => u.email === email)) { setManagerError('此 email 已存在'); return }
    setManagerSaving(true)
    try {
      await setDoc(doc(db, 'users', email), {
        email, displayName: managerForm.displayName.trim(), notifyEmail: managerForm.notifyEmail.trim().toLowerCase(),
        role: 'manager', active: managerForm.active, regions: [],
      })
      setShowManagerModal(false)
    } catch (e) {
      setManagerError('儲存失敗：' + e.message)
    }
    setManagerSaving(false)
  }
  async function handleManagerDelete(email) {
    if (!isManager) return
    await deleteDoc(doc(db, 'users', email))
    setDeleteManagerConfirm(null)
  }

  const designers = people.filter(p => p.role === 'designer').sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'))
  const planners = people.filter(p => p.role === 'planner').sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'))
  const managerUsers = users.filter(u => u.role === 'manager').sort((a, b) => a.email.localeCompare(b.email))

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
        <div>
          <h2 className="text-xl font-bold text-gray-800">人員管理</h2>
          <p className="text-sm text-gray-500">
            {people.length} 位成員{isManager && managerUsers.length > 0 ? `、${managerUsers.length} 位主管帳號` : ''}
          </p>
        </div>
        {isManager && (
          <div className="flex items-center gap-2">
            <button onClick={openManagerCreate}
              className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium">
              + 新增主管帳號
            </button>
            <button onClick={openCreate}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
              + 新增成員
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Designers */}
        <div>
          <h3 className="text-sm font-semibold text-purple-700 mb-3 flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-purple-400" />
            設計師 ({designers.length})
          </h3>
          {designers.length === 0 ? (
            <p className="text-sm text-gray-500 pl-4">尚未新增設計師</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {designers.map(p => (
                <PersonCard key={p.id} person={p} assignedProjects={getAssignedProjects(p.id)}
                  isManager={isManager} loginUser={findLoginForPerson(p.email)} onEdit={openEdit} onDelete={setDeleteConfirm} />
              ))}
            </div>
          )}
        </div>

        {/* Planners */}
        <div>
          <h3 className="text-sm font-semibold text-teal-700 mb-3 flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-teal-400" />
            Planner ({planners.length})
          </h3>
          {planners.length === 0 ? (
            <p className="text-sm text-gray-500 pl-4">尚未新增 Planner</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {planners.map(p => (
                <PersonCard key={p.id} person={p} assignedProjects={getAssignedProjects(p.id)}
                  isManager={isManager} loginUser={findLoginForPerson(p.email)} onEdit={openEdit} onDelete={setDeleteConfirm} />
              ))}
            </div>
          )}
        </div>

        {/* 主管帳號（僅 manager 看得到；不屬於可指派名冊） */}
        {isManager && (
          <div>
            <h3 className="text-sm font-semibold text-indigo-700 mb-3 flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-indigo-400" />
              主管帳號 ({managerUsers.length})
            </h3>
            {managerUsers.length === 0 ? (
              <p className="text-sm text-gray-500 pl-4">尚無主管帳號</p>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium">登入 Email (Gmail)</th>
                      <th className="text-left px-4 py-2.5 font-medium">名稱</th>
                      <th className="text-left px-4 py-2.5 font-medium">通知信箱</th>
                      <th className="text-left px-4 py-2.5 font-medium">狀態</th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {managerUsers.map(u => (
                      <tr key={u.email} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-gray-700">
                          {u.email}{u.email === myEmail && <span className="ml-2 text-xs text-blue-400">(你)</span>}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">{u.displayName || '—'}</td>
                        <td className="px-4 py-2.5 text-gray-600">{u.notifyEmail || <span className="text-amber-500">未設定</span>}</td>
                        <td className="px-4 py-2.5">
                          {u.active === false ? <span className="text-xs text-gray-500">已停用</span> : <span className="text-xs text-green-600">啟用中</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <button onClick={() => openManagerEdit(u)} className="text-xs text-blue-500 hover:underline mr-3">編輯</button>
                          {u.email === myEmail ? (
                            <span className="text-xs text-gray-500">—</span>
                          ) : deleteManagerConfirm === u.email ? (
                            <>
                              <button onClick={() => handleManagerDelete(u.email)} className="text-xs text-red-600 hover:underline mr-2">確認刪除</button>
                              <button onClick={() => setDeleteManagerConfirm(null)} className="text-xs text-gray-500 hover:underline">取消</button>
                            </>
                          ) : (
                            <button onClick={() => setDeleteManagerConfirm(u.email)} className="text-xs text-red-400 hover:underline">刪除</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 成員（設計師/Planner）新增／編輯 modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
              <h3 className="text-lg font-semibold text-gray-800">{editPerson ? '編輯成員' : '新增成員'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">姓名 *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="請輸入姓名"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">角色</label>
                <div className="flex gap-3">
                  {[['designer', '設計師', 'purple'], ['planner', 'Planner', 'teal']].map(([val, label, color]) => (
                    <button key={val} onClick={() => setForm(f => ({ ...f, role: val }))}
                      className={`flex-1 py-2.5 rounded-lg text-sm font-medium border-2 transition-colors ${
                        form.role === val
                          ? color === 'purple' ? 'bg-purple-600 border-purple-600 text-white' : 'bg-teal-600 border-teal-600 text-white'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">公司信箱</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="name@transcend-info.com"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <p className="text-xs text-gray-500 mt-1">用來對照登入帳號、寄發通知信；跟下方 Gmail 登入信箱是不同的信箱</p>
              </div>

              {isManager && (
                <div className="border border-gray-200 rounded-lg p-4">
                  {matchedLogin ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-gray-700">此人已用 Gmail 登入本系統</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${matchedLogin.active === false ? 'bg-gray-100 text-gray-500' : 'bg-green-100 text-green-700'}`}>
                          {matchedLogin.active === false ? '已停用' : '啟用中'}
                        </span>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Gmail 登入信箱</label>
                        <input type="email" value={form.newLoginEmail} onChange={e => setForm(f => ({ ...f, newLoginEmail: e.target.value }))}
                          className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
                        {form.newLoginEmail.trim().toLowerCase() !== matchedLogin.email && (
                          <p className="text-xs text-amber-600 mt-1">同仁換了 Gmail 帳號可以直接改這裡；儲存後原本的 {matchedLogin.email} 會失效</p>
                        )}
                      </div>
                      <label className="flex items-center gap-2 text-sm text-gray-600">
                        <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
                        啟用（停用後無法登入，但保留名冊資料）
                      </label>
                      {form.role === 'planner' && (
                        <div>
                          <p className="text-xs font-medium text-gray-600 mb-1.5">負責區域（可看到這些區域的需求）</p>
                          <div className="flex flex-wrap gap-1.5">
                            {REGIONS.map(r => {
                              const on = form.regions.includes(r)
                              return (
                                <button type="button" key={r}
                                  onClick={() => setForm(f => ({ ...f, regions: on ? f.regions.filter(x => x !== r) : [...f.regions, r] }))}
                                  className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${on ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                                  {r}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      <div className="pt-1">
                        {revokeConfirm ? (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-red-600">確定撤銷登入權限？</span>
                            <button onClick={handleRevokeLogin} className="text-red-600 hover:underline font-medium">確認撤銷</button>
                            <button onClick={() => setRevokeConfirm(false)} className="text-gray-500 hover:underline">取消</button>
                          </div>
                        ) : (
                          <button onClick={() => setRevokeConfirm(true)} className="text-xs text-red-400 hover:text-red-600 hover:underline">
                            撤銷登入權限
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
                        <input type="checkbox" checked={form.grantLogin}
                          onChange={e => setForm(f => ({ ...f, grantLogin: e.target.checked }))} />
                        開通系統登入權限
                      </label>
                      <p className="text-xs text-gray-500 mb-3">找不到跟上方公司信箱對應的登入帳號；勾選後可以新開通一個</p>
                      {form.grantLogin && (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Gmail 登入信箱 *</label>
                            <input type="email" value={form.newLoginEmail} onChange={e => setForm(f => ({ ...f, newLoginEmail: e.target.value }))}
                              placeholder="name@gmail.com"
                              className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
                          </div>
                          <label className="flex items-center gap-2 text-sm text-gray-600">
                            <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
                            啟用
                          </label>
                          {form.role === 'planner' && (
                            <div>
                              <p className="text-xs font-medium text-gray-600 mb-1.5">負責區域（可看到這些區域的需求）</p>
                              <div className="flex flex-wrap gap-1.5">
                                {REGIONS.map(r => {
                                  const on = form.regions.includes(r)
                                  return (
                                    <button type="button" key={r}
                                      onClick={() => setForm(f => ({ ...f, regions: on ? f.regions.filter(x => x !== r) : [...f.regions, r] }))}
                                      className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${on ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                                      {r}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {error && <p className="text-red-500 text-xs">{error}</p>}
            </div>
            <div className="px-6 py-4 border-t flex gap-3 justify-end sticky bottom-0 bg-white">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
              <button onClick={handleSave} disabled={saving || !form.name}
                className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 font-medium">
                {saving ? '儲存中…' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 成員刪除確認 */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">確認刪除</h3>
            <p className="text-sm text-gray-500 mb-6">
              刪除後將從所有專案的指派中移除{findLoginForPerson(people.find(p => p.id === deleteConfirm)?.email) ? '，並同時刪除其登入帳號' : ''}，確定要刪除嗎？
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
              <button onClick={() => handleDelete(deleteConfirm)} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">刪除</button>
            </div>
          </div>
        </div>
      )}

      {/* 主管帳號新增／編輯 modal */}
      {showManagerModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && setShowManagerModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-800">{editManagerEmail ? '編輯主管帳號' : '新增主管帳號'}</h3>
              <button onClick={() => setShowManagerModal(false)} className="text-gray-500 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-6 py-5 space-y-3">
              <input type="email" placeholder="登入 Email (Gmail)" value={managerForm.email} disabled={!!editManagerEmail}
                onChange={e => setManagerForm(f => ({ ...f, email: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-100" />
              <input type="text" placeholder="顯示名稱" value={managerForm.displayName}
                onChange={e => setManagerForm(f => ({ ...f, displayName: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <input type="email" placeholder="通知信箱（公司，選填）" value={managerForm.notifyEmail}
                onChange={e => setManagerForm(f => ({ ...f, notifyEmail: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={managerForm.active} onChange={e => setManagerForm(f => ({ ...f, active: e.target.checked }))} />
                啟用
              </label>
              {managerError && <p className="text-red-500 text-xs">{managerError}</p>}
            </div>
            <div className="px-6 py-4 border-t flex gap-3 justify-end">
              <button onClick={() => setShowManagerModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
              <button onClick={handleManagerSave} disabled={managerSaving}
                className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
                {managerSaving ? '儲存中…' : editManagerEmail ? '更新' : '新增'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PersonCard({ person, assignedProjects, isManager, loginUser, onEdit, onDelete }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0 ${person.role === 'designer' ? 'bg-purple-500' : 'bg-teal-500'}`}>
            {person.name.charAt(0)}
          </div>
          <div>
            <p className="font-semibold text-gray-800">{person.name}</p>
            <p className="text-xs text-gray-500">{person.role === 'designer' ? '設計師' : 'Planner'}</p>
            {person.email && (
              <p className="text-xs text-gray-500 truncate max-w-[140px]">{person.email}</p>
            )}
          </div>
        </div>
        {isManager && (
          <div className="flex gap-1">
            <button onClick={() => onEdit(person)} className="text-xs text-blue-500 hover:text-blue-700 p-1 rounded hover:bg-blue-50">編輯</button>
            <button onClick={() => onDelete(person.id)} className="text-xs text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50">刪除</button>
          </div>
        )}
      </div>

      {isManager && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex items-center flex-wrap gap-x-3 gap-y-1">
          {loginUser ? (
            <>
              <span className={`text-xs px-2 py-0.5 rounded-full ${loginUser.active === false ? 'bg-gray-100 text-gray-500' : 'bg-green-100 text-green-700'}`}>
                {loginUser.active === false ? '登入已停用' : '登入啟用中'}
              </span>
              {person.role === 'planner' && (
                <span className="text-xs text-gray-500">{loginUser.regions?.length ? loginUser.regions.join('、') : '未設定區域'}</span>
              )}
            </>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-600">尚未開通登入</span>
          )}
        </div>
      )}

      {assignedProjects.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-xs text-gray-500 mb-1">目前負責 {assignedProjects.length} 個專案</p>
          <div className="flex flex-wrap gap-1">
            {assignedProjects.slice(0, 3).map(p => (
              <span key={p.id} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded truncate max-w-[120px]">{p.name}</span>
            ))}
            {assignedProjects.length > 3 && <span className="text-xs text-gray-500">+{assignedProjects.length - 3}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
