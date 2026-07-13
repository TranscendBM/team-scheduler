import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { REGIONS, DOC_TYPES } from '../utils/requestConstants'

const empty = { urgent: false, region: '', projectName: '', docTypes: [], dueDate: '', description: '' }

export default function RequestNewPage() {
  const { user, email } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  function toggleDocType(t) {
    setForm(f => ({
      ...f,
      docTypes: f.docTypes.includes(t) ? f.docTypes.filter(x => x !== t) : [...f.docTypes, t],
    }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!form.region) { setError('請選擇地區'); return }
    if (!form.projectName.trim()) { setError('請填寫專案名稱'); return }
    if (form.docTypes.length === 0) { setError('請至少勾選一個稿件類型'); return }
    if (!form.dueDate) { setError('請選擇交期'); return }
    setSaving(true)
    try {
      await addDoc(collection(db, 'requests'), {
        urgent: form.urgent,
        region: form.region,
        projectName: form.projectName.trim(),
        docTypes: form.docTypes,
        dueDate: form.dueDate,
        description: form.description.trim(),
        attachments: [],
        submittedBy: email,
        submittedByName: user?.displayName || email,
        status: 'pending',
        createdAt: serverTimestamp(),
      })
      setDone(true)
      setTimeout(() => navigate('/my-requests'), 1200)
    } catch (e) {
      console.error(e)
      setError('送出失敗：' + (e.code || e.message))
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">✅</div>
          <h2 className="text-lg font-semibold text-emerald-800">需求已送出</h2>
          <p className="text-sm text-emerald-600 mt-1">狀態：待審核，正在前往「我的需求」…</p>
        </div>
      </div>
    )
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none'

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">提交設計需求</h1>
      <p className="text-sm text-gray-400 mb-6">送出後會進入設計主管審核，狀態預設為「待審核」</p>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-5">
        {/* 發稿類型 / 急件 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">發稿類型</label>
          <label className="flex items-center gap-2 text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 cursor-pointer">
            <input type="checkbox" checked={form.urgent}
              onChange={e => setForm(f => ({ ...f, urgent: e.target.checked }))} />
            <span>🔥 急件</span>
            <span className="text-xs text-amber-600">（L/T 少於 5 個工作天，請勾選急件）</span>
          </label>
        </div>

        {/* 地區 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">地區 <span className="text-red-500">*</span></label>
          <select value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))} className={inputCls}>
            <option value="">請選擇地區…</option>
            {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        {/* 專案名稱 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">專案名稱 <span className="text-red-500">*</span></label>
          <input type="text" value={form.projectName}
            onChange={e => setForm(f => ({ ...f, projectName: e.target.value }))}
            className={inputCls} placeholder="區域_案名_類型，ex: LA_FathersDay_Banner" />
        </div>

        {/* 稿件類型（可複選） */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">稿件類型（可複選）<span className="text-red-500">*</span></label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {DOC_TYPES.map(t => (
              <label key={t}
                className={`flex items-center gap-2 text-sm rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                  form.docTypes.includes(t) ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}>
                <input type="checkbox" checked={form.docTypes.includes(t)} onChange={() => toggleDocType(t)} />
                {t}
              </label>
            ))}
          </div>
        </div>

        {/* 交期 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">交期 <span className="text-red-500">*</span></label>
          <input type="date" value={form.dueDate}
            onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} className={inputCls} />
        </div>

        {/* 需求簡述 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">需求簡述</label>
          <textarea value={form.description} rows={3}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            className={inputCls}
            placeholder="如果是既有稿件修稿，請加註原設計師" />
        </div>

        {/* 上傳提案（待 Storage/Blaze 開通） */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">上傳提案</label>
          <div className="border border-dashed border-gray-200 rounded-lg p-3 text-xs text-gray-400 bg-gray-50">
            📎 簡報 / 試算表 / Word / PDF，上限 10MB —— 附件上傳將於 Firebase Storage 開通後啟用
          </div>
        </div>

        <div className="text-xs text-gray-400">提交人：{user?.displayName || email}（自動帶入）</div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button type="submit" disabled={saving}
          className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving ? '送出中…' : '送出需求'}
        </button>
      </form>
    </div>
  )
}
