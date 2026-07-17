import { useState } from 'react'

const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']
const OFFICE_EXT = ['ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx']

const ext = (name) => ((name || '').split('.').pop() || '').toLowerCase()

// Office 檢視器吃不下 Firebase URL 的 %-編碼路徑 → 走 previewFile 代理(乾淨網址、逐檔驗 token)
const PROXY = 'https://asia-east1-team-scheduler-dc7ce.cloudfunctions.net/previewFile'
function proxyUrl(a, requestId, idx) {
  const token = (a.url.match(/token=([\w-]+)/) || [])[1] || ''
  if (!requestId || !token) return null
  return `${PROXY}/${requestId}/${idx}/${token.slice(0, 12)}`
}

// 依副檔名決定預覽方式:image / pdf 原生、office 走 MS 線上檢視器、其他下載
function previewInfo(a, requestId, idx) {
  const e = ext(a.name)
  if (IMG_EXT.includes(e)) return { kind: 'image', src: a.url }
  if (e === 'pdf') return { kind: 'iframe', src: a.url }
  if (OFFICE_EXT.includes(e)) {
    const clean = proxyUrl(a, requestId, idx)
    if (!clean) return { kind: 'download' }
    return { kind: 'iframe', src: `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(clean)}` }
  }
  return { kind: 'download' }
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
// requestId:附件所屬需求 id(Office 預覽代理需要)
export default function Attachments({ items, requestId }) {
  const [preview, setPreview] = useState(null) // { a, info }

  if (!items || items.length === 0) return null

  function open(e, a, idx) {
    e.stopPropagation()
    const info = previewInfo(a, requestId, idx)
    if (info.kind === 'download') {
      window.open(a.url, '_blank')
      return
    }
    setPreview({ a, info })
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
            <a href={preview.info.src} target="_blank" rel="noreferrer"
              className="text-xs bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5">另開視窗</a>
            <a href={preview.a.url} target="_blank" rel="noreferrer"
              className="text-xs bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5">下載</a>
            <button onClick={() => setPreview(null)}
              className="text-lg leading-none px-2 hover:text-gray-300">✕</button>
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
