// 把文字拆成純文字/網址交錯的片段陣列，方便 UI 決定怎麼 render(純文字節點 vs <a>)。
// 只認 http(s):// 開頭的網址 —— 不會有人塞 javascript:/data: 之類的 scheme 進來被當成連結。
const URL_RE = /(https?:\/\/[^\s<>"']+)/g

export function splitLinkParts(text) {
  if (!text) return []
  return String(text)
    .split(URL_RE)
    .map((value, i) => ({ type: i % 2 === 1 ? 'url' : 'text', value }))
    .filter((p) => p.value !== '')
}
