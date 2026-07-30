import { useState } from 'react'
import { getSafeAttachmentUrl } from '../utils/attachmentUrl'

const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']
const OFFICE_EXT = ['ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx']

const ext = (name) => ((name || '').split('.').pop() || '').toLowerCase()

// Office 檢視器吃不下 Firebase URL 的 %-編碼路徑 → 走 previewFile 代理(乾淨網址、逐檔驗 token)。
// safeUrl 一定是已經通過 getSafeAttachmentUrl 驗證的網址，不是原始未驗證的 a.url。
const PROXY = 'https://asia-east1-team-scheduler-dc7ce.cloudfunctions.net/previewFile'
function proxyUrl(safeUrl, requestId, idx) {
  const token = (safeUrl.match(/token=([\w-]+)/) || [])[1] || ''
  if (!requestId || !token) return null
  return `${PROXY}/${requestId}/${idx}/${token.slice(0, 12)}`
}

// 依副檔名決定預覽方式:image / pdf 原生、office 走 MS 線上檢視器、其他下載。
// safeUrl 一律是已驗證過的網址(見 getSafeAttachmentUrl)，這裡不會再碰原始 a.url。
function previewInfo(a, safeUrl, requestId, idx) {
  const e = ext(a.name)
  if (IMG_EXT.includes(e)) return { kind: 'image', src: safeUrl }
  if (e === 'pdf') return { kind: 'iframe', src: safeUrl }
  if (OFFICE_EXT.includes(e)) {
    const clean = proxyUrl(safeUrl, requestId, idx)
    if (!clean) return { kind: 'download', src: safeUrl }
    return { kind: 'iframe', src: `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(clean)}` }
  }
  return { kind: 'download', src: safeUrl }
}

const icon = (name) => {
  const e = ext(name)
  if (IMG_EXT.includes(e)) return '🖼️'
  if (e === 'pdf') return '📕'
  if (['ppt', 'pptx'].includes(e)) return '📙'
  if (['doc', 'docx'].includes(e)) return '📘'
  if (['xls', 'xlsx'].includes(e)) return '📗'
  return '📄'
}

// 顯示需求附件:點擊站內預覽(圖片/PDF/Office),不支援的類型直接下載
// requestId:附件所屬需求 id(Office 預覽代理需要，也用來驗證附件網址真的屬於這筆需求)
export default function Attachments({ items, requestId }) {
  const [preview, setPreview] = useState(null) // { a, info, safeUrl }

  if (!items || items.length === 0) return null

  // 每個附件在使用前都必須先驗證：url 是不是合法的本專案 Firebase Storage 網址、
  // 解出的路徑是否精確屬於這筆 requestId。驗證失敗一律不載入/不開啟/不產生連結，
  // 不會退而求其次顯示原始網址(避免 stored XSS／惡意導向 —— Firestore Rules 本身
  // 只驗證 url 是非空字串，無法擋住惡意寫入的 metadata)。
  function open(e, a, idx) {
    e.stopPropagation()
    const safeUrl = getSafeAttachmentUrl(a, requestId)
    if (!safeUrl) {
      alert('這個附件的連結驗證失敗，無法開啟（可能是資料異常或遭竄改）。')
      return
    }
    const info = previewInfo(a, safeUrl, requestId, idx)
    if (info.kind === 'download') {
      window.open(safeUrl, '_blank', 'noopener,noreferrer')
      return
    }
    setPreview({ a, info, safeUrl })
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {items.map((a, idx) => (
          <button key={a.url} type="button" onClick={e => open(e, a, idx)}
            className="inline-flex items-center gap-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg px-2.5 py-1 transition-colors">
            {icon(a.name)} <span className="truncate max-w-[180px]">{a.name}</span>
          </button>
        ))}
      </div>

      {preview && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex flex-col" onClick={e => { e.stopPropagation(); setPreview(null) }}>
          {/* 頂欄 */}
          <div className="flex items-center gap-3 px-4 py-3 bg-gray-900/90 text-white" onClick={e => e.stopPropagation()}>
            <span className="text-sm truncate flex-1">{icon(preview.a.name)} {preview.a.name}</span>
            <a href={preview.info.src} target="_blank" rel="noreferrer noopener"
              className="text-xs bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5">另開視窗</a>
            <a href={preview.safeUrl} target="_blank" rel="noreferrer noopener"
              className="text-xs bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5">下載</a>
            <button onClick={() => setPreview(null)}
              className="text-lg leading-none px-2 hover:text-gray-500">✕</button>
          </div>
          {/* 內容 */}
          <div className="flex-1 min-h-0 p-4 flex items-center justify-center" onClick={e => e.stopPropagation()}>
            {preview.info.kind === 'image' ? (
              <img src={preview.info.src} alt={preview.a.name}
                className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
            ) : (
              <iframe src={preview.info.src} title={preview.a.name}
                className="w-full h-full bg-white rounded-lg shadow-2xl" />
            )}
          </div>
        </div>
      )}
    </>
  )
}
