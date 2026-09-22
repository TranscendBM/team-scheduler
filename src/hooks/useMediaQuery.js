import { useCallback, useSyncExternalStore } from 'react'

// 只給「必須用 JS 才能做到 RWD」的地方用（例如甘特圖的人名欄寬度同時參與捲動位置計算，
// 沒辦法單純靠 Tailwind class 處理）。一般版面請優先用 Tailwind 的 sm:/md:/lg:。
//
// 用 useSyncExternalStore 訂閱 matchMedia，而不是 useEffect + setState：
// matchMedia 本來就是外部資料源，這樣寫不會在 effect 裡同步 setState（見
// eslint react-hooks/set-state-in-effect），也不會有「首次 render 用錯值再閃一下」的問題。
export function useMediaQuery(query) {
  const subscribe = useCallback((onStoreChange) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {}
    const mql = window.matchMedia(query)
    mql.addEventListener('change', onStoreChange)
    return () => mql.removeEventListener('change', onStoreChange)
  }, [query])

  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  }, [query])

  // 伺服器端渲染 / 沒有 matchMedia 時一律當成「不符合」（等同桌面以外的保守值）
  const getServerSnapshot = useCallback(() => false, [])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

// Tailwind 預設 breakpoint：lg = 1024px
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)')

export default useMediaQuery
