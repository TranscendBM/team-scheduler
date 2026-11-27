import { useEffect, useRef, useState } from 'react'

// 3D 角色檢視器(Google <model-viewer>，載入 .glb)。函式庫只在真的有 3D 角色時才動態載入。
// - 模型裡有動作：依訊息語氣播放(info→idle、warn→busy、good→happy)，點一下揮手後回到原本的動作。
//   動作名稱用「包含」比對(不分大小寫)，找不到對應的就播第一個動作。
// - 扁平的模型(例如浮雕，厚度/高度 < 0.3)：限制左右轉動的角度，避免轉到背面；點一下由外層做彈跳。
// - 完整的立體模型可以拖曳 360° 旋轉，像 amiibo 一樣。
// - 使用者設定「減少動態效果」時不自動播放動作。
// - 載入失敗會呼叫 onError，由外層退回圖片。
const BASE_BY_TONE = { info: ['idle', 'stand'], warn: ['busy', 'work', 'idle'], good: ['happy', 'celebrate', 'joy', 'idle'] }
const WAVE = ['wave', 'hello', 'greet']

let libPromise = null
function loadViewer() {
  libPromise ||= import('@google/model-viewer')
  return libPromise
}

export function pickAnimation(names, wanted) {
  for (const w of wanted) {
    const hit = (names || []).find(n => String(n).toLowerCase().includes(w))
    if (hit) return hit
  }
  return null
}

export default function CompanionModel({ src, poster, tone = 'info', onTap, onError, label }) {
  const ref = useRef(null)
  const [ready, setReady] = useState(false)
  const [animated, setAnimated] = useState(false)
  const [flat, setFlat] = useState(false)
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const down = useRef(null)

  useEffect(() => {
    let alive = true
    loadViewer().then(() => alive && setReady(true)).catch(() => alive && onError?.())
    return () => { alive = false }
  }, [onError])

  // 載入完成：記錄有沒有動作。失敗：退回圖片
  useEffect(() => {
    const el = ref.current
    if (!ready || !el) return
    const onLoad = () => {
      setAnimated((el.availableAnimations || []).length > 0)
      const d = el.getDimensions?.()
      setFlat(!!d && d.y > 0 && d.z / d.y < 0.3)
    }
    const fail = () => onError?.()
    el.addEventListener('load', onLoad)
    el.addEventListener('error', fail)
    return () => { el.removeEventListener('load', onLoad); el.removeEventListener('error', fail) }
  }, [ready, onError])

  // 依訊息語氣切換動作
  useEffect(() => {
    const el = ref.current
    if (!ready || !el || !animated || reduced) return
    const names = el.availableAnimations || []
    const base = pickAnimation(names, BASE_BY_TONE[tone] || BASE_BY_TONE.info) || names[0]
    if (base) { el.animationName = base; el.play({ repetitions: Infinity }) }
  }, [ready, animated, tone, reduced])

  // 點一下(拖曳旋轉不算點)：有揮手動作就播一次，播完回到原本的動作
  const handlePointerUp = (e) => {
    const d = down.current
    down.current = null
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return
    onTap?.()
    const el = ref.current
    if (!el || !animated || reduced) return
    const names = el.availableAnimations || []
    const wave = pickAnimation(names, WAVE)
    if (!wave) return
    const base = pickAnimation(names, BASE_BY_TONE[tone] || BASE_BY_TONE.info) || names[0]
    el.animationName = wave
    el.play({ repetitions: 1 })
    const back = () => { el.removeEventListener('finished', back); el.animationName = base; el.play({ repetitions: Infinity }) }
    el.addEventListener('finished', back)
  }

  if (!ready) return poster ? <img src={poster} alt="" className="w-full h-full object-contain opacity-60" /> : null

  // React 18 會把 false 轉成字串 "false"，對 model-viewer 反而是開啟，所以條件屬性用展開的方式整個省略
  const attrs = flat ? { 'min-camera-orbit': '-40deg auto auto', 'max-camera-orbit': '40deg auto auto' } : {}

  return (
    <model-viewer
      ref={ref}
      src={src}
      alt={label || '角色'}
      {...(poster ? { poster } : {})}
      {...attrs}
      camera-controls=""
      disable-zoom=""
      disable-pan=""
      interaction-prompt="none"
      shadow-intensity="0.8"
      exposure="1.1"
      loading="lazy"
      onPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY } }}
      onPointerUp={handlePointerUp}
      style={{ width: '100%', height: '100%', touchAction: 'pan-y', background: 'transparent', '--poster-color': 'transparent' }}
    />
  )
}
