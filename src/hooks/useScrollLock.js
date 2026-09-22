import { useEffect } from 'react'
import { lockScroll, unlockScroll } from '../utils/scrollLock'

// active 為 true 時鎖住背景捲動，false 或元件卸載時一定會解開
// （route 切換、Modal 被條件式移除都算卸載，所以不會殘留 scroll lock）。
export function useScrollLock(active) {
  useEffect(() => {
    if (!active) return undefined
    const doc = typeof document === 'undefined' ? null : document
    if (!doc) return undefined
    lockScroll(doc)
    return () => unlockScroll(doc)
  }, [active])
}

export default useScrollLock
