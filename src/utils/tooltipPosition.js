// 甘特圖 tooltip 的定位：預設放在游標右下，但不能超出 viewport
// （手機上點右半邊的工作條，原本的 x + 14 會讓整個 tooltip 掉出畫面外）。
// 純函式，方便單元測試；回傳 { left, top }，單位 px。
export function tooltipPosition({ x, y, width, height, viewportWidth, viewportHeight, margin = 8, offsetX = 14, offsetY = -10 }) {
  const maxLeft = Math.max(margin, viewportWidth - width - margin)
  const maxTop = Math.max(margin, viewportHeight - height - margin)
  let left = x + offsetX
  // 右邊放不下就翻到游標左側
  if (left > maxLeft) left = Math.max(margin, x - width - offsetX)
  left = Math.min(Math.max(left, margin), maxLeft)
  const top = Math.min(Math.max(y + offsetY, margin), maxTop)
  return { left, top }
}

export default tooltipPosition
