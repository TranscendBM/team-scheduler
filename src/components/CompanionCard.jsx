import { useCallback, useEffect, useState } from 'react'
import { initialsOf } from '../utils/companionMessages'
import CompanionModel from './CompanionModel'

const TONE = {
  info: 'bg-white border-gray-200 text-gray-700',
  warn: 'bg-amber-50 border-amber-200 text-amber-800',
  good: 'bg-emerald-50 border-emerald-200 text-emerald-800',
}

// 哪些人有 3D 模型：public/avatars/manifest.json → { "glb": ["rachel.chen", ...], "aliases": { "登入信箱前綴": "rachel.chen" } }，
// 對應 /avatars/<key>.glb；別名讓同一個人的不同信箱(公司信箱、登入 Gmail)都找得到同一個檔。
// Firebase Hosting 對不存在的檔案會回首頁(不是 404)，所以不能用「試著抓檔案」來判斷，改用清單。
let manifestPromise = null
function loadManifest() {
  manifestPromise ||= fetch('/avatars/manifest.json')
    .then(r => r.json())
    .then(j => ({ glb: Array.isArray(j?.glb) ? j.glb : [], aliases: j?.aliases && typeof j.aliases === 'object' ? j.aliases : {} }))
    .catch(() => ({ glb: [], aliases: {} }))
  return manifestPromise
}

// 儀表板最上面的「我的夥伴」：角色 + 對話泡泡。
// 角色優先順序：3D 模型(.glb，見 manifest) → 圖片 public/avatars/<key>.png → Google 頭像 → 姓名縮寫。
// 點角色會彈跳並換下一則訊息(3D 模型拖曳旋轉不會換訊息)。
export default function CompanionCard({ name, avatarKey, avatarKeys, photoURL, messages }) {
  const [idx, setIdx] = useState(0)
  const [bouncing, setBouncing] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)
  const [photoFailed, setPhotoFailed] = useState(false)
  const [glbKey, setGlbKey] = useState('')
  const [glbFailed, setGlbFailed] = useState(false)

  const keysId = (avatarKeys || [avatarKey]).filter(Boolean).join('|')
  useEffect(() => {
    let alive = true
    if (keysId) {
      loadManifest().then(({ glb, aliases }) => {
        if (!alive) return
        const hit = keysId.split('|').map(k => aliases[k] || k).find(k => glb.includes(k))
        setGlbKey(hit || '')
      })
    }
    return () => { alive = false }
  }, [keysId])

  const list = messages?.length ? messages : [{ tone: 'info', text: '你好！' }]
  const msg = list[idx % list.length]
  const png = avatarKey && !imgFailed ? `/avatars/${avatarKey}.png` : null
  const show3d = !!glbKey && !glbFailed

  const next = useCallback(() => {
    setBouncing(true)
    setIdx(i => (i + 1) % list.length)
  }, [list.length])
  // 彈跳動畫播完就移除 class(不能用 key 重新掛載，否則 3D 模型會重新載入)
  useEffect(() => {
    if (!bouncing) return
    const t = setTimeout(() => setBouncing(false), 520)
    return () => clearTimeout(t)
  }, [bouncing])
  const failGlb = useCallback(() => setGlbFailed(true), [])

  const fallback = png ? (
    <img src={png} alt={`${name || '我'}的夥伴`} onError={() => setImgFailed(true)}
      className="w-full h-full object-contain drop-shadow-md select-none" draggable={false} />
  ) : photoURL && !photoFailed ? (
    <img src={photoURL} alt="" referrerPolicy="no-referrer" onError={() => setPhotoFailed(true)}
      className="w-full h-full rounded-full object-cover border-4 border-white shadow-md" />
  ) : (
    <span className="w-full h-full rounded-full bg-indigo-100 text-indigo-600 text-3xl font-bold flex items-center justify-center border-4 border-white shadow-md">
      {initialsOf(name)}
    </span>
  )

  const body = (
    <span className={`block w-full h-full ${bouncing ? 'companion-bounce' : ''}`}>
      <span className="companion-float block w-full h-full">
        {show3d ? (
          <CompanionModel src={`/avatars/${glbKey}.glb`} poster={png} tone={msg.tone}
            onTap={next} onError={failGlb} label={`${name || '我'}的夥伴`} />
        ) : fallback}
      </span>
    </span>
  )

  return (
    <div className="flex items-end gap-4 mb-6">
      {show3d ? (
        // 3D：容器本身不是按鈕(內部要拖曳旋轉)，點擊由 CompanionModel 判斷
        <div className="flex-shrink-0 w-32 h-40" role="img" aria-label={`${name || '我'}的 3D 夥伴，可拖曳旋轉，點一下換訊息`}>{body}</div>
      ) : (
        <button type="button" onClick={next} aria-label="跟夥伴互動，換一則訊息"
          className="flex-shrink-0 w-24 h-24 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-full">
          {body}
        </button>
      )}

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
