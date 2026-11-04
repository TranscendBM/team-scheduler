import { useState } from 'react'
import { collection, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { REGIONS, DOC_TYPES } from '../utils/requestConstants'

const empty = { urgent: false, region: '', projectName: '', docTypes: [], dueDate: '', description: '' }

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none'

// 設計師自行新增工作：窗口直接寄信給設計師時，設計師自己把工作項目登記進系統，不用再經過
// 提交 → 主管審核 → 指派。建立出來的需求直接是「設計中」、只指派給自己，並標記 selfCreated。
// (Firestore 規則 isValidSelfCreate 只允許設計師「建給自己」，這裡的欄位必須跟規則完全一致)
// 傳入 request 代表編輯自己先前自建的工作(只能改內容欄位，不能動狀態/指派)。
export default function SelfRequestModal({ request, email, designerName, onClose }) {
  const [form, setForm] = useState(() => request ? {
    urgent: !!request.urgent, region: request.region || '', projectName: request.projectName || '',
    docTypes: request.docTypes || [], dueDate: request.dueDate || '', description: request.description || '',
  } : empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const toggleDocType = (t) => setForm(f => ({
    ...f, docTypes: f.docTypes.includes(t) ? f.docTypes.filter(x => x !== t) : [...f.docTypes, t],
  }))

  async function handleSave() {
    if (!form.projectName.trim()) { setError('請填寫專案名稱'); return }
    if (!form.region) { setError('請選擇地區'); return }
    if (form.docTypes.length === 0) { setError('請至少勾選一個稿件類型'); return }
    if (!form.dueDate) { setError('請選擇交期'); return }
    setError('')
    setSaving(true)
    const fields = {
      urgent: form.urgent,
      region: form.region,
      projectName: form.projectName.trim(),
      docTypes: form.docTypes,
      dueDate: form.dueDate,
      description: form.description.trim(),
    }
    try {
      if (request) {
        await updateDoc(doc(db, 'requests', request.id), fields)
      } else {
        await addDoc(collection(db, 'requests'), {
          ...fields,
          attachments: [],
          submittedBy: email,
          submittedByName: designerName,
          assignedDesigners: [email],
          assignedDesignersNames: [designerName],
          status: 'in_progress',
          startedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          selfCreated: true,
        })
      }
      onClose()
    } catch (e) {
      setError('儲存失敗：' + (e.code || e.message))
      setSaving(false)
    }
  }

  return (
    // 不做點背景關閉：表單填到一半很容易誤觸造成資料遺失
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg font-semibold text-gray-800">{request ? '編輯自建工作' : '新增工作'}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-600 text-xl">×</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {!request && (
            <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              窗口直接寄信給你的工作，可以在這裡自己登記。送出後直接是「設計中」並指派給你，不需要主管審核。
            </p>
          )}

          <label className="flex items-center gap-2 text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 cursor-pointer">
            <input type="checkbox" checked={form.urgent} onChange={e => setForm(f => ({ ...f, urgent: e.target.checked }))} />
            <span>🔥 急件</span>
          </label>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">專案名稱 <span className="text-red-500">*</span></label>
            <input type="text" value={form.projectName} onChange={e => setForm(f => ({ ...f, projectName: e.target.value }))}
              className={inputCls} placeholder="區域_案名_類型，ex: LA_FathersDay_Banner" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">地區 <span className="text-red-500">*</span></label>
            <select value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))} className={inputCls}>
              <option value="">請選擇地區…</option>
              {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">交期 <span className="text-red-500">*</span></label>
            <input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} className={inputCls} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">需求簡述（選填）</label>
            <textarea rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className={inputCls} placeholder="例如：窗口是誰、需求重點" />
          </div>

          {error && <p className="text-red-500 text-xs">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t flex gap-3 justify-end sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 font-medium">
            {saving ? '儲存中…' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  )
}
