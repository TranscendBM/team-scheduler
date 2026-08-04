import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { collection, addDoc, updateDoc, getDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import { REGIONS, DOC_TYPES, MAX_ATTACHMENT_MB } from '../utils/requestConstants'
import { attachmentKey, markRemoved, unmarkRemoved, keptAttachments, removedAttachments, commitWithDeferredDeletion } from '../utils/attachmentDraft'
import { getSafeAttachmentUrl, resolveSafeAttachmentPath } from '../utils/attachmentUrl'

const MAX_BYTES = MAX_ATTACHMENT_MB * 1024 * 1024
const empty = { urgent: false, region: '', projectName: '', docTypes: [], dueDate: '', description: '' }

export default function RequestNewPage() {
  const { user, email } = useAuth()
  const navigate = useNavigate()
  const { id: editId } = useParams() // /request/edit/:id 進來時有值
  const [form, setForm] = useState(empty)
  const [files, setFiles] = useState([])                 // 新選的檔案
  const [existingAtts, setExistingAtts] = useState([])   // 編輯模式:既有附件(這份清單本身不會因為使用者按「移除」而變動)
  const [removedKeys, setRemovedKeys] = useState([])     // 使用者標記要移除的既有附件(storagePath/url) —— 只是草稿狀態，還沒真的刪檔
  const [loading, setLoading] = useState(!!editId)
  const [blocked, setBlocked] = useState('')             // 編輯被拒原因
  const [saving, setSaving] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  // 編輯模式:載入既有需求
  useEffect(() => {
    if (!editId || !email) return
    getDoc(doc(db, 'requests', editId)).then(snap => {
      if (!snap.exists()) { setBlocked('找不到這筆需求'); setLoading(false); return }
      const r = snap.data()
      if (r.submittedBy !== email) { setBlocked('只能編輯自己送出的需求'); setLoading(false); return }
      if (r.status !== 'pending') { setBlocked('此需求已審核(已指派或駁回),無法再編輯。如需調整請聯絡主管。'); setLoading(false); return }
      setForm({
        urgent: !!r.urgent, region: r.region || '', projectName: r.projectName || '',
        docTypes: r.docTypes || [], dueDate: r.dueDate || '', description: r.description || '',
      })
      setExistingAtts(r.attachments || [])
      setRemovedKeys([])
      setLoading(false)
    }).catch(e => { setBlocked('讀取失敗：' + (e.code || e.message)); setLoading(false) })
  }, [editId, email])

  function toggleDocType(t) {
    setForm(f => ({
      ...f,
      docTypes: f.docTypes.includes(t) ? f.docTypes.filter(x => x !== t) : [...f.docTypes, t],
    }))
  }

  function onFilesPicked(e) {
    setError('')
    const picked = Array.from(e.target.files || [])
    const tooBig = picked.find(f => f.size > MAX_BYTES)
    if (tooBig) {
      setError(`「${tooBig.name}」超過 ${MAX_ATTACHMENT_MB}MB 上限`)
      e.target.value = ''
      return
    }
    setFiles(prev => {
      const names = new Set([...prev.map(f => f.name), ...keptAttachments(existingAtts, removedKeys).map(a => a.name)])
      return [...prev, ...picked.filter(f => !names.has(f.name))]
    })
    e.target.value = ''
  }

  const removeFile = (name) => setFiles(prev => prev.filter(f => f.name !== name))

  // 點「移除」只是標記草稿狀態，不會立刻刪 Storage 檔案 —— 使用者可能接著按「取消」離開頁面、
  // 或送出時 Firestore 更新失敗，這兩種情況都不該把檔案刪掉(Firestore 那邊還在引用它)。
  // 真正的刪除動作留到 handleSubmit 裡 Firestore 更新成功「之後」才做。
  const removeExisting = (att) => setRemovedKeys(prev => markRemoved(prev, att))
  // 使用者反悔，把標記移除的附件加回來
  const restoreExisting = (att) => setRemovedKeys(prev => unmarkRemoved(prev, att))

  // Firestore 已經成功寫入、不再引用這些附件之後才呼叫:真的刪除 Storage 上的檔案。
  // requestId 一定要傳入 —— 每個附件都要透過 resolveSafeAttachmentPath 重新驗證「這個附件的
  // storagePath/url 是否真的屬於這筆 request」，不能直接信任 attachment.storagePath 或用寬鬆的
  // 字串反推路徑就拿去刪。manager 可以刪任何 request 的附件，若不做這層驗證，壞掉或被竄改的
  // metadata 可能讓 UI 對著 requestId A 卻刪到別筆 request 的物件(confused-deputy)。
  // 驗證失敗(resolveSafeAttachmentPath 回傳 null)一律跳過、不呼叫 deleteObject，只記錄 warning、
  // 允許留下孤兒檔案 —— 絕不能因為刪檔失敗就反過來影響已經成功寫入的 Firestore metadata。
  // 單一檔案的 deleteObject 失敗(權限、檔案已不存在等)也只記錄 error、不擋流程。
  async function deleteAttachmentFiles(atts, requestId) {
    await Promise.allSettled(atts.map(async (att) => {
      const path = resolveSafeAttachmentPath(att, requestId)
      if (!path) {
        console.warn('附件路徑驗證失敗，跳過刪除(留下孤兒檔案，不信任未經驗證的路徑)', att.name, { requestId })
        return
      }
      try {
        await deleteObject(ref(storage, path))
      } catch (e) {
        console.error('刪除附件檔案失敗(metadata 已不再引用，留下孤兒檔案)', att.name, e)
      }
    }))
  }

  // 儲存檔名一律轉成安全 ASCII(Office 線上檢視器對空格/中文等 %-編碼字元會 file not found)
  // 顯示名稱仍保留原檔名,使用者無感
  function safeFileName(name, idx) {
    const dot = name.lastIndexOf('.')
    const base = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g, '') : ''
    const safe = base.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
    const uniq = Date.now().toString(36) + idx
    return `${safe || 'file'}-${uniq}${ext}`
  }

  async function uploadFiles(requestId) {
    const uploaded = []
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        setUploadMsg(`上傳附件 ${i + 1}/${files.length}：${file.name}`)
        const storagePath = `attachments/${requestId}/${safeFileName(file.name, i)}`
        const storageRef = ref(storage, storagePath)
        await uploadBytes(storageRef, file)
        const url = await getDownloadURL(storageRef)
        uploaded.push({ name: file.name, url, size: file.size, storagePath })
      }
      return uploaded
    } catch (e) {
      // 上傳到一半失敗:清掉這次已經成功上傳的檔案，不留下孤兒檔案
      await Promise.allSettled(uploaded.map(a => deleteObject(ref(storage, a.storagePath))))
      throw e
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!form.region) { setError('請選擇地區'); return }
    if (!form.projectName.trim()) { setError('請填寫專案名稱'); return }
    if (form.docTypes.length === 0) { setError('請至少勾選一個稿件類型'); return }
    if (!form.dueDate) { setError('請選擇交期'); return }
    setSaving(true)
    const fields = {
      urgent: form.urgent,
      region: form.region,
      projectName: form.projectName.trim(),
      docTypes: form.docTypes,
      dueDate: form.dueDate,
      description: form.description.trim(),
    }
    let uploaded = []
    let createdRequestId = null
    const toRemove = editId ? removedAttachments(existingAtts, removedKeys) : []
    try {
      if (editId) {
        // 編輯:上傳新附件 + 合併既有「保留」的附件(草稿裡標記移除的先不動 Storage)。
        // commitWithDeferredDeletion 保證:Firestore 寫入沒成功，絕不會進到刪檔那一步。
        uploaded = await uploadFiles(editId)
        setUploadMsg('儲存中…')
        await commitWithDeferredDeletion(
          () => updateDoc(doc(db, 'requests', editId), {
            ...fields,
            attachments: [...keptAttachments(existingAtts, removedKeys), ...uploaded],
          }),
          () => deleteAttachmentFiles(toRemove, editId)
        )
      } else {
        const docRef = await addDoc(collection(db, 'requests'), {
          ...fields,
          attachments: [],
          submittedBy: email,
          submittedByName: user?.displayName || email,
          status: 'pending',
          createdAt: serverTimestamp(),
        })
        createdRequestId = docRef.id
        uploaded = await uploadFiles(docRef.id)
        if (uploaded.length) {
          setUploadMsg('儲存中…')
          await updateDoc(doc(db, 'requests', docRef.id), { attachments: uploaded })
        }
        createdRequestId = null // 全部成功，不需要回滾
      }

      setDone(true)
      setTimeout(() => navigate('/my-requests'), 1200)
    } catch (e) {
      console.error(e)
      // 檔案已經上傳成功、但後面寫 Firestore 失敗:清掉這次剛上傳的檔案，避免孤兒檔案。
      // 使用者標記移除的「舊」附件則完全不動 —— Firestore 更新失敗代表它們仍然被引用中。
      //
      // 順序很重要，一定要先清 Storage、再刪 Firestore 文件、不能反過來:storage.rules 的刪除規則
      // 要靠 firestore.get(requests/{requestId}) 去驗證「呼叫者是不是這筆需求的提交人、且狀態還是
      // pending」才放行；如果先把 Firestore 文件刪了，Storage 規則就再也讀不到這筆需求，
      // 之後任何人(包含這裡的清理)都無法通過擁有者驗證，會白白留下真正的孤兒檔案。
      if (uploaded.length) {
        await Promise.allSettled(uploaded.map(a => deleteObject(ref(storage, a.storagePath))))
      }
      // 新需求的情況:request 文件已經建立、但後續步驟(上傳/寫入附件)失敗，把這個半成品文件刪掉，
      // 避免使用者重試後在「我的需求」看到重複的空需求。firestore.rules 只允許提交人刪除
      // 「自己、pending、attachments 為空」的需求 —— 這正是這個半成品文件在回滾當下唯一可能的狀態。
      if (createdRequestId) {
        try {
          await deleteDoc(doc(db, 'requests', createdRequestId))
        } catch (cleanupErr) {
          console.error('清理失敗的半成品需求文件失敗', cleanupErr)
        }
      }
      setError((editId ? '更新' : '送出') + '失敗：' + (e.code || e.message))
      setSaving(false)
      setUploadMsg('')
    }
  }

  if (loading) return <div className="p-8 text-gray-500 text-sm">載入中…</div>

  if (blocked) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">🔒</div>
          <p className="text-sm text-amber-700">{blocked}</p>
          <button onClick={() => navigate('/my-requests')}
            className="mt-4 text-sm text-blue-600 hover:underline">回我的需求</button>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">✅</div>
          <h2 className="text-lg font-semibold text-emerald-800">{editId ? '需求已更新' : '需求已送出'}</h2>
          <p className="text-sm text-emerald-600 mt-1">狀態：待審核，正在前往「我的需求」…</p>
        </div>
      </div>
    )
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none'

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">{editId ? '編輯設計需求' : '提交設計需求'}</h1>
      <p className="text-sm text-gray-500 mb-6">
        {editId ? '需求仍在「待審核」狀態,可修改內容;審核後即無法編輯' : '送出後會進入主管審核,狀態預設為「待審核」'}
      </p>

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

        {/* 上傳提案 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">上傳提案</label>
          <label className="flex items-center justify-center gap-2 border border-dashed border-gray-300 rounded-lg p-4 text-sm text-gray-500 bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors">
            <span>📎 點此選擇檔案（可多選）</span>
            <input type="file" multiple className="hidden"
              accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.key,.pages,.numbers,image/*"
              onChange={onFilesPicked} />
          </label>
          <p className="text-xs text-gray-500 mt-1">簡報 / 試算表 / Word / PDF，單檔上限 {MAX_ATTACHMENT_MB}MB</p>
          {(existingAtts.length > 0 || files.length > 0) && (
            <ul className="mt-2 space-y-1">
              {existingAtts.map(a => {
                const isRemoved = removedKeys.includes(attachmentKey(a))
                const safeUrl = getSafeAttachmentUrl(a, editId)
                return (
                  <li key={attachmentKey(a)}
                    className={`flex items-center justify-between text-xs rounded-lg px-3 py-1.5 ${isRemoved ? 'bg-red-50 text-red-300' : 'bg-gray-100 text-gray-600'}`}>
                    {isRemoved ? (
                      <span className="truncate line-through">📄 {a.name}（將於儲存後移除）</span>
                    ) : safeUrl ? (
                      <a href={safeUrl} target="_blank" rel="noreferrer noopener" className="truncate hover:underline">📄 {a.name}（已上傳）</a>
                    ) : (
                      <span className="truncate text-red-400" title="連結驗證失敗">📄 {a.name}（連結無效）</span>
                    )}
                    {isRemoved ? (
                      <button type="button" onClick={() => restoreExisting(a)} className="text-blue-400 hover:text-blue-600 ml-2">復原</button>
                    ) : (
                      <button type="button" onClick={() => removeExisting(a)} className="text-gray-500 hover:text-red-500 ml-2">移除</button>
                    )}
                  </li>
                )
              })}
              {files.map(f => (
                <li key={f.name} className="flex items-center justify-between text-xs bg-blue-50 text-blue-700 rounded-lg px-3 py-1.5">
                  <span className="truncate">📄 {f.name}（{(f.size / 1024 / 1024).toFixed(2)}MB）</span>
                  <button type="button" onClick={() => removeFile(f.name)} className="text-blue-400 hover:text-red-500 ml-2">移除</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="text-xs text-gray-500">提交人：{user?.displayName || email}（自動帶入）</div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        {saving && uploadMsg && <p className="text-sm text-blue-500">{uploadMsg}</p>}

        <div className="flex gap-2">
          <button type="submit" disabled={saving}
            className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? (editId ? '更新中…' : '送出中…') : (editId ? '儲存變更' : '送出需求')}
          </button>
          {editId && (
            <button type="button" onClick={() => navigate('/my-requests')}
              className="px-5 py-2.5 rounded-lg text-sm text-gray-500 hover:bg-gray-100">取消</button>
          )}
        </div>
      </form>
    </div>
  )
}
