import { useState } from 'react'
import { initialsOf } from '../utils/companionMessages'

const TONE = {
  info: 'bg-white border-gray-200 text-gray-700',
  warn: 'bg-amber-50 border-amber-200 text-amber-800',
  good: 'bg-emerald-50 border-emerald-200 text-emerald-800',
}

// 儀表板最上面的「我的夥伴」：角色圖 + 對話泡泡。
// 角色圖放 public/avatars/<key>.png(有 .glb 時之後可換成 3D，版面不用動)；找不到圖時顯示 Google 頭像或姓名縮寫。
// 點角色會彈跳並換下一則訊息。
export default function CompanionCard({ name, avatarKey, photoURL, messages }) {
  const [idx, setIdx] = useState(0)
  const [bounce, setBounce] = useState(0)
  const [imgFailed, setImgFailed] = useState(false)
  const [photoFailed, setPhotoFailed] = useState(false)

  const list = messages?.length ? messages : [{ tone: 'info', text: '你好！' }]
  const msg = list[idx % list.length]
  const src = avatarKey && !imgFailed ? `/avatars/${avatarKey}.png` : null

  const next = () => {
    setBounce(b => b + 1)
    setIdx(i => (i + 1) % list.length)
  }

  return (
    <div className="flex items-end gap-4 mb-6">
      <button type="button" onClick={next} aria-label="跟夥伴互動，換一則訊息"
        className="companion-avatar flex-shrink-0 w-24 h-24 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-full">
        <span key={bounce} className={`block w-full h-full ${bounce ? 'companion-bounce' : ''}`}>
          <span className="companion-float block w-full h-full">
            {src ? (
              <img src={src} alt={`${name || '我'}的夥伴`} onError={() => setImgFailed(true)}
                className="w-full h-full object-contain drop-shadow-md select-none" draggable={false} />
            ) : photoURL && !photoFailed ? (
              <img src={photoURL} alt="" referrerPolicy="no-referrer" onError={() => setPhotoFailed(true)}
                className="w-full h-full rounded-full object-cover border-4 border-white shadow-md" />
            ) : (
              <span className="w-full h-full rounded-full bg-indigo-100 text-indigo-600 text-3xl font-bold flex items-center justify-center border-4 border-white shadow-md">
                {initialsOf(name)}
              </span>
            )}
          </span>
        </span>
      </button>

      <div className={`relative flex-1 min-w-0 border rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${TONE[msg.tone] || TONE.info}`}>
        <span className="absolute -left-1.5 bottom-6 w-3 h-3 rotate-45 border-l border-b bg-inherit border-inherit" aria-hidden="true" />
        <p>{msg.text}</p>
        {list.length > 1 && (
          <p className="text-[11px] text-gray-400 mt-1">點我看下一則（{(idx % list.length) + 1}/{list.length}）</p>
        )}
      </div>

      <style>{`
        @keyframes companion-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-5px) } }
        @keyframes companion-bounce { 0% { transform: scale(1) } 30% { transform: scale(1.12, 0.9) } 60% { transform: scale(0.95, 1.08) translateY(-8px) } 100% { transform: scale(1) } }
        .companion-float { animation: companion-float 3s ease-in-out infinite }
        .companion-bounce { animation: companion-bounce 0.5s ease-out }
        @media (prefers-reduced-motion: reduce) { .companion-float, .companion-bounce { animation: none } }
      `}</style>
    </div>
  )
}
