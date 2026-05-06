import { useEffect, useState } from 'react'
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'

const emptyForm = { name: '', role: 'designer', email: '' }

export default function PeoplePage() {
  const { isAdmin } = useAuth()
  const [people, setPeople] = useState([])
  const [projects, setProjects] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editPerson, setEditPerson] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'people'), snap =>
      setPeople(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    const u2 = onSnapshot(collection(db, 'projects'), snap =>
      setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
    return () => { u1(); u2() }
  }, [])

  function openCreate() {
    setEditPerson(null)
    setForm(emptyForm)
    setShowModal(true)
  }

  function openEdit(p) {
    setEditPerson(p)
    setForm({ name: p.name, role: p.role, email: p.email || '' })
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.name) return
    setSaving(true)
    const data = { name: form.name, role: form.role, email: form.email }
    try {
      if (editPerson) {
        await updateDoc(doc(db, 'people', editPerson.id), data)
      } else {
        await addDoc(collection(db, 'people'), { ...data, createdAt: new Date().toISOString() })
      }
      setShowModal(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    await deleteDoc(doc(db, 'people', id))
    setDeleteConfirm(null)
  }

  function getAssignedProjects(personId) {
    return projects.filter(p => (p.assignments || []).some(a => a.personId === personId))
  }

  const designers = people.filter(p => p.role === 'designer').sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'))
  const planners = people.filter(p => p.role === 'planner').sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'))

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
        <div>
          <h2 className="text-xl font-bold text-gray-800">人員管理</h2>
          <p className="text-sm text-gray-400">{people.length} 位成員</p>
        </div>
        {isAdmin && (
          <button onClick={openCreate}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
            + 新增成員
          </button>
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
            <p className="text-sm text-gray-400 pl-4">尚未新增設計師</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {designers.map(p => <PersonCard key={p.id} person={p} assignedProjects={getAssignedProjects(p.id)} isAdmin={isAdmin} onEdit={openEdit} onDelete={setDeleteConfirm} />)}
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
            <p className="text-sm text-gray-400 pl-4">尚未新增 Planner</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {planners.map(p => <PersonCard key={p.id} person={p} assignedProjects={getAssignedProjects(p.id)} isAdmin={isAdmin} onEdit={openEdit} onDelete={setDeleteConfirm} />)}
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-800">{editPerson ? '編輯成員' : '新增成員'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Email（選填）</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="example@company.com"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="px-6 py-4 border-t flex gap-3 justify-end">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
              <button onClick={handleSave} disabled={saving || !form.name}
                className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 font-medium">
                {saving ? '儲存中…' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">確認刪除</h3>
            <p className="text-sm text-gray-500 mb-6">刪除後將從所有專案的指派中移除，確定要刪除嗎？</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
              <button onClick={() => handleDelete(deleteConfirm)} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">刪除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PersonCard({ person, assignedProjects, isAdmin, onEdit, onDelete }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0 ${person.role === 'designer' ? 'bg-purple-500' : 'bg-teal-500'}`}>
            {person.name.charAt(0)}
          </div>
          <div>
            <p className="font-semibold text-gray-800">{person.name}</p>
            <p className="text-xs text-gray-400">{person.role === 'designer' ? '設計師' : 'Planner'}</p>
            {person.email && (
              <p className="text-xs text-gray-400 truncate max-w-[140px]">{person.email}</p>
            )}
          </div>
        </div>
        {isAdmin && (
          <div className="flex gap-1">
            <button onClick={() => onEdit(person)} className="text-xs text-blue-500 hover:text-blue-700 p-1 rounded hover:bg-blue-50">編輯</button>
            <button onClick={() => onDelete(person.id)} className="text-xs text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50">刪除</button>
          </div>
        )}
      </div>
      {assignedProjects.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-xs text-gray-400 mb-1">目前負責 {assignedProjects.length} 個專案</p>
          <div className="flex flex-wrap gap-1">
            {assignedProjects.slice(0, 3).map(p => (
              <span key={p.id} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded truncate max-w-[120px]">{p.name}</span>
            ))}
            {assignedProjects.length > 3 && <span className="text-xs text-gray-400">+{assignedProjects.length - 3}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
