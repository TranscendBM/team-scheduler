// 背景捲動鎖（drawer / modal 開啟時用）。
//
// 刻意寫成「吃一個 document 物件」的純函式 + 計數器，理由有兩個：
//  1. 同一時間可能有兩層以上要鎖（例如 drawer 開著、又從頁面開了 Modal），
//     用計數器才不會前面那層先關掉就把鎖整個解掉。
//  2. 不依賴 window/document 全域，單元測試可以直接傳假的 document 進來驗證
//     「開→關一定會還原」，不需要 jsdom。
//
// 只負責加/移除 body 的 class 與 padding-right（補 scrollbar 寬度避免版面左右跳動），
// 不改任何其他樣式。

export const SCROLL_LOCK_CLASS = 'ts-scroll-locked'

const counts = new WeakMap()

function scrollbarWidth(doc) {
  const win = doc.defaultView
  if (!win || typeof win.innerWidth !== 'number') return 0
  const docWidth = doc.documentElement?.clientWidth
  if (typeof docWidth !== 'number') return 0
  return Math.max(0, win.innerWidth - docWidth)
}

export function lockScroll(doc) {
  if (!doc || !doc.body) return
  const next = (counts.get(doc) || 0) + 1
  counts.set(doc, next)
  if (next > 1) return // 已經鎖住了，不重複設定
  const gap = scrollbarWidth(doc)
  doc.body.dataset.tsScrollLockPad = doc.body.style.paddingRight || ''
  if (gap > 0) doc.body.style.paddingRight = `${gap}px`
  doc.body.classList.add(SCROLL_LOCK_CLASS)
}

export function unlockScroll(doc) {
  if (!doc || !doc.body) return
  const cur = counts.get(doc) || 0
  if (cur === 0) return
  const next = cur - 1
  counts.set(doc, next)
  if (next > 0) return // 還有其他層鎖著
  doc.body.classList.remove(SCROLL_LOCK_CLASS)
  doc.body.style.paddingRight = doc.body.dataset.tsScrollLockPad || ''
  delete doc.body.dataset.tsScrollLockPad
}

// 測試用：目前這份 document 上還有幾層鎖（0 = 完全解鎖）
export function scrollLockCount(doc) {
  return counts.get(doc) || 0
}
